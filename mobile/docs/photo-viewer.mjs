import { icon } from './icons.mjs?v=river-design';

const maxScale = 5;
const midpoint = ([first, second]) => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});
const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function mountPhotoViewer(container) {
  const dialog = document.createElement('dialog');
  dialog.className = 'reply-photo-viewer';
  dialog.dataset.i18nLabel = 'Просмотр фотографии';
  dialog.innerHTML = `
    <div class="reply-photo-viewport"><img alt="" draggable="false"></div>
    <button type="button" class="photo-close" aria-label="Закрыть фото" data-i18n-label="Закрыть фото" autofocus>${icon('close')}</button>
    <div class="photo-zoom-controls">
      <button type="button" data-zoom="out" aria-label="Отдалить" data-i18n-label="Отдалить">−</button>
      <button type="button" data-zoom="in" aria-label="Приблизить" data-i18n-label="Приблизить">+</button>
    </div>
  `;
  document.body.append(dialog);

  const viewport = dialog.querySelector('.reply-photo-viewport');
  const image = viewport.querySelector('img');
  const zoomIn = dialog.querySelector('[data-zoom="in"]');
  const zoomOut = dialog.querySelector('[data-zoom="out"]');
  const pointers = new Map();
  let scale = 1;
  let x = 0;
  let y = 0;
  let start;
  let moved;
  let lastTap;

  function render() {
    const maxX = Math.max(0, (image.offsetWidth * scale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - viewport.clientHeight) / 2);
    x = clamp(x, -maxX, maxX);
    y = clamp(y, -maxY, maxY);
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    viewport.classList.toggle('is-zoomed', scale > 1);
    zoomIn.disabled = scale === maxScale;
    zoomOut.disabled = scale === 1;
  }

  function zoom(requested, from, to = from) {
    const next = clamp(requested, 1, maxScale);
    const ratio = next / scale;
    if (from) {
      const bounds = viewport.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      x = to.x - centerX - (from.x - centerX - x) * ratio;
      y = to.y - centerY - (from.y - centerY - y) * ratio;
    } else {
      x *= ratio;
      y *= ratio;
    }
    scale = next;
    render();
  }

  function position(event) {
    return {x: event.clientX, y: event.clientY};
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size === 2) return;
    const point = position(event);
    if (pointers.size === 0) {
      start = point;
      moved = false;
    } else {
      moved = true;
      lastTap = undefined;
    }
    pointers.set(event.pointerId, point);
    viewport.setPointerCapture(event.pointerId);
  });

  viewport.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = position(event);
    if (distance(start, point) > 8) {
      moved = true;
      lastTap = undefined;
    }
    const before = [...pointers.values()];
    pointers.set(event.pointerId, point);
    if (pointers.size === 2) {
      const after = [...pointers.values()];
      const oldDistance = distance(...before);
      const factor = oldDistance > 0 ? distance(...after) / oldDistance : 1;
      zoom(scale * factor, midpoint(before), midpoint(after));
    } else if (scale > 1) {
      zoom(scale, previous, point);
    }
  });

  function endPointer(event) {
    if (!pointers.delete(event.pointerId) || pointers.size || moved || event.type !== 'pointerup') return;
    const point = position(event);
    const {left, right, top, bottom} = image.getBoundingClientRect();
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) {
      dialog.close();
      return;
    }
    if (lastTap && event.timeStamp - lastTap.time < 350 && distance(lastTap.point, point) < 28) {
      zoom(scale > 1 ? 1 : 2, point);
      lastTap = undefined;
    } else {
      lastTap = {point, time: event.timeStamp};
    }
  }

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(type, endPointer);
  }
  dialog.addEventListener('wheel', event => {
    event.preventDefault();
    if (!viewport.contains(event.target)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    zoom(scale * Math.exp(-event.deltaY * unit / 300), position(event));
  }, {passive: false});
  zoomIn.addEventListener('click', () => zoom(scale * 1.5));
  zoomOut.addEventListener('click', () => zoom(scale / 1.5));
  dialog.querySelector('.photo-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) image.removeAttribute('src');
  });

  const resize = new ResizeObserver(() => { if (dialog.open) render(); });
  resize.observe(viewport);
  resize.observe(image);
  container.addEventListener('click', event => {
    const thumbnail = event.target.closest('.reply-photo-open')?.querySelector('img');
    if (!thumbnail || dialog.open) return;
    pointers.clear();
    lastTap = undefined;
    scale = 1;
    x = y = 0;
    image.src = thumbnail.currentSrc || thumbnail.src;
    image.alt = thumbnail.alt;
    dialog.showModal();
    render();
  });
  return dialog;
}
