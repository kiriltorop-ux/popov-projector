"""Prepare local-host mode while preserving existing provider credentials."""
import os
from pathlib import Path
import secrets
import sys


def configure(root):
    root = Path(root)
    file = root / ".env"
    text = file.read_text(encoding="utf-8-sig") if file.exists() else ""
    lines = []
    for line in text.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ("QR_SECRET", "STATION_KEY") and (not value.strip() or value.strip().strip('"\'').startswith("replace-")):
            line = key.strip() + "=" + secrets.token_hex(32)
        lines.append(line)
    text = "\n".join(lines)
    keys = {line.partition("=")[0].strip() for line in text.splitlines() if "=" in line}
    defaults = {"LLM_BASE_URL": "https://api.deepseek.com", "LLM_MODEL": "deepseek-chat",
        "LLM_API_KEY": "replace-with-deepseek-key", "ASR_BASE_URL": "https://api.groq.com/openai/v1",
        "ASR_MODEL": "whisper-large-v3-turbo", "ASR_API_KEY": "replace-with-groq-key",
        "TTS_BACKEND": "piper", "DATABASE": "work/popov.sqlite3", "POPOV_LOCAL_PORT": "18776",
        "QR_SECRET": secrets.token_hex(32), "STATION_KEY": secrets.token_hex(32)}
    extra = "".join(f"{key}={value}\n" for key, value in defaults.items() if key not in keys)
    file.write_text(text.rstrip()+"\n"+extra, encoding="utf-8")
    file.chmod(0o600)
    station = root / "station.env"
    station.write_text("POPOV_LOCAL_SERVER=1\n", encoding="utf-8")
    station.chmod(0o600)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    configure(root)
    if "--check" in sys.argv:
        values = dict(line.split("=", 1) for line in (root / ".env").read_text(encoding="utf-8").splitlines() if "=" in line and not line.startswith("#"))
        key = values.get("LLM_API_KEY", "").strip().strip('"\'')
        guide = os.getenv("POPOV_GUIDE", values.get("POPOV_GUIDE", "popov")).strip().strip('"\'')
        if guide != "minin" and (not key or key.startswith("replace-")):
            print("Set LLM_API_KEY in .env before starting the projector.")
            raise SystemExit(1)
