"""Outbound-only station bridge. The museum Mac needs no public inbound port."""
import base64
import json
import logging
import os
from pathlib import Path
import threading
import time
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlsplit

log = logging.getLogger("popov.station")


def configure():
    file = Path(__file__).resolve().parents[1] / "station.env"
    if file.is_file():
        for line in file.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key in ("POPOV_SERVER_URL", "POPOV_STATION_KEY", "POPOV_LOCAL_SERVER"):
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))
    return os.getenv("POPOV_LOCAL_SERVER") == "1" or bool(os.getenv("POPOV_SERVER_URL"))


class Bridge:
    def __init__(self, player, emit):
        self.player, self.emit = player, emit
        self.base = os.environ["POPOV_SERVER_URL"].rstrip("/")
        if not self.base.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
            raise ValueError("POPOV_SERVER_URL requires HTTPS")
        self.key = os.environ["POPOV_STATION_KEY"]
        # Same-computer traffic must never be routed through an HTTP proxy.
        self.http = build_opener(ProxyHandler({})) if urlsplit(self.base).hostname in ("127.0.0.1", "localhost", "::1") else build_opener()
        self.pending = {}
        self.last_url = None

    def post(self, path, data):
        request = Request(self.base + path, data=json.dumps(data).encode(), headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + self.key})
        with self.http.open(request, timeout=8) as response:
            raw = response.read(12*1024*1024+1)
            if len(raw) > 12*1024*1024:
                raise ValueError("Station response too large")
            return json.loads(raw)

    def tick(self):
        for key in list(self.pending):
            with self.player.lock:
                record = self.player.history.get(key, {})
                state = record.get("state", "failed")
            state = "prepared" if state in ("queued", "prepared") else state
            if state != self.pending[key]:
                self.post("/station/jobs/" + key, {"state": state})
                self.pending[key] = state
            if state in ("finished", "failed", "cancelled"):
                del self.pending[key]
        with self.player.lock:
            ready = self.player.ready and not self.player.stopped and not self.player.exit
        data = self.post("/station/poll", {"ready": ready})
        if data["url"] != self.last_url:
            self.last_url = data["url"]
            self.emit({"type": "visitors", "url": data["url"], "expires_at": data["expires_at"], "open": False})
        job = data.get("job")
        if job:
            pcm = base64.b64decode(job["pcm"], validate=True)
            if job.get("sample_rate") != 22050 or not 0 < len(pcm) <= 22050*2*120 or len(pcm) % 2:
                raise ValueError("Invalid server PCM")
            key = job["id"]
            try:
                with self.player.lock:
                    # Keep the lock until external audio is attached, before waking the player.
                    self.player.handle({"command": "say", "id": key, "text": job["text"], "expiry": job["expiry"]})
                    if self.player.history[key]["state"] == "queued":
                        self.player.history[key]["external"] = (pcm, job["track"])
            except ValueError:
                self.post("/station/jobs/" + key, {"state": "failed"})
                return
            self.pending.setdefault(key, None)

    def run(self):
        while not self.player.exit:
            try:
                self.tick()
            except Exception as exc:
                # Log only the error class: HTTP errors must not expose signed URLs or tokens.
                log.warning("Station connection failed: %s", type(exc).__name__)
            time.sleep(1)


def start(player, emit):
    bridge = Bridge(player, emit)
    threading.Thread(target=bridge.run, daemon=True).start()
    return bridge
