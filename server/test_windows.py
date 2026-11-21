import io
import queue
import sys
from types import SimpleNamespace
import wave

import pytest

from server.windows import Projector, wav_bytes, pose_at
from PIL import Image


def test_windows_wav_has_expected_pcm_clock():
    pcm = bytes(4410*2)
    with wave.open(io.BytesIO(wav_bytes(pcm)), "rb") as wav:
        assert wav.getframerate() == 22050
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2
        assert wav.getnframes() == 4410
        assert wav.readframes(4410) == pcm


@pytest.mark.parametrize("pcm,rate", [(b"", 22050), (b"x", 22050), (b"xx", 24000)])
def test_invalid_windows_audio_is_rejected(pcm, rate):
    with pytest.raises(ValueError):
        wav_bytes(pcm, rate)


def test_windows_mouth_changes_on_audio_timeline():
    track = {"cues": [[0, .2, "rest"], [.2, .4, "open"], [.4, .5, "soft"]]}
    assert pose_at(track, .1) == "rest"
    assert pose_at(track, .2) == "open"
    assert pose_at(track, .41) == "soft"
    assert pose_at(track, .6) == "rest"


def test_windows_story_fades_in_plays_and_restores_the_avatar(monkeypatch):
    sound = []
    states = []
    monkeypatch.setitem(sys.modules, "winsound", SimpleNamespace(
        PlaySound=lambda path, flags: sound.append((path, flags)),
        SND_FILENAME=1, SND_ASYNC=2, SND_NODEFAULT=4,
    ))
    player = Projector.__new__(Projector)
    player.host = SimpleNamespace(state=lambda key, status: states.append((key, status)))
    player.Image = Image
    player.current = "minin-story"
    player.story_requested, player.began = 100., 0.
    player.story_next = player.story_image = None
    decoder = SimpleNamespace(info=None, frames=queue.Queue(), audio="story.wav", error=None, eof=False,
                              close=lambda: sound.append("closed"))
    player.story = decoder
    assert player.story_frame(100, 1920, 1080) == (None, 1.)
    assert states == []
    decoder.info = {"fps": 25, "size": (16, 9), "duration": 70.52}
    decoder.frames.put((0, bytes(16 * 9 * 3)))
    assert player.story_frame(101, 1920, 1080) == (None, 1.)
    assert player.story_frame(101.1, 1920, 1080)[1] == pytest.approx(.5)
    frame, visible = player.story_frame(102, 1920, 1080)
    assert frame.size == (1920, 1080) and visible == 0.
    assert sound == [("story.wav", 7)] and states == [("minin-story", "started")]
    assert player.story_frame(171.4, 1920, 1080)[1] == pytest.approx(.52)
    decoder.eof = True
    assert player.story_frame(171.53, 1920, 1080) == (None, 1.)
    assert player.story is player.current is None
    assert states[-1] == ("minin-story", "finished")
    assert sound[-2:] == [(None, 0), "closed"]
