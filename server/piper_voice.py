"""Synthesize PCM and time its animation to the actual Piper phonemes."""
import base64
from pathlib import Path
import sys
import threading

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def load_core(voice):
    sources = ROOT / "Исходники"
    if str(sources) not in sys.path:
        sys.path.insert(0, str(sources))
    from speech_core import SpeechCore
    return SpeechCore(ROOT/"Голос"/(voice+".onnx"), pace=1.1 if voice == "ru_RU-dmitri-medium" else 1.)


def piper_payload(core, text, voice="ru_RU-denis-medium"):
    from narration import phrases, phrase_gap
    chunks = phrases(text)
    blocks, cues, curves = [], [], []
    samples = 0
    for index, phrase in enumerate(chunks):
        # Force the original calm delivery, rather than topic-based auto excitement.
        pcm, track = core.synthesize_pcm("[спокойно] " + phrase)
        offset = samples / 22050
        blocks.append(pcm)
        cues.extend([round(offset+a, 6), round(offset+b, 6), pose] for a, b, pose in track["cues"])
        curves.append((offset, track))
        samples += len(pcm) // 2
        if index + 1 < len(chunks):
            gap = phrase_gap(phrase, 22050)
            cues.append([samples/22050, (samples+gap)/22050, "rest"])
            blocks.append(bytes(gap*2))
            samples += gap
    if not samples or samples > 22050*120:
        raise ValueError("Piper speech must be 0–120 seconds")
    seconds = samples / 22050
    frames = np.arange(int(np.ceil(seconds*50))+1)/50
    result = {"cues": cues, "fps": 50, "seconds": seconds}
    for field in ("energy", "accent"):
        values = np.zeros(len(frames))
        for offset, local in curves:
            mask = (frames >= offset) & (frames < offset+local["seconds"])
            values[mask] = np.interp((frames[mask]-offset)*50, np.arange(len(local[field])), local[field])
        result[field] = values.round(4).tolist()
    return {"pcm": base64.b64encode(b"".join(blocks)).decode(), "track": result,
            "sample_rate": 22050, "voice": voice, "alignment": "phonemes"}


class PiperNarrator:
    def __init__(self, voice):
        self.voice = voice
        self.core = None
        self.lock = threading.Lock()

    def speech(self, text):
        with self.lock:
            if self.core is None:
                self.core = load_core(self.voice)
            return piper_payload(self.core, text, self.voice)
