"""Visitor-only HTTP interface of the local projector. Session data lives in RAM."""
from email.parser import BytesParser
from email.policy import default
import errno
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sys
import socket
import subprocess
import threading
import time
from urllib.parse import urlsplit

from speech_core import choose_answer

WEB = Path(__file__).resolve().parents[1] / "mobile" / "docs"
TERMINAL = {"finished", "cancelled", "failed"}
IDLE = 120


class Problem(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Visitors:
    def __init__(self, player):
        self.player = player
        self.sessions = {}

    def update(self, session, now):
        for turn in session["turns"]:
            if turn["state"] in TERMINAL:
                continue
            record = self.player.history.get(turn["id"], {})
            turn["state"] = record.get("state", "failed")
            if turn["state"] in TERMINAL:
                session["until"] = record.get("ended_at", now) + IDLE

    def request(self, path, token, data=None):
        with self.player.lock:
            now = time.monotonic()
            for key, session in list(self.sessions.items()):
                self.update(session, now)
                busy = any(t["state"] not in TERMINAL for t in session["turns"])
                if not busy and session["until"] < now:
                    del self.sessions[key]
            online = self.player.ready and not self.player.stopped and not self.player.exit
            if path == "/api/site":
                return {"online": online}
            if path == "/api/start":
                if token in self.sessions:
                    return self.snapshot(self.sessions[token], online)
                if not online:
                    raise Problem(503, "Показ приостановлен.")
                if len(self.sessions) >= 128:
                    raise Problem(429, "Сейчас много посетителей. Попробуйте чуть позже.")
                token = secrets.token_urlsafe(32)
                self.sessions[token] = {"turns": [], "until": now + IDLE}
                return {"token": token, **self.snapshot(self.sessions[token], online)}
            session = self.sessions.get(token)
            if not session:
                raise Problem(401, "Время разговора истекло. Начните новый.")
            if path == "/api/question":
                text = data.get("text")
                key = data.get("key")
                if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
                    raise Problem(400, "Введите вопрос длиной до 500 знаков.")
                if not isinstance(key, str) or not 8 <= len(key) <= 80:
                    raise Problem(400, "Нужен идентификатор отправки.")
                turns = session["turns"]
                for turn in turns:
                    if turn["key"] == key:
                        if turn["question"] != text.strip():
                            raise Problem(409, "Повторная отправка содержит другой вопрос.")
                        return self.snapshot(session, online)
                if not online:
                    raise Problem(503, "Показ приостановлен.")
                if len(turns) >= 3 or any(t["state"] not in TERMINAL for t in turns):
                    raise Problem(409, "Дождитесь ответа или начните новый разговор после третьего вопроса.")
                # Only a curated response crosses the visitor / public-speaker boundary.
                if re.search(r"https?://|[\w.+-]+@[\w.-]+\.\w+|(?:\d[ ()-]*){8,}", text, re.I):
                    raise Problem(422, "Задайте вопрос без ссылок и личных контактов.")
                if turns and re.fullmatch(r"(?:а )?(?:как именно|почему|расскажите подробнее|подробнее)[?.! ]*", text.strip(), re.I):
                    if "приёмник" in turns[-1]["answer"].lower():
                        answer = choose_answer("Что такое радио?")
                    else:
                        answer = choose_answer("Приёмник")
                else:
                    answer = choose_answer(text)
                event = hashlib.sha256((token + ":" + key).encode()).hexdigest()
                try:
                    result = self.player.handle({"command": "say", "text": answer,
                                                 "id": event, "expiry": time.time() + 300})
                except ValueError as exc:
                    raise Problem(409, str(exc)) from exc
                self.player.history[event]["visitor"] = True
                turns.append({"key": key, "id": event, "question": text.strip(),
                              "answer": answer.replace("**", ""), "state": result["state"]})
            return self.snapshot(session, online)

    def snapshot(self, session, online):
        queued = [task[0] for task in self.player.tasks]
        turns = []
        for t in session["turns"]:
            state = t["state"]
            item = {"key": t["key"], "question": t["question"], "state": state}
            if state in ("started", "finished"):
                item["answer"] = t["answer"]
            if state == "started":
                record = self.player.history[t["id"]]
                item["elapsed"] = round(time.monotonic() - record["started_at"], 3)
                item["poses"] = record.get("poses", [])
            if state == "queued":
                if t["id"] in queued:
                    item["ahead"] = queued.index(t["id"]) + int(bool(self.player.active))
                else:
                    item["state"] = "prepared"
            turns.append(item)
        return {"online": online, "turns": turns, "remaining": 3 - len(turns)}


class VisitorHandler(BaseHTTPRequestHandler):
    server_version = "Popov"
    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def reply(self, status, body, kind):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def dispatch(self):
        path = urlsplit(self.path).path
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if self.headers.get("Host") not in self.server.hosts:
            raise Problem(403, "Неизвестный адрес площадки.")
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            raise Problem(403, "Откройте страницу площадки.")
        if self.command == "POST" and path == "/api/transcribe":
            current = self.server.visitors.request("/api/session", token)
            if not current["online"] or not current["remaining"] or any(t["state"] not in TERMINAL for t in current["turns"]):
                raise Problem(409, "Сейчас запись недоступна.")
            if not self.server.asr_lock.acquire(blocking=False):
                raise Problem(429, "Распознавание занято. Повторите через несколько секунд.")
            try:
                result = self.transcribe()
            finally:
                self.server.asr_lock.release()
        elif self.command == "GET" and path in ("/api/site", "/api/session"):
            result = self.server.visitors.request(path, token)
        elif self.command == "POST" and path in ("/api/start", "/api/question"):
            if self.headers.get_content_type() != "application/json":
                raise Problem(415, "Требуется JSON.")
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 8192:
                    raise Problem(413, "Слишком большой запрос.")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError()
            except (UnicodeError, ValueError) as exc:
                raise Problem(400, "Некорректный запрос.") from exc
            result = self.server.visitors.request(path, token, data)
        elif self.command == "GET" and path in self.server.assets:
            file = self.server.assets[path]
            self.reply(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            return
        else:
            raise Problem(404, "Страница не найдена.")
        self.reply(200, json.dumps(result, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def transcribe(self):
        if self.headers.get_content_type() != "multipart/form-data":
            raise Problem(415, "Требуется запись.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise Problem(400, "Некорректный размер записи.")
        if not 0 < length <= 10 * 1024 * 1024 + 2048:
            raise Problem(413, "Запись должна быть меньше 10 МБ.")
        header = self.headers["Content-Type"]
        msg = BytesParser(policy=default).parsebytes(
            f"Content-Type: {header}\r\n\r\n".encode() + self.rfile.read(length))
        audio = next((p.get_payload(decode=True) for p in msg.iter_parts()
                      if p.get_param("name", header="content-disposition") == "recording"), None)
        if not audio or len(audio) > 10 * 1024 * 1024:
            raise Problem(400, "Нужна запись речи до 20 секунд.")
        try:
            worker = Path(__file__).with_name("transcribe.py")
            proc = subprocess.run([sys.executable, str(worker)], input=audio,
                                  capture_output=True, timeout=20, check=True)
            transcript = proc.stdout.decode().strip()
        except (subprocess.SubprocessError, UnicodeError):
            raise Problem(422, "Запись не распознана. Запишите 1–20 секунд или введите вопрос.")
        if not 1 <= len(transcript) <= 500:
            raise Problem(422, "Не удалось разобрать вопрос. Попробуйте ещё раз.")
        return {"text": transcript}

    def do_GET(self):
        try:
            self.dispatch()
        except Problem as exc:
            self.reply(exc.status, json.dumps({"error": str(exc)}, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    do_POST = do_GET


def network_warning():
    firewall = Path("/usr/libexec/ApplicationFirewall/socketfilterfw")
    if firewall.exists():
        try:
            result = subprocess.run([str(firewall), "--getglobalstate"], capture_output=True,
                                    text=True, timeout=1)
            if "State = 2" in result.stdout:
                return "Брандмауэр блокирует вход с телефона. На Mac доступен предпросмотр."
        except (OSError, subprocess.TimeoutExpired):
            pass
    return ""


def start(player, host, port):
    if not (WEB / "popov.html").is_file():
        raise ValueError("Мобильное приложение не установлено. Запустите setup.command.")
    class StationHTTP(ThreadingHTTPServer):
        allow_reuse_address = False
        allow_reuse_port = False

    try:
        server = StationHTTP((host, 18776 if port is None else port), VisitorHandler)
    except OSError as exc:
        if port is not None or exc.errno != errno.EADDRINUSE:
            raise
        server = StationHTTP((host, 0), VisitorHandler)
    server.visitors = Visitors(player)
    server.assets = {"/" + file.relative_to(WEB).as_posix(): file for file in WEB.rglob("*")
                     if file.is_file() and not file.name.startswith(".")}
    server.assets["/"] = WEB / "index.html"
    port = server.server_port
    server.hosts = {f"localhost:{port}", f"127.0.0.1:{port}", urlsplit(visitor_url(server)).netloc}
    server.asr_lock = threading.Lock()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def visitor_url(server):
    public = os.environ.get("POPOV_VISITOR_URL")
    if public and urlsplit(public).scheme == "https" and urlsplit(public).hostname:
        return public.rstrip("/") if urlsplit(public).path.endswith("popov.html") else public.rstrip("/") + "/popov.html"
    host, port = server.server_address
    if host == "0.0.0.0":
        for interface in ("en0", "en1", "en2"):
            found = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", interface],
                                   capture_output=True, text=True).stdout.strip()
            if found:
                host = str(ipaddress.IPv4Address(found))
                break
        else:
            host = socket.gethostname().split(".")[0] + ".local"
    return f"http://{host}:{port}/popov.html"
