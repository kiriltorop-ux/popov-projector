import { locale, t } from './i18n.mjs';

const cameraHint = 'Наведите камеру на QR-код на экране проектора.';
const systemCameraHint = 'Для сканирования камерой откройте приложение по HTTPS. На локальном HTTP браузер блокирует камеру.';
const wrongCode = 'Отсканируйте QR-код с экрана проектора.';

export function projectorQr(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) return null;
  const chat = ['/', '/popov.html'].includes(url.pathname) && /^#join=\d{1,12}\.[a-f0-9]{64}$/.test(url.hash);
  const story = url.pathname === '/listen.html' && /^#guide=(?:minin|chkalov|gorky|popov|gorodovoy)&key=[A-Za-z0-9_-]{32}$/.test(url.hash);
  return chat || story ? url : null;
}

let showScanner;
export function openQrScanner(options) {
  showScanner ??= bindScanner(document.getElementById('qr-scanner'));
  showScanner(options);
}

function bindScanner(dialog) {
  const $ = selector => dialog.querySelector(selector);
  const status = $('.qr-status');
  const preview = $('.qr-preview');
  const video = $('video');
  const camera = $('.qr-camera');
  const link = $('.qr-open');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  const canUseCamera = Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  let cameraActive = false;
  let generation = 0;
  let timer;
  let openStationChat;

  function setStatus(text) {
    const translated = t(text);
    if (status.textContent !== translated) status.textContent = translated;
  }

  function stopWork() {
    generation++;
    cameraActive = false;
    clearTimeout(timer);
    video.srcObject?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    preview.hidden = true;
  }

  function resetActions() {
    link.textContent = t('Открыть чат');
    link.hidden = true;
    link.removeAttribute('data-flow-link');
    link.removeAttribute('href');
    camera.hidden = true;
  }

  function decodeFrame(readQr) {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.drawImage(video, 0, 0, w, h);
    return readQr(context.getImageData(0, 0, w, h).data, w, h, {inversionAttempts: 'dontInvert'})?.data;
  }

  function acceptCode(text) {
    const url = projectorQr(text);
    if (!url) {
      setStatus(wrongCode);
      return false;
    }
    stopWork();
    const story = url.pathname === '/listen.html';
    if (!story && url.origin === location.origin && openStationChat) {
      dialog.close();
      openStationChat(new URLSearchParams(url.hash.slice(1)).get('join'));
    } else {
      const fragment = new URLSearchParams(url.hash.slice(1));
      fragment.set('lang', locale());
      if (!story) url.pathname = '/popov.html';
      url.hash = fragment.toString();
      if (url.origin === location.origin) {
        location.assign(url.href);
        return true;
      }
      setStatus(t('QR-код распознан. Адрес проектора — {host}', {host:url.host}));
      link.textContent = t(url.pathname === '/listen.html' ? 'Выбрать язык рассказа' : 'Открыть чат');
      link.href = url.href;
      link.removeAttribute('data-flow-link');
      link.hidden = false;
      link.focus();
    }
    return true;
  }

  function cameraFailed() {
    stopWork();
    camera.hidden = false;
    setStatus('Не удалось открыть камеру. Проверьте доступ в настройках браузера или отсканируйте QR-код приложением «Камера».');
  }

  async function startCamera() {
    stopWork();
    resetActions();
    const current = generation;
    cameraActive = true;
    setStatus('Подключаем камеру…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 960}},
        audio: false,
      });
      if (!dialog.open || current !== generation || document.hidden) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      video.srcObject = stream;
      preview.hidden = false;
      const {default: readQr} = await import('./vendor/jsqr-1.4.0.mjs');
      if (!dialog.open || current !== generation) return;
      await video.play();
      if (!dialog.open || current !== generation) return;
      setStatus(cameraHint);
      function scanFrame() {
        if (!dialog.open || current !== generation || document.hidden) return;
        try {
          if (video.videoWidth && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const code = decodeFrame(readQr);
            if (code && acceptCode(code)) return;
          }
        } catch {
          cameraFailed();
          return;
        }
        timer = setTimeout(scanFrame, 160);
      }
      scanFrame();
    } catch {
      if (dialog.open && current === generation) cameraFailed();
    }
  }

  camera.addEventListener('click', startCamera);
  dialog.addEventListener('close', () => {
    if (!dialog.open) stopWork();
  });
  window.addEventListener('pagehide', () => {
    stopWork();
    if (dialog.open) dialog.close();
  });
  window.addEventListener('hashchange', () => { if (dialog.open) dialog.close(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !cameraActive) return;
    stopWork();
    camera.hidden = false;
    setStatus('Камера приостановлена. Включите её, чтобы продолжить сканирование.');
  });

  return ({onStationCode} = {}) => {
    if (dialog.open) return;
    openStationChat = onStationCode;
    resetActions();
    dialog.showModal();
    if (canUseCamera) void startCamera();
    else {
      resetActions();
      setStatus(systemCameraHint);
    }
  };
}
