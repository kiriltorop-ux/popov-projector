"""Download only the exact repository Denis model, verifying both SHA-256 hashes."""
import importlib.util
from pathlib import Path
import tempfile
from urllib.request import urlopen


def install(root=None):
    root = Path(root) if root else Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("voice_assets", root/"Исходники"/"install_voice.py")
    manifest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manifest)
    folder = root/"Голос"
    folder.mkdir(exist_ok=True)
    for name, expected in manifest.FILES.items():
        if not name.startswith("ru_RU-denis"):
            continue
        target = folder/name
        if target.exists() and manifest.digest(target) == expected:
            continue
        with tempfile.NamedTemporaryFile(dir=folder, delete=False, suffix=".download") as stream:
            staging = Path(stream.name)
            try:
                with urlopen(manifest.BASE+"/"+name, timeout=60) as response:
                    while chunk := response.read(1024*1024):
                        stream.write(chunk)
            except Exception:
                staging.unlink(missing_ok=True)
                raise
        if manifest.digest(staging) != expected:
            staging.unlink(missing_ok=True)
            raise RuntimeError("Voice checksum mismatch: "+name)
        staging.replace(target)
    print("Denis voice verified (repository SHA-256).")


if __name__ == "__main__":
    install()
