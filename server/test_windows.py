import io
import wave

import pytest

from server.windows import wav_bytes, pose_at


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
