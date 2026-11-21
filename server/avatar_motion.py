"""Continuous, foot-anchored motion for the cutout, driven by the speech track."""
import math


def sample(track, name, seconds):
    values = (track or {}).get(name, [])
    position = seconds * (track or {}).get("fps", 50)
    if not values or not 0 <= position < len(values):
        return 0.
    left = int(position)
    return values[left] + (values[min(left+1, len(values)-1)]-values[left])*(position-left)


class Motion:
    def __init__(self):
        self.last = None
        self.speaking = self.energy = self.accent = 0.

    def step(self, clock, track=None, seconds=-1):
        dt = min(.1, max(0, clock-self.last)) if self.last is not None else 0.
        self.last = clock
        # Smooth changes between rest, phonemes, pauses and the end of a reply.
        for field, target, rate in (("speaking", float(track is not None), 4.),
                                     ("energy", sample(track, "energy", seconds), 7.),
                                     ("accent", sample(track, "accent", seconds), 5.)):
            value = getattr(self, field)
            setattr(self, field, value+(target-value)*(1-math.exp(-dt*rate)))
        sway = (.012*math.sin(clock*.87) + .005*math.sin(clock*.49+.4))
        sway += self.speaking*.006*math.sin(clock*1.53+.8)
        tilt = (.009*math.sin(clock*1.17+.5) + self.speaking*.008*math.sin(clock*1.91))
        nod = self.speaking*(.0025*math.sin(clock*2.3)+.003*self.accent)
        breath = .0035*math.sin(clock*1.38) + .003*self.energy
        cycle = clock % 8.9
        blink = max(0., 1-min(abs(cycle-2.53), abs(cycle-7.61))/.105)
        return sway, tilt, nod, breath, blink, min(.5, self.accent*self.energy)


def mesh(width, height, pad, state):
    """Inverse PIL mesh: planted feet, flexible torso and a gently tilted head."""
    sway, tilt, nod, breath = state[:4]
    full_w, full_h = width+2*pad, height+2*pad
    def source(x, y):
        relative = (y-pad)/height
        upper = max(0., min(1., (1-relative-.24)/.76))
        neck = max(0., min(1., (.22-relative)/.13))
        chest = math.exp(-((relative-.32)/.18)**2)
        middle = x-full_w/2
        dx = height*sway*upper*upper + height*tilt*max(0., .20-relative)
        dy = middle*(sway*upper+tilt*neck)+height*nod*neck
        return (x-dx-middle*breath*chest, y-dy)
    result = []
    for row in range(24):
        top, bottom = round(row*full_h/24), round((row+1)*full_h/24)
        for column in range(3):
            left, right = round(column*full_w/3), round((column+1)*full_w/3)
            quad = (*source(left,top), *source(left,bottom),
                    *source(right,bottom), *source(right,top))
            result.append(((left,top,right,bottom), quad))
    return result
