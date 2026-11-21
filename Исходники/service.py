"""Trusted, local text input and persistent Russian speech model for the projector."""
import struct
from narration import MAX_TEXT, MAX_WIRE, phrases, phrase_gap
from collections import OrderedDict, deque
import hashlib
import json
import os
from pathlib import Path
import socket
import socketserver
import sys
import tempfile
import threading
import time
import uuid

SOCKET_DIR = Path(tempfile.gettempdir()) / f"popov-projector-{getattr(os, 'getuid', lambda: 'local')()}"
SOCKET = SOCKET_DIR / "control.sock"


wire_lock = threading.Lock()


def output(message, pcm=b""):
    header = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode()
    with wire_lock:
        dst = sys.stdout.buffer
        dst.write(struct.pack(">II", len(header), len(pcm)))
        dst.write(header)
        dst.write(pcm)
        dst.flush()


class PhraseCache:
    """Bound repeated phrases by both PCM bytes and count. RAM only."""
    def __init__(self, voice):
        self.voice = voice
        self.items = OrderedDict()
        self.bytes = 0

    def get(self, phrase):
        if phrase in self.items:
            self.items.move_to_end(phrase)
            return (*self.items[phrase], True)
        pcm, track = self.voice.synthesize_pcm(phrase)
        self.items[phrase] = (pcm, track)
        self.bytes += len(pcm)
        while self.bytes > 12 * 1024 * 1024 or len(self.items) > 48:
            _, (old, _) = self.items.popitem(last=False)
            self.bytes -= len(old)
        return pcm, track, False


class Player:
    def __init__(self):
        self.lock = threading.Condition()
        self.tasks = deque()
        self.history = OrderedDict()
        self.active = None
        self.stopped = False
        self.ready = False
        self.error = None
        self.exit = False
        self.visitor_server = None

    def status(self):
        return dict(ready=self.ready, stopped=self.stopped, waiting=len(self.tasks),
                    active=self.active, error=self.error)

    def run(self):
        try:
            cache = None
            if not os.getenv("POPOV_SERVER_URL"):
                from speech_core import SpeechCore, choose_answer
                cache = PhraseCache(SpeechCore())
                for question in ("Приёмник", "Кто вы?", "Что такое радио?", "Привет", "Спасибо", "?"):
                    cache.get(phrases(choose_answer(question))[0])
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                output(dict(type="error", message=self.error))
            return
        with self.lock:
            self.ready = True
            output(dict(type="ready"))
        while True:
            with self.lock:
                self.lock.wait_for(lambda: self.exit or (self.tasks and not self.active and not self.stopped))
                if self.exit: return
                key, text, expiry, received = self.tasks.popleft()
                self.active = key
            try:
                if time.time() > expiry: raise ValueError("Истёк срок команды")
                record = self.history[key]
                if record.get("story"):
                    with self.lock:
                        if self.active == key:
                            record.update(state="prepared", chunks=1, played_chunks=0)
                            output(dict(type="story", id=key, expiry=expiry, guide=record["story"]))
                    continue
                external = record.pop("external", None)
                chunks = [text] if external else phrases(text)
                for index, phrase in enumerate(chunks):
                    with self.lock:
                        self.lock.wait_for(lambda: self.active != key or
                                           index - record.get("played_chunks", 0) < 3)
                        if self.active != key: break
                    if external:
                        pcm, track = external
                        cached = False
                    else:
                        if cache is None:
                            from speech_core import SpeechCore
                            cache = PhraseCache(SpeechCore())
                        pcm, track, cached = cache.get(phrase)
                    if index + 1 < len(chunks):
                        pcm += bytes(2 * phrase_gap(phrase))
                    with self.lock:
                        if self.active != key: break
                        if index == 0:
                            if time.time() > expiry: raise ValueError("Истёк срок команды")
                            record.update(state="prepared", chunks=len(chunks), played_chunks=0, first_cached=cached)
                        if record.get("visitor"):
                            # Align this portrait track with the same scheduled PCM as the projector.
                            offset = record.get("samples", 0) / 22050
                            poses = record.setdefault("poses", [])
                            poses.extend([round(offset + a, 3), pose] for a, _, pose in track["cues"])
                            poses.append([round(offset + track["seconds"], 3), "rest"])
                        record["samples"] = record.get("samples",0) + len(pcm)//2
                        output(dict(type="play", id=key, index=index, last=index==len(chunks)-1,
                                    **track, expiry=expiry), pcm)
            except Exception as exc:
                with self.lock:
                    if self.active == key:
                        self.history[key].update(state="failed", reason=str(exc), ended_at=time.monotonic())
                        self.active = None
                        output(dict(type="abort", id=key, message=str(exc)))

    def cancel(self):
        for key, *_ in self.tasks:
            self.history[key].pop("external", None)
            self.history[key].update(state="cancelled", ended_at=time.monotonic())
        self.tasks.clear()
        if self.active: self.history[self.active].update(state="cancelled", ended_at=time.monotonic())
        self.active = None
        self.lock.notify_all()

    def handle(self, msg, internal=False):
        with self.lock:
            cmd = msg.get("command")
            key = msg.get("id", "")
            if not isinstance(key, str) or len(key) > 128: raise ValueError("Некорректный id")
            if cmd == "visitors":
                if os.getenv("POPOV_SERVER_URL"):
                    return {"message": "QR обновляется сервером автоматически"}
                from visitor import network_warning, start, visitor_url
                try:
                    if self.visitor_server is None:
                        self.visitor_server = start(self, os.environ.get("POPOV_VISITOR_BIND", "0.0.0.0"),
                                                    int(os.environ["POPOV_VISITOR_PORT"]) if "POPOV_VISITOR_PORT" in os.environ else None)
                    url = visitor_url(self.visitor_server)
                except (OSError, ValueError) as exc:
                    message = "Не удалось открыть вход для посетителей: " + str(exc)
                    if internal: output(dict(type="error", message=message))
                    raise ValueError(message) from exc
                host, port = self.visitor_server.server_address
                if host == "0.0.0.0":
                    host = "127.0.0.1"
                preview = f"http://{host}:{port}/popov.html"
                warning = network_warning()
                output(dict(type="visitors", url=url, preview=preview, warning=warning, open=internal))
                return {"url": url, "preview": preview, "warning": warning}
            if cmd == "status": return self.status()
            if cmd == "event":
                record = self.history.get(key)
                return {"state":"unknown"} if not record else {k:v for k,v in record.items() if k not in ("digest","received","ended_at","visitor","poses","started_at")}
            if cmd == "stop":
                self.stopped = True
                self.cancel()
                output(dict(type="stop"))
            elif cmd == "resume":
                self.stopped = False
                output(dict(type="resume"))
            elif cmd in ("started","played","finished","failed") and internal:
                if self.active == key:
                    record = self.history[key]
                    if cmd != "played": record["state"] = cmd
                    if cmd == "started":
                        record["started_at"] = time.monotonic()
                        record["started_ms"] = round((time.monotonic()-record["received"])*1000)
                        output(dict(type="timing", ms=record["started_ms"]))
                    elif cmd == "played":
                        record["played_chunks"] = max(record["played_chunks"], int(msg["index"])+1)
                        record["underruns"] = int(msg.get("underruns",0))
                    else:
                        record["ended_at"] = time.monotonic()
                        self.active = None
            elif cmd in ("say", "ask") or (cmd == "story" and internal):
                speech = msg.get("text")
                if cmd == "story" and speech != "minin":
                    raise ValueError("Неизвестный рассказ")
                if not isinstance(speech, str) or not speech.strip() or len(speech)>(400 if cmd=="ask" else MAX_TEXT):
                    raise ValueError("Нужен текст до 32 000 знаков или вопрос до 400 знаков")
                key = key or str(uuid.uuid4())
                digest = hashlib.sha256((cmd + "\0" + speech).encode()).hexdigest()
                if key in self.history:
                    if self.history[key]["digest"] != digest: raise ValueError("Этот id уже занят другой репликой")
                    return dict(id=key,state=self.history[key]["state"])
                if not self.ready or self.stopped: raise ValueError("Проигрыватель не готов или остановлен")
                if cmd == "story" and (self.tasks or self.active):
                    raise ValueError("Проигрыватель занят")
                interrupt = msg.get("interrupt") is True
                if not interrupt and len(self.tasks) >= 5: raise ValueError("Очередь заполнена")
                expiry = float(msg.get("expiry", time.time()+90))
                if not time.time() < expiry <= time.time()+301: raise ValueError("Срок команды должен быть в ближайшие 5 минут")
                received = time.monotonic()
                if cmd == "ask":
                    from speech_core import choose_answer
                    speech = choose_answer(speech)
                if interrupt:
                    if speech.count("**") % 2 or not any(c.isalnum() for c in speech):
                        raise ValueError("Проверьте текст и выделения.")
                    self.cancel()
                    output(dict(type="interrupt"))
                self.tasks.append((key,speech.strip(),expiry,received))
                self.history[key] = dict(state="queued",digest=digest,received=received,
                                         story=speech if cmd=="story" else None)
                if len(self.history)>1024: self.history.popitem(last=False)
                self.lock.notify_all()
                return dict(id=key,state="queued")
            else: raise ValueError("Неизвестная команда")
            self.lock.notify_all()
            return self.status()


def main():
    import fcntl
    from remote import configure, start as start_remote
    remote_mode = configure()
    SOCKET_DIR.mkdir(mode=0o700, exist_ok=True)
    if SOCKET_DIR.is_symlink() or SOCKET_DIR.stat().st_uid != os.getuid() or SOCKET_DIR.stat().st_mode & 0o077:
        raise RuntimeError("Недоступен закрытый каталог управления")
    guard = (SOCKET_DIR/"instance.lock").open("a")
    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    SOCKET.unlink(missing_ok=True)
    local_api = None
    if os.getenv("POPOV_LOCAL_SERVER") == "1":
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from server.local import LocalServer
        local_api = LocalServer()
    player = Player()
    def request(raw, internal=False):
        try:
            if len(raw)>MAX_WIRE: raise ValueError("Слишком большая команда")
            msg = json.loads(raw)
            if not isinstance(msg,dict): raise ValueError("Ожидался объект JSON")
            return player.handle(msg,internal)
        except (TypeError, ValueError, OverflowError) as exc: return dict(error=str(exc))
    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.connection.settimeout(3)
            result = request(self.rfile.readline(MAX_WIRE+1))
            self.wfile.write((json.dumps(result,ensure_ascii=False)+"\n").encode())
    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True
    server = Server(str(SOCKET),Handler)
    os.chmod(SOCKET,0o600)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    threading.Thread(target=player.run,daemon=True).start()
    if remote_mode:
        start_remote(player, output)
    try:
        for line in sys.stdin.buffer:
            result = request(line,True)
            if result.get("error"): output(dict(type="error",message=result["error"]))
    finally:
        player.exit = True
        with player.lock:
            player.lock.notify_all()
        if player.visitor_server is not None:
            player.visitor_server.shutdown()
            player.visitor_server.server_close()
        server.server_close()
        if local_api is not None:
            local_api.close()
        SOCKET.unlink(missing_ok=True)

if __name__ == "__main__": main()
