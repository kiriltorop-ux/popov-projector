"""Local development entry point. Docker passes environment directly."""
import os
from pathlib import Path

import uvicorn

if __name__ == "__main__":
    file = Path(__file__).resolve().parents[1] / ".env"
    if file.exists():
        for line in file.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.partition("=")
            if sep and key and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    uvicorn.run("server.app:create_app", factory=True, host="127.0.0.1", port=8000, access_log=False)
