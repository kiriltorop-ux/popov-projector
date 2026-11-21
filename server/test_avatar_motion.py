import math

import pytest

from server.avatar_motion import Motion, mesh, sample


def test_idle_moves_and_speech_eases_in_and_out():
    motion = Motion()
    idle = [motion.step(n/30) for n in range(90)]
    assert max(s[0] for s in idle)-min(s[0] for s in idle) > .01
    track = {"fps": 50, "energy": [.8]*200, "accent": [.6]*200}
    motion.step(3., track, 0.)
    assert 0 < motion.speaking < .5
    for n in range(91, 120):
        motion.step(n/30, track, n/30-3)
    assert motion.speaking > .95 and motion.energy > .7
    for n in range(120, 180):
        state = motion.step(n/30)
        assert all(math.isfinite(v) for v in state)
    assert motion.speaking < .001 and motion.energy < .001


def test_mesh_keeps_feet_planted_and_motion_inside_padding():
    motion = Motion()
    for n in range(270):
        state = motion.step(n/30)
        cells = mesh(400, 1000, 35, state)
        for rect, quad in cells:
            assert all(math.isfinite(v) for v in quad)
            # Inverse-mapped bottom corners have no sideways skating.
            if rect[3] == 1070:
                assert quad[2] == pytest.approx(rect[0], abs=.001)
                assert quad[3] == pytest.approx(rect[3], abs=.001)
        assert abs(state[0])*1000 < 35


def test_blink_is_brief_and_audio_curve_interpolates():
    motion = Motion()
    assert motion.step(2.53)[4] == 1
    assert motion.step(2.8)[4] == 0
    assert sample({"energy": [0, 1], "fps": 50}, "energy", .01) == .5
    assert sample({"energy": [0, 1], "fps": 50}, "energy", -1) == 0
