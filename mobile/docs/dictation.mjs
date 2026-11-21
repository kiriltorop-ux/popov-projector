import {locale, speechLocale, t} from './i18n.mjs';
import {stationAsr, transcribeOnStation} from './station-asr.mjs';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const endpoint = document.querySelector('meta[name="dictation-endpoint"]')?.content;
const format = window.MediaRecorder && ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type));
const local = Boolean(endpoint && format && navigator.mediaDevices?.getUserMedia);
export const canDictate = stationAsr || local || Boolean(Recognition);

// Plot a short history of microphone levels. The audio graph has no speaker output.
function drawLevels(canvas, stream, signal) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio || !stream || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const context = new Audio();
  let frame;
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    void context.close().catch(() => {});
  }, {once:true});
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const levels = new Float32Array(40);
  const paint = canvas.getContext('2d');
  let last = 0;
  function draw(time) {
    if (time - last >= 48) {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
      levels.copyWithin(0, 1);
      levels[levels.length - 1] = Math.min(1, 5 * Math.sqrt(energy / samples.length));
      paint.clearRect(0, 0, canvas.width, canvas.height);
      paint.strokeStyle = getComputedStyle(canvas).color;
      paint.lineWidth = 3;
      paint.lineCap = 'round';
      paint.beginPath();
      levels.forEach((level, i) => {
        const height = 3 + level * (canvas.height - 3);
        paint.moveTo(i * 6 + 2, (canvas.height - height) / 2 + 1);
        paint.lineTo(i * 6 + 2, (canvas.height + height) / 2 - 1);
      });
      paint.stroke();
      last = time;
    }
    frame = requestAnimationFrame(draw);
  }
  void context.resume().catch(() => {});
  frame = requestAnimationFrame(draw);
}

export function bindDictation(form, {onChange, onSend, showError, beforeStart, transcribe = stationAsr ? transcribeOnStation : null}) {
  const input = form.elements.question;
  const mic = form.querySelector('.conversation-dictate');
  const panel = form.querySelector('.dictation-panel');
  const cancel = form.querySelector('.dictation-cancel');
  const pause = form.querySelector('.dictation-pause');
  const confirm = form.querySelector('.dictation-confirm');
  const status = panel.querySelector('[role="status"]');
  const elapsed = panel.querySelector('time');
  const preview = panel.querySelector('.dictation-preview');
  const canvas = panel.querySelector('canvas');
  const hint = form.parentElement.querySelector('.dictation-hint');
  let session;
  let recordedMs = 0;
  const server = Boolean(transcribe || local);
  const file = document.createElement('input');
  file.type='file';file.accept='audio/*,video/mp4,video/webm';file.setAttribute('capture','microphone');
  file.hidden=true;file.setAttribute('aria-label',t('Загрузить запись'));form.append(file);
  file.addEventListener('cancel',()=>cancelRecording());
  async function upload(current, blob, name) {
    if(!blob.size)throw Error('Речь не слышна. Нажмите микрофон и повторите вопрос.');
    if(blob.size>10*1024*1024)throw Error('Запись должна быть меньше 10 МБ.');
    if(transcribe)return transcribe(blob,name,current.resources.signal);
    const url=new URL(endpoint,location.href);url.searchParams.set('language',locale());
    const result=await fetch(url,{method:'POST',body:blob,signal:current.resources.signal});
    if(!result.ok)throw Error('Не удалось распознать запись. Попробуйте ещё раз.');
    const data=await result.json();return data.text;
  }
  file.addEventListener('change',async()=>{
    const current=session, blob=file.files?.[0];file.value='';
    if(!current)return;
    if(!blob){cancelRecording();return;}
    current.action='edit';status.textContent=t('Завершаю распознавание…');
    try{const text=await upload(current,blob,blob.name);if(session!==current)return;append(current,text);complete(current);}
    catch(error){if(session===current)explain(current,error.message);}
  });

  function setPaused(paused) {
    const label = t(paused ? 'Продолжить диктовку' : 'Диктовать вопрос');
    mic.setAttribute('aria-label', label);
    mic.title = label;
    hint.textContent = paused ? t('Диктовка на паузе') : '';
    hint.hidden = !paused;
  }

  function resetPause() {
    recordedMs = 0;
    setPaused(false);
  }

  function close(target) {
    if (!session) return;
    const current = session;
    session = null;
    clearTimeout(current.deadline);
    clearInterval(current.clock);
    current.resources.abort();
    if (current.recorder && current.recorder.state !== 'inactive') current.recorder.stop();
    current.recognizer?.abort();
    form.classList.remove('dictating');
    input.disabled = false;
    onChange();
    target?.focus();
  }

  function cancelRecording() {
    if (!session) return;
    if (session.action === 'pause') {
      close(input);
      return;
    }
    input.value = session.draft;
    close(mic);
    setPaused(recordedMs > 0);
  }

  function explain(current, message) {
    if (session !== current) return;
    close(current.action === 'pause' ? undefined : mic);
    hint.textContent = t(message);
    hint.hidden = false;
  }

  function append(current, text) {
    current.phrase = typeof text==='string' ? text.trim() : '';
    if(!current.phrase)return;
    if (current.action === 'pause') {
      // Insert the finished segment before any new typing, keeping edits and caret.
      const position = input.value.startsWith(current.draft) ? current.draft.length : input.value.length;
      const before = input.value.slice(0, position);
      const after = input.value.slice(position);
      const addition = (before && !/\s$/u.test(before) ? ' ' : '') + current.phrase
        + (after && !/^\s/u.test(after) ? ' ' : '');
      const mode = input.selectionStart === position && input.selectionEnd === position ? 'end' : 'preserve';
      input.setRangeText(addition.slice(0, input.maxLength - input.value.length), position, position, mode);
      return;
    }
    input.value = [current.draft.trim(), current.phrase].filter(Boolean).join(' ').slice(0, input.maxLength);
    preview.textContent = input.value;
    preview.scrollTop = preview.scrollHeight;
  }

  function complete(current) {
    if (session !== current) return;
    if (!current.phrase) return explain(current, 'Речь не слышна. Нажмите микрофон и повторите вопрос.');
    if (current.action === 'pause' && current.recognizer) append(current, current.phrase);
    const send = current.action === 'send';
    close(send ? mic : current.action === 'pause' ? undefined : input);
    if (current.action === 'pause') setPaused(true);
    if (send) onSend(input.value);
  }

  function finish(action) {
    if (!session) return;
    const current = session;
    if (current.action) return;
    if(!current.recorder && !current.recognizer){cancelRecording();return;}
    current.action = action;
    if (action === 'pause') {
      if (current.started) recordedMs += performance.now() - current.started;
      form.classList.remove('dictating');
      input.disabled = false;
      input.focus();
      setPaused(true);
      if (!current.started || (!current.recorder && current.phrase) ||
          (current.recorder && performance.now() - current.started < 1000)) {
        close();
        return;
      }
      hint.textContent = t('Завершаю распознавание…');
    }
    clearInterval(current.clock);
    clearTimeout(current.deadline);
    confirm.disabled = true;
    status.textContent = t('Завершаю распознавание…');
    if (current.recorder) current.recorder.stop();
    else current.recognizer.stop();
    if (session === current) current.deadline = setTimeout(() => {
      if (current.phrase) complete(current);
      else explain(current, 'Диктовка недоступна. Можно повторить запись или ввести текст.');
    }, server ? 55000 : 6500);
  }

  function listening(current) {
    if (current.started) return;
    current.started = performance.now();
    status.textContent = t('Слушаю…');
    current.clock = setInterval(() => {
      const segmentMs = performance.now() - current.started;
      const seconds = Math.floor((recordedMs + segmentMs) / 1000);
      elapsed.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
      if (server) confirm.disabled = segmentMs < 1000;
    }, 200);
  }

  function record(current, stream) {
    const {signal} = current.resources;
    const recorder = current.recorder = new MediaRecorder(stream, {mimeType:format});
    const chunks = [];
    recorder.addEventListener('dataavailable', e => { if (e.data.size) chunks.push(e.data); }, {signal});
    recorder.addEventListener('error', () => explain(current, 'Запись прервалась. Нажмите микрофон, чтобы повторить.'), {signal});
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      try {
        const ext=format.includes('mp4')?'m4a':format.includes('ogg')?'ogg':'webm';
        const text=await upload(current,new Blob(chunks,{type:format}),'question.'+ext);
        if (signal.aborted) return;
        append(current, text);
        complete(current);
      } catch(error) {
        explain(current, error.message || 'Диктовка недоступна. Можно повторить запись или ввести текст.');
      }
    }, {signal});
    recorder.start();
    listening(current);
    current.deadline = setTimeout(() => finish('pause'), 18500);
  }

  function recognize(current, track) {
    const {signal} = current.resources;
    const recognizer = current.recognizer = new Recognition();
    recognizer.lang = speechLocale();
    recognizer.interimResults = true;
    recognizer.continuous = true;
    recognizer.addEventListener('audiostart', () => listening(current), {signal});
    recognizer.addEventListener('result', event => {
      const text = Array.from(event.results, result => result[0].transcript.trim()).filter(Boolean).join(' ');
      if (current.action === 'pause') current.phrase = text;
      else append(current, text);
      confirm.disabled = Boolean(current.action) || !current.phrase;
    }, {signal});
    recognizer.addEventListener('error', e => {
      if (e.error === 'not-allowed') return denied(current);
      if (current.phrase) { if (current.action === 'send') current.action = null; return complete(current); }
      explain(current, e.error === 'no-speech' ? 'Речь не слышна. Нажмите микрофон и повторите вопрос.'
        : 'Диктовка недоступна. Можно повторить запись или ввести текст.');
    }, {signal});
    recognizer.addEventListener('end', () => complete(current), {signal});
    if (!track) return recognizer.start();
    try { recognizer.start(track); }
    catch (e) {
      if (!['TypeError','NotSupportedError'].includes(e.name)) throw e;
      recognizer.start();
    }
  }

  function denied(current) {
    if (session !== current) return;
    close(mic);
    showError(t('Доступ к микрофону закрыт. Разрешите его в браузере или введите вопрос.'));
  }

  async function start() {
    if (session) return;
    if(beforeStart?.()===false)return;
    showError('');
    hint.hidden = true;
    const current = session = {resources:new AbortController(), draft:input.value, phrase:'', action:null};
    const {signal} = current.resources;
    form.classList.add('dictating');
    input.disabled = true;
    confirm.disabled = true;
    status.textContent = t('Запрашиваем микрофон…');
    const seconds = Math.floor(recordedMs / 1000);
    elapsed.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    preview.textContent = current.draft;
    canvas.hidden = false;
    canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);
    cancel.focus();
    onChange();
    if(server && (!format || !navigator.mediaDevices?.getUserMedia)) {
      status.textContent=t('Загрузить запись');canvas.hidden=true;file.click();return;
    }
    try {
      let stream;
      if (navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
        const release = () => stream.getTracks().forEach(track => track.stop());
        if (signal.aborted) { release(); return; }
        signal.addEventListener('abort', release, {once:true});
        try { drawLevels(canvas, stream, signal); } catch { canvas.hidden = true; }
      }
      if (server) record(current, stream);
      else recognize(current, stream?.getAudioTracks()[0]);
    } catch (error) {
      if (error.name === 'NotAllowedError') denied(current);
      else explain(current, 'Микрофон недоступен. Проверьте подключение или введите текст.');
    }
  }

  mic.addEventListener('click', start);
  cancel.addEventListener('click', cancelRecording);
  pause.addEventListener('click', () => finish('pause'));
  confirm.addEventListener('click', () => finish('send'));
  input.addEventListener('input', () => { hint.hidden = true; });
  form.addEventListener('keydown', event => {
    if (session && event.key === 'Escape') { event.preventDefault(); cancelRecording(); }
  });
  return {get active() { return Boolean(session); }, close, resetPause};
}
