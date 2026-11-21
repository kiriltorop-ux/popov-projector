import {t} from './i18n.mjs';

// A pointer owns one recording. Releasing before microphone permission resolves
// cancels it, so a late permission grant can never start an unattended recording.
export function bindHoldRecording(form, {beforeStart, onChange, onSend, showError, transcribe}) {
  const mic = form.querySelector('.conversation-dictate');
  const hint = form.parentElement.querySelector('.dictation-hint');
  const life = new AbortController();
  let session;
  function message(text) { hint.textContent = t(text); hint.hidden = !text; }
  function releaseStream(current) { current.stream?.getTracks().forEach(track => track.stop()); }
  function clear(current) {
    clearTimeout(current.limit); clearInterval(current.clock);
    releaseStream(current);
    if (session !== current) return;
    session = null;
    form.classList.remove('holding-recording');
    form.removeAttribute('aria-busy');
    mic.setAttribute('aria-pressed', 'false');
    mic.setAttribute('aria-label', t('Зажмите, чтобы записать вопрос'));
    onChange();
  }
  function cancel() {
    const current = session;
    if (!current) return;
    current.cancelled = true;
    current.abort.abort();
    if (current.recorder?.state === 'recording') current.recorder.stop();
    clear(current);
    message('Запись отменена');
  }
  function finish() {
    const current = session;
    if (!current || current.finishing) return;
    if (!current.recorder) { cancel(); return; }
    if (performance.now() - current.started < 350) {
      cancel(); message('Зажмите микрофон и говорите. Отпустите, чтобы отправить.'); return;
    }
    current.finishing = true;
    clearTimeout(current.limit); clearInterval(current.clock);
    form.classList.remove('holding-recording');
    form.setAttribute('aria-busy', 'true');
    mic.setAttribute('aria-pressed', 'false');
    message('Распознаю голосовое сообщение…');
    current.recorder.stop();
  }
  async function start(owner) {
    if (session || beforeStart?.() === false) return;
    showError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      showError(t('Для записи откройте защищённое подключение и разрешите микрофон.'));
      return;
    }
    if (!window.MediaRecorder) {
      showError(t('Этот браузер не поддерживает запись. Откройте приложение в Chrome или Safari.'));
      return;
    }
    const current = session = {owner, abort: new AbortController(), cancelled: false, chunks: []};
    onChange();
    message('Разрешите доступ к микрофону…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      }});
      current.stream = stream;
      if (session !== current || current.cancelled) { releaseStream(current); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = current.recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorder.addEventListener('dataavailable', event => {
        if (event.data.size) current.chunks.push(event.data);
      });
      recorder.addEventListener('error', () => {
        if (session !== current) return;
        cancel(); showError(t('Запись прервалась. Зажмите микрофон, чтобы повторить.'));
      });
      recorder.addEventListener('stop', async () => {
        releaseStream(current);
        if (current.cancelled || session !== current) return;
        try {
          const type = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(current.chunks, {type});
          if (!blob.size) throw Error(t('Речь не слышна. Попробуйте ещё раз.'));
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const text = await transcribe(blob, 'question.' + extension, current.abort.signal);
          if (current.cancelled || session !== current) return;
          if (typeof text !== 'string' || !text.trim()) throw Error(t('Речь не слышна. Попробуйте ещё раз.'));
          clear(current);
          message('');
          onSend(text.trim());
        } catch (error) {
          if (session !== current) return;
          clear(current); message('');
          showError(error.message || t('Не удалось распознать запись. Попробуйте ещё раз.'));
        }
      });
      recorder.start(100);
      current.started = performance.now();
      form.classList.add('holding-recording');
      mic.setAttribute('aria-pressed', 'true');
      mic.setAttribute('aria-label', t('Отпустите, чтобы отправить'));
      const tick = () => {
        const seconds = Math.floor((performance.now() - current.started) / 1000);
        message(t('Идёт запись · {seconds} с. Отпустите, чтобы отправить', {seconds}));
      };
      tick(); current.clock = setInterval(tick, 200);
      current.limit = setTimeout(finish, 19000);
    } catch (error) {
      if (session !== current) return;
      clear(current); message('');
      showError(t(error.name === 'NotAllowedError'
        ? 'Доступ к микрофону закрыт. Разрешите его в браузере или введите вопрос.'
        : 'Микрофон недоступен. Проверьте подключение или введите текст.'));
    }
  }
  const options = {signal: life.signal};
  mic.addEventListener('pointerdown', event => {
    if (event.button !== 0 || session) return;
    event.preventDefault();
    mic.setPointerCapture(event.pointerId);
    void start(event.pointerId);
  }, options);
  window.addEventListener('pointerup', event => {
    if (session?.owner === event.pointerId) finish();
  }, options);
  mic.addEventListener('pointercancel', cancel, options);
  mic.addEventListener('lostpointercapture', () => { if (session && !session.finishing) cancel(); }, options);
  mic.addEventListener('contextmenu', event => event.preventDefault(), options);
  mic.addEventListener('click', event => event.preventDefault(), options);
  mic.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) void start('keyboard');
  }, options);
  mic.addEventListener('keyup', event => {
    if (session?.owner !== 'keyboard' || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault(); finish();
  }, options);
  window.addEventListener('blur', () => { if (!session?.finishing) cancel(); }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
  mic.setAttribute('aria-label', t('Зажмите, чтобы записать вопрос'));
  mic.setAttribute('aria-pressed', 'false');
  message('Зажмите микрофон и говорите. Отпустите, чтобы отправить.');
  return {get active() { return Boolean(session); }, close() { cancel(); life.abort(); }};
}
