"""Opt-in live integration check (makes small, paid LLM/ASR requests).

Run: python -m server.check_providers after configuring .env.
Never prints credentials or provider error bodies.
"""
import base64
import io
import os
from pathlib import Path
import wave

from .providers import Provider


def main():
    root = Path(__file__).resolve().parents[1]
    for line in (root / ".env").read_text(encoding="utf-8-sig").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            os.environ.setdefault(key, value.strip())
    provider = Provider()
    failures = 0
    try:
        text = provider.answer("Как работает ваш приёмник?", [], "ru")
        print("LLM OK:", text)
    except Exception as exc:
        print("LLM FAILED:", type(exc).__name__)
        return 1
    for language, sample in (("ru", "Здравствуйте. Я Александр Попов."), ("en", "Hello. I am Alexander Popov.")):
        try:
            result = provider.speech(sample, language, "onyx")
            print("TTS OK:", language, round(result["track"]["seconds"], 2), "seconds")
            if language == "ru":
                buffer = io.BytesIO()
                with wave.open(buffer, "wb") as wav:
                    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(22050)
                    wav.writeframes(base64.b64decode(result["pcm"]))
                try:
                    transcript = provider.transcribe(buffer.getvalue(), "check.wav", "ru")
                    print("ASR OK:", transcript)
                except Exception as exc:
                    failures += 1
                    print("ASR FAILED:", type(exc).__name__)
        except Exception as exc:
            failures += 1
            print("TTS FAILED:", language, type(exc).__name__)
    return int(failures > 0)


if __name__ == "__main__":
    raise SystemExit(main())
