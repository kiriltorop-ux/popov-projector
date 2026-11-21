import base64
import sys
from pathlib import Path

import pytest

from server.piper_voice import piper_payload
from server.windows import projection_layout

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"Исходники"))


class FakeCore:
    def __init__(self):
        self.texts = []

    def synthesize_pcm(self, text):
        self.texts.append(text)
        return bytes(4410), {"seconds": .1, "cues": [[0, .1, "open"]],
                             "fps": 50, "energy": [.6]*6, "accent": [.2]*6}


def test_original_voice_keeps_pcm_and_phoneme_timeline():
    core = FakeCore()
    result = piper_payload(core, "Здравствуйте. Это мой приёмник.")
    pcm = base64.b64decode(result["pcm"])
    assert result["voice"] == "ru_RU-denis-medium"
    assert result["alignment"] == "phonemes"
    assert all(text.startswith("[спокойно] ") for text in core.texts)
    assert result["track"]["seconds"] == len(pcm)/2/22050
    assert len(result["track"]["energy"]) == len(result["track"]["accent"])
    assert result["track"]["cues"][0][0] == 0
    assert all(cue[1] <= result["track"]["seconds"]+1e-6 for cue in result["track"]["cues"])


@pytest.mark.parametrize("width,height", [(640,800),(960,540),(1920,1080),(1280,720)])
def test_projection_qr_is_in_lower_corner_within_frame(width, height):
    layout = projection_layout(width,height,556/1383)
    q = layout["qr_size"]
    x,y = layout["qr_center"]
    assert x > width*.65 and y > height*.65
    assert 0 < x-q/2 < x+q/2 < width
    assert 0 < y-q/2 < y+q/2 < height
    w,h = layout["actor_size"]
    assert h > height*.9 and w < width
