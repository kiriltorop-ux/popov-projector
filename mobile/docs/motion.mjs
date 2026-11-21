const preference = matchMedia('(prefers-reduced-motion: reduce)');
const settle = 'cubic-bezier(.16, 1, .3, 1)';
let movingPortrait = null;

export function reveal(element, { duration = 220, distance = 6, opacity = .67 } = {}) {
  if (!element?.animate || preference.matches) return;
  element.animate([
    { opacity, translate: `0 ${distance}px` },
    { opacity: 1, translate: '0 0' },
  ], { duration, easing: settle });
}

export function stopPortraitMotion() {
  movingPortrait?.stop();
}

function visibleBox(element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
    box.top < window.innerHeight && box.left < window.innerWidth ? box : null;
}

export function rememberPortrait(element) {
  if (!element?.animate || preference.matches || document.hidden) {
    stopPortraitMotion();
    return null;
  }
  const current = movingPortrait?.target === element ? movingPortrait.layer : null;
  const snapshot = current?.firstElementChild || element;
  const box = visibleBox(current || element);
  const style = getComputedStyle(snapshot);
  const before = box && {
    box,
    artwork: snapshot.cloneNode(true),
    fit: style.objectFit,
    radius: style.borderRadius,
  };
  stopPortraitMotion();
  return before;
}

export function movePortrait(before, target) {
  if (!before || !target?.animate || preference.matches || document.hidden) return false;
  const box = visibleBox(target);
  if (!box) return false;
  const scale = before.box.width / box.width;
  // Different crops crossfade in place so the moving face keeps its proportions.
  if (Math.abs(before.box.height / (box.height * scale) - 1) > .12) return false;
  const layer = document.createElement('div');
  layer.className = 'moving-portrait';
  layer.setAttribute('aria-hidden', 'true');
  layer.append(before.artwork);
  Object.assign(layer.style, {
    left: `${box.left}px`, top: `${box.top}px`,
    width: `${box.width}px`, height: `${box.height}px`,
  });
  before.artwork.style.objectFit = before.fit;
  document.body.append(layer);
  target.classList.add('portrait-in-motion');

  const x = before.box.left - box.left;
  const y = before.box.top - box.top;
  const animation = layer.animate([
    { transform: `translate(${x}px, ${y}px) scale(${scale})`, borderRadius: before.radius },
    { transform: 'none', borderRadius: getComputedStyle(target).borderRadius },
  ], { duration: 245, easing: settle, fill: 'both' });

  function stop() {
    if (movingPortrait?.stop !== stop) return;
    movingPortrait = null;
    animation.cancel();
    layer.remove();
    target.classList.remove('portrait-in-motion');
  }
  movingPortrait = { layer, target, stop };
  animation.finished.then(stop, stop);
  return true;
}

preference.addEventListener('change', event => {
  if (event.matches) stopPortraitMotion();
});
window.addEventListener('resize', stopPortraitMotion);
window.addEventListener('scroll', stopPortraitMotion, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPortraitMotion();
});
