"""Install pinned speech and recognition assets after checksum verification."""
import hashlib
from pathlib import Path
import subprocess
import tempfile

REVISION = "0ca208afc2a2ee102b1e961e72e0a7e4907be3d0"
BASE = f"https://huggingface.co/rhasspy/piper-voices/resolve/{REVISION}/ru/ru_RU/denis/medium"
ASR_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1"
FILES = {
    "ggml-base-q5_1.bin": "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    "ru_RU-denis-medium.onnx": "879bc365cb14d1380e3f5ed6044162ccf54c99f6161871569b7f830aec3ce841",
    "ru_RU-denis-medium.onnx.json": "5891b94580ae739a8cdc5d17591db6800333f85164d13599aca893883d99b9eb",
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def install():
    folder = Path(__file__).resolve().parents[1] / "Голос"
    folder.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder) as staging:
        for name, expected in FILES.items():
            installed = folder / name
            if installed.is_file() and digest(installed) == expected:
                continue
            target = Path(staging) / name
            subprocess.run(["curl", "--fail", "--location", "--retry", "3",
                            "--output", target, f"{ASR_BASE if name.endswith('.bin') else BASE}/{name}"], check=True)
            if digest(target) != expected:
                raise RuntimeError(f"Контрольная сумма файла {name} не совпала.")
        for target in Path(staging).iterdir():
            target.replace(folder / target.name)


if __name__ == "__main__":
    install()
