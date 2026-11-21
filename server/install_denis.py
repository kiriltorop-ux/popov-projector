"""Install the pinned Russian station voices and verify their checksums."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from urllib.request import urlopen


def install(root=None, all_guides=False):
    root = Path(root) if root else Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("voice_assets", root/"Исходники"/"install_voice.py")
    manifest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manifest)
    folder = root/"Голос"
    folder.mkdir(exist_ok=True)
    from .local import load_env
    load_env(root)
    files = {name: expected for name, expected in manifest.FILES.items()
             if name.startswith("ru_RU-denis")}
    if all_guides or os.getenv("POPOV_GUIDE") == "minin":
        files.update({
            "ru_RU-dmitri-medium.onnx": "9ed9941bac7373f2ec1be36627e0e71a349a59ca5522d4363fd50701db05193a",
            "ru_RU-dmitri-medium.onnx.json": "c3741c9c1558fc38e902fd80d39155c32a7d019d7d17e3a43eac66b7bd3fbe09",
        })
    for name, expected in files.items():
        target = folder/name
        if target.exists() and manifest.digest(target) == expected:
            continue
        with tempfile.NamedTemporaryFile(dir=folder, delete=False, suffix=".download") as stream:
            staging = Path(stream.name)
            try:
                voice = name.split("-")[1]
                base = manifest.BASE.replace("/denis/", f"/{voice}/")
                with urlopen(base+"/"+name, timeout=60) as response:
                    while chunk := response.read(1024*1024):
                        stream.write(chunk)
            except Exception:
                staging.unlink(missing_ok=True)
                raise
        if manifest.digest(staging) != expected:
            staging.unlink(missing_ok=True)
            raise RuntimeError("Voice checksum mismatch: "+name)
        staging.replace(target)
    print("Station voices verified (SHA-256).")


if __name__ == "__main__":
    install(all_guides="--all" in sys.argv)
