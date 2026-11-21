"""Read one bounded media attachment on stdin, emit a Russian transcript on stdout."""
from pathlib import Path
import subprocess
import sys

import imageio_ffmpeg
import numpy as np
from pywhispercpp.model import Model


def transcribe(audio):
    # Decode only audio containers from stdin, keeping output and CPU time bounded.
    decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error",
        "-protocol_whitelist", "pipe", "-format_whitelist", "wav,mp3,ogg,matroska,webm,mov,aac,flac",
        "-i", "pipe:0", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-t", "20.1",
        "-f", "f32le", "pipe:1"], input=audio, capture_output=True, timeout=5, check=True)
    signal = np.frombuffer(decoded.stdout, dtype="<f4")
    if not 16000 <= len(signal) <= 320000 or not np.isfinite(signal).all() or np.max(np.abs(signal)) < .004:
        raise ValueError("Нужна запись речи от 1 до 20 секунд.")
    weights = Path(__file__).resolve().parents[1] / "Голос" / "ggml-base-q5_1.bin"
    if not weights.is_file():
        raise RuntimeError("Модель распознавания не установлена.")
    model = Model(str(weights), n_threads=4, language="ru", print_progress=False,
                  print_realtime=False, print_timestamps=False, no_context=True)
    return " ".join(segment.text.strip() for segment in model.transcribe(signal)).strip()


if __name__ == "__main__":
    print(transcribe(sys.stdin.buffer.read(10 * 1024 * 1024 + 1)))
