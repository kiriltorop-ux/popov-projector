"""Run the API on the same computer as the native projector, without a VPS."""
import ipaddress
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit


def load_env(root):
    file = root / ".env"
    if file.is_file():
        for line in file.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def lan_address():
    """Prefer the active macOS interface; never advertise loopback to phones."""
    override = os.getenv("POPOV_LAN_HOST")
    if override:
        return override
    if sys.platform == "darwin":
        for interface in ("en0", "en1", "en2"):
            proc = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", interface],
                                  capture_output=True, text=True, timeout=2)
            value = proc.stdout.strip()
            if value:
                return str(ipaddress.IPv4Address(value))
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        try:
            # UDP connect selects an interface; it does not send a packet.
            route.connect(("192.0.2.1", 80))
            value = route.getsockname()[0]
            if not ipaddress.ip_address(value).is_loopback:
                return value
        except OSError:
            pass
    return socket.gethostname().split(".")[0] + ".local"


def valid_public_url(value):
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        return False
    if parsed.scheme == "https" and parsed.hostname:
        return True
    if parsed.scheme != "http" or not parsed.hostname:
        return False
    if parsed.hostname == "localhost" or parsed.hostname.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(parsed.hostname)
        return address.is_private and not address.is_unspecified and not address.is_multicast
    except ValueError:
        return False


class LocalServer:
    def __init__(self, root=None, port=None, provider=None):
        import uvicorn
        from .app import create_app
        root = Path(root) if root else Path(__file__).resolve().parents[1]
        load_env(root)
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            self.socket.bind(("0.0.0.0", int(os.getenv("POPOV_LOCAL_PORT", "18776")) if port is None else port))
            actual_port = self.socket.getsockname()[1]
            host = lan_address()
            self.public_url = os.getenv("POPOV_LOCAL_PUBLIC_URL", f"http://{host}:{actual_port}").rstrip("/")
            self.bridge_url = f"http://127.0.0.1:{actual_port}"
            database = Path(os.getenv("DATABASE", "work/popov.sqlite3"))
            if not database.is_absolute():
                database = root / database
            self.app = create_app(path=database, provider=provider, public_url=self.public_url)
            self.server = uvicorn.Server(uvicorn.Config(self.app, log_level="warning", access_log=False,
                                                      proxy_headers=False))
            self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.socket]}, daemon=True)
            self.thread.start()
            deadline = time.monotonic() + 10
            while not self.server.started:
                if not self.thread.is_alive() or time.monotonic() >= deadline:
                    raise RuntimeError("Не удалось запустить сервер на компьютере проектора.")
                time.sleep(.02)
            os.environ["POPOV_SERVER_URL"] = self.bridge_url
            os.environ["POPOV_STATION_KEY"] = os.environ["STATION_KEY"]
        except Exception:
            self.socket.close()
            raise

    def close(self):
        self.server.should_exit = True
        self.thread.join(timeout=5)
        self.socket.close()
