"""Single-station production service. Run ONE worker; SQLite owns queue state."""
from contextlib import asynccontextmanager
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
from pathlib import Path
import secrets
import sqlite3
import threading
import time

from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from .providers import LANGUAGES, VOICES, Provider
from .local import valid_public_url
from .body_limit import BodyLimitMiddleware

ROOT = Path(__file__).resolve().parents[1]
TERMINAL = {"finished", "failed", "cancelled"}
log = logging.getLogger("popov")


class Start(BaseModel):
    admission: str = Field(max_length=200)
    client_id: str = Field(min_length=16, max_length=80)
    language: str = "ru"
    voice: str = "onyx"


class Question(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    key: str = Field(min_length=8, max_length=80)
    language: str | None = None


class Ack(BaseModel):
    state: str


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, admission TEXT UNIQUE, until REAL, language TEXT, voice TEXT);
          CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, session TEXT, key TEXT, question TEXT, answer TEXT DEFAULT '',
            state TEXT, created REAL, updated REAL, payload TEXT, UNIQUE(session,key));
        """)
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(jobs)")}
        if "error" not in columns:
            self.db.execute("ALTER TABLE jobs ADD COLUMN error TEXT NOT NULL DEFAULT ''")
        session_columns = {row[1] for row in self.db.execute("PRAGMA table_info(sessions)")}
        if "browser_hash" not in session_columns:
            self.db.execute("ALTER TABLE sessions ADD COLUMN browser_hash TEXT NOT NULL DEFAULT ''")
        if "spent" not in session_columns:
            self.db.execute("ALTER TABLE sessions ADD COLUMN spent INTEGER NOT NULL DEFAULT 0")
            self.db.execute("UPDATE sessions SET spent=(SELECT COUNT(*) FROM jobs WHERE jobs.session=sessions.id AND jobs.state='finished')")
        # A process restart cannot know whether an already delivered job was spoken.
        # Fail closed instead of replaying a public utterance.
        self.db.execute("UPDATE jobs SET state='failed',payload=NULL WHERE state NOT IN ('finished','failed','cancelled')")

    def rows(self, sql, args=()):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]


def create_app(path=None, provider=None, secret=None, station_key=None, public_url=None):
    secret = secret or os.environ["QR_SECRET"]
    station_key = station_key or os.environ["STATION_KEY"]
    public_url = (public_url or os.environ["PUBLIC_URL"]).rstrip("/")
    if len(secret) < 32 or len(station_key) < 32:
        raise ValueError("QR_SECRET and STATION_KEY must each have at least 32 characters")
    if not valid_public_url(public_url):
        raise ValueError("PUBLIC_URL requires HTTPS or a local-network HTTP address")
    db_path = path or os.getenv("DATABASE", "/data/popov.sqlite3")
    if str(db_path) != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    store = Store(db_path)
    engine = provider or Provider()
    stop = threading.Event()
    heartbeat = {"at": 0., "online": False}
    asr_busy = threading.Lock()
    networks = [ipaddress.ip_network(n.strip()) for n in os.getenv("VISITOR_NETWORKS", "").split(",") if n.strip()]

    def epoch():
        return int(time.time() // 120)

    def sign(part):
        return hmac.new(secret.encode(), part.encode(), hashlib.sha256).hexdigest()

    def qr_token():
        part = str(epoch())
        return part + "." + sign(part)

    def valid_admission(value):
        # No previous-window grace period: old photographs immediately stop working.
        return hmac.compare_digest(value.encode(), qr_token().encode())

    def online():
        return heartbeat["online"] and time.time() - heartbeat["at"] < 10

    cookie_name = "popov_browser"

    def browser_hash(request, value):
        agent = request.headers.get("user-agent", "")[:1024]
        return hashlib.sha256((value + "\0" + agent).encode()).hexdigest()

    def session(request, allow_expired=False):
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        with store.lock:
            rows = store.rows("SELECT * FROM sessions WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(),))
        cookie = request.cookies.get(cookie_name, "")
        if not rows or not cookie or not hmac.compare_digest(rows[0]["browser_hash"], browser_hash(request, cookie)):
            raise HTTPException(401, "Откройте разговор в том же браузере или сканируйте свежий QR у проектора.")
        return rows[0]

    def snapshot(s):
        with store.lock:
            # Playback acknowledgement may have advanced spent since authentication.
            s = store.rows("SELECT * FROM sessions WHERE id=?", (s["id"],))[0]
            jobs = store.rows("SELECT * FROM jobs WHERE session=? ORDER BY created,id", (s["id"],))
            queue = store.rows("SELECT id FROM jobs WHERE state NOT IN ('finished','failed','cancelled') ORDER BY created,id")
        order = [r["id"] for r in queue]
        turns = [{"key": j["key"], "question": j["question"], "state": j["state"],
                  "answer": j["answer"] if j["state"] == "finished" else "",
                  "error": j["error"], "ahead": order.index(j["id"]) if j["id"] in order else 0} for j in jobs]
        used = s["spent"] + sum(j["state"] not in TERMINAL for j in jobs)
        return {"online": online(), "turns": turns, "remaining": max(0, 3-used),
                "expires_at": None, "can_send": used < 3, "server_time": time.time(),
                "language": s["language"], "voice": s["voice"]}

    def process():
        while not stop.wait(.2):
            with store.lock:
                now = time.time()
                # Bound database growth and stale jobs. Accepted speech may finish after QR expiry.
                store.db.execute("DELETE FROM jobs WHERE created<? AND state IN ('finished','failed','cancelled')", (now-86400,))
                # The three-question counter survives history retention. An admitted
                # browser session is not revoked by QR rotation or a wall clock.
                store.db.execute("UPDATE jobs SET state='failed',payload=NULL WHERE state NOT IN ('finished','failed','cancelled') AND created<?", (now-300,))
                jobs = store.rows("SELECT j.*,s.language,s.voice FROM jobs j JOIN sessions s ON s.id=j.session WHERE j.state='generating' ORDER BY j.created LIMIT 1")
                if not jobs:
                    continue
                job = jobs[0]
                history = store.rows("SELECT question,answer FROM jobs WHERE session=? AND state='finished' ORDER BY created", (job["session"],))
            try:
                answer = engine.answer(job["question"], history, job["language"])
                with store.lock:
                    store.db.execute("UPDATE jobs SET answer=? WHERE id=? AND state='generating'", (answer, job["id"]))
                payload = engine.speech(answer, job["language"], job["voice"])
                with store.lock:
                    store.db.execute("UPDATE jobs SET answer=?,payload=?,state='queued',updated=? WHERE id=? AND state='generating'",
                                     (answer, json.dumps(payload), time.time(), job["id"]))
            except Exception:
                log.exception("Generation failed for job %s", job["id"])
                with store.lock:
                    current = store.rows("SELECT answer FROM jobs WHERE id=?", (job["id"],))
                    message = "Не удалось озвучить ответ. Попробуйте ещё раз — вопрос не потрачен." if current and current[0]["answer"] else "Сервис ответов временно недоступен. Попробуйте ещё раз — вопрос не потрачен."
                    store.db.execute("UPDATE jobs SET state='failed',payload=NULL,error=?,updated=? WHERE id=?", (message, time.time(), job["id"]))

    @asynccontextmanager
    async def lifespan(app):
        worker = threading.Thread(target=process, daemon=True)
        worker.start()
        yield
        stop.set()
        # Provider requests have a finite timeout. Do not close its DB underneath it.
        worker.join(timeout=1)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    app.add_middleware(BodyLimitMiddleware, max_bytes=10*1024*1024)
    app.state.store = store

    @app.exception_handler(HTTPException)
    async def error(request, exc):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    @app.middleware("http")
    async def headers(request, call_next):
        # No CORS: phone and API are served from one HTTPS origin.
        if networks and request.url.path in ("/api/start", "/api/question", "/api/transcribe"):
            try:
                address = ipaddress.ip_address(request.client.host)
                allowed = any(address in network for network in networks)
            except (ValueError, AttributeError):
                allowed = False
            if not allowed:
                return JSONResponse({"error": "Для вопросов подключитесь к сети площадки."}, status_code=403)
        origin = request.headers.get("origin")
        if request.method == "POST" and origin and origin.rstrip("/") != public_url:
            return JSONResponse({"error": "Откройте приложение площадки."}, status_code=403)
        length = request.headers.get("content-length", "0")
        if not re.fullmatch(r"[0-9]{1,18}", length) or int(length) > 10*1024*1024:
            return JSONResponse({"error": "Слишком большой запрос."}, status_code=413)
        response = await call_next(request)
        response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
        return response

    def authenticate_station(request):
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), ("Bearer " + station_key).encode()):
            raise HTTPException(401, "Station authentication required")

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/site")
    def site():
        return {"online": online(), "languages": LANGUAGES, "voices": VOICES, "server_mode": True, "server_time": time.time()}

    @app.post("/api/start")
    def start(data: Start, request: Request, response: Response):
        if data.language not in LANGUAGES or data.voice not in VOICES:
            raise HTTPException(422, "Выберите доступный язык и голос.")
        with store.lock:
            if not valid_admission(data.admission):
                raise HTTPException(401, "Сканируйте свежий QR у проектора.")
            if not online():
                raise HTTPException(503, "Проектор не на связи.")
            # Idempotent start: retries / reloads cannot reset the three-question quota.
            cookie = request.cookies.get(cookie_name, "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", cookie):
                cookie = secrets.token_urlsafe(32)
            binding = browser_hash(request, cookie)
            # The browser cookie, not a caller-controlled client_id or User-Agent
            # alone, owns the quota for this QR admission window.
            identity = hashlib.sha256((data.admission + binding).encode()).hexdigest()
            response.set_cookie(cookie_name, cookie, httponly=True, secure=public_url.startswith("https://"),
                                samesite="strict", path="/")
            token = sign("session:" + identity)
            sid = hashlib.sha256(token.encode()).hexdigest()
            existing = store.rows("SELECT * FROM sessions WHERE id=?", (sid,))
            if existing:
                return {"token": token, **snapshot(existing[0])}
            if len(store.rows("SELECT id FROM sessions WHERE until>?", (time.time(),))) >= 128:
                raise HTTPException(429, "Сейчас много посетителей.")
            store.db.execute("INSERT INTO sessions(id,admission,until,language,voice,browser_hash,spent) VALUES (?,?,?,?,?,?,0)",
                             (sid, identity, (epoch()+1)*120, data.language, data.voice, binding))
            s = store.rows("SELECT * FROM sessions WHERE id=?", (sid,))[0]
        return {"token": token, **snapshot(s)}

    @app.get("/api/session")
    def get_session(request: Request):
        # Access comes from the browser cookie plus bearer token; the QR deadline
        # controls admission only. Existing visitors can use their three questions.
        return snapshot(session(request, allow_expired=True))

    @app.post("/api/question")
    def question(request: Request, data: Question):
        s = session(request)
        if data.language is not None and data.language not in LANGUAGES:
            raise HTTPException(422, "Выберите доступный язык ответа.")
        text = data.text.strip()
        if not text:
            raise HTTPException(422, "Введите вопрос.")
        with store.lock:
            # Read the quota in the same critical section as the job insertion.
            s = store.rows("SELECT * FROM sessions WHERE id=?", (s["id"],))[0]
            previous = store.rows("SELECT * FROM jobs WHERE session=? AND key=?", (s["id"], data.key))
            if previous:
                if previous[0]["question"] != text:
                    raise HTTPException(409, "Этот идентификатор уже использован.")
                return snapshot(s)
            if not online():
                raise HTTPException(503, "Проектор не на связи.")
            mine = store.rows("SELECT state FROM jobs WHERE session=?", (s["id"],))
            used = s["spent"] + sum(j["state"] not in TERMINAL for j in mine)
            if used >= 3 or any(j["state"] not in TERMINAL for j in mine):
                raise HTTPException(409, "Дождитесь ответа. В сессии доступно три вопроса.")
            if store.rows("SELECT COUNT(*) n FROM jobs WHERE state NOT IN ('finished','failed','cancelled')")[0]["n"] >= 6:
                raise HTTPException(429, "Очередь заполнена.")
            # Global budget prevents fresh sessions from bypassing per-session quotas.
            if store.rows("SELECT COUNT(*) n FROM jobs WHERE created>?", (time.time()-120,))[0]["n"] >= 12:
                raise HTTPException(429, "Лимит площадки. Попробуйте позже.")
            now = time.time()
            if data.language:
                store.db.execute("UPDATE sessions SET language=? WHERE id=?", (data.language, s["id"]))
                s["language"] = data.language
            store.db.execute("INSERT INTO jobs(id,session,key,question,state,created,updated) VALUES(?,?,?,?,?,?,?)",
                             (secrets.token_hex(16), s["id"], data.key, text, "generating", now, now))
        return snapshot(s)

    @app.post("/api/transcribe")
    def transcribe(request: Request, recording: UploadFile = File(), language: str | None = Form(default=None)):
        s = session(request)
        if language is not None and language not in LANGUAGES:
            raise HTTPException(422, "Выберите доступный язык записи.")
        if not online() or not asr_busy.acquire(blocking=False):
            raise HTTPException(429, "Распознавание сейчас недоступно.")
        try:
            # Separate quota: transcription must not be an unlimited paid endpoint.
            with store.lock:
                recent = getattr(app.state, "asr_calls", [])
                recent = [t for t in recent if t > time.time()-120]
                if len(recent) >= 12:
                    raise HTTPException(429, "Лимит распознавания. Попробуйте позже.")
                recent.append(time.time())
                app.state.asr_calls = recent
            raw = recording.file.read(10*1024*1024+1)
            if not raw or len(raw) > 10*1024*1024:
                raise HTTPException(413, "Запись должна быть меньше 10 МБ.")
            text = engine.transcribe(raw, recording.filename or "recording.webm", language or s["language"])
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
                raise HTTPException(422, "Не удалось распознать короткий вопрос.")
            return {"text": text.strip()}
        except HTTPException:
            raise
        except Exception:
            log.exception("Transcription failed")
            raise HTTPException(502, "Не удалось распознать запись.")
        finally:
            asr_busy.release()

    playback_ready_at = 0.0

    @app.post("/station/poll")
    def poll(request: Request, data: dict):
        authenticate_station(request)
        with store.lock:
            heartbeat.update(at=time.time(), online=data.get("ready") is True)
            job = None
            active = store.rows("SELECT * FROM jobs WHERE state IN ('delivered','prepared','started') ORDER BY created LIMIT 1")
            if active:
                # Redelivery is safe: bridge uses persistent IDs in the local player.
                if active[0]["state"] == "delivered":
                    job = active[0]
            elif online() and time.monotonic() >= playback_ready_at:
                pending = store.rows("SELECT * FROM jobs WHERE state IN ('generating','queued') ORDER BY created,id LIMIT 1")
                if pending and pending[0]["state"] == "queued":
                    job = pending[0]
                    store.db.execute("UPDATE jobs SET state='delivered',updated=? WHERE id=?", (time.time(), job["id"]))
            until = (epoch()+1)*120
            result = {"url": public_url + "/popov.html#join=" + qr_token(), "expires_at": until}
            if job:
                result["job"] = {"id": job["id"], "text": job["answer"], "expiry": job["created"]+300,
                                 **json.loads(job["payload"])}
            return result

    @app.post("/station/jobs/{job_id}")
    def ack(job_id: str, data: Ack, request: Request):
        nonlocal playback_ready_at
        authenticate_station(request)
        if data.state not in {"prepared", "started", *TERMINAL}:
            raise HTTPException(422, "Unknown playback state")
        with store.lock:
            rows = store.rows("SELECT state FROM jobs WHERE id=?", (job_id,))
            if not rows:
                raise HTTPException(404, "Unknown job")
            old = rows[0]["state"]
            transitions = {"delivered": {"prepared", "started", *TERMINAL},
                           "prepared": {"started", *TERMINAL}, "started": TERMINAL}
            if data.state != old and data.state not in transitions.get(old, set()):
                raise HTTPException(409, "Invalid playback transition")
            if data.state == "finished" and old != "finished":
                playback_ready_at = time.monotonic() + 1.0
                store.db.execute("UPDATE sessions SET spent=spent+1 WHERE id=(SELECT session FROM jobs WHERE id=?)", (job_id,))
            store.db.execute("UPDATE jobs SET state=?,updated=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?",
                             (data.state, time.time(), data.state in TERMINAL, job_id))
        return {"ok": True}

    @app.get("/{asset:path}")
    def static(asset: str, request: Request):
        root = ROOT / "mobile" / "docs"
        if asset in ("", "index.html") or (asset == "popov.html" and "settings" not in request.query_params):
            shell = (root / "index.html").read_text(encoding="utf-8")
            return HTMLResponse(shell.replace("<head>", '<head><meta name="gorod-station" content="popov">', 1))
        file = (root / asset).resolve()
        if file.is_relative_to(root.resolve()) and file.is_file() and not any(
            part.startswith(".") for part in file.relative_to(root.resolve()).parts
        ):
            # Windows MIME registry may label .mjs as text/plain. Module scripts
            # require a JavaScript MIME type even when the content is correct.
            kind = "text/javascript" if file.suffix.lower() in (".mjs", ".js") else None
            return FileResponse(file, media_type=kind)
        raise HTTPException(404, "Страница не найдена.")

    return app
