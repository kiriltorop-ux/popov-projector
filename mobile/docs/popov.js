import { createApp, nextTick, reactive } from './vendor/vue.esm-browser.prod.mjs';
import { legacyPopovRender } from './vue-renders.mjs';
import { AppIcon } from './views.mjs';
import {stationTurnStatus} from './station-status.mjs';

const byId = id => document.getElementById(id);
const settings = new URLSearchParams(location.search).has('settings');
const terminal = new Set(['finished', 'cancelled', 'failed']);
const poseNames = ['rest', 'open', 'round', 'wide', 'soft', 'teeth', 'hush', 'reduced'];
const availableMic = Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const suggestions = ['Как работает приёмник?', 'Кто вы?'];
const idleCaption = 'Задайте вопрос Попову';
const ui = reactive({
  mode: 'text', phase: 'ready', logged: false, online: false, active: false, ended: false,
  sending: false, remaining: 0, turns: [], notice: '', question: '', address: '', connectionError: '',
  availability: settings ? 'Гид у проектора' : 'Проверяем связь…',
  voiceStatus: 'Задайте вопрос', caption: idleCaption,
  clip: '', reviewingTranscript: false, decoding: false, requestingMic: false,
  recordLabel: 'Записать вопрос',
});

let token = sessionStorage.getItem('popov-session') || '';
let pending = JSON.parse(sessionStorage.getItem('popov-pending') || 'null');
let isStatic = location.hostname.endsWith('.github.io');
let snapshot, timer, recorder, stream, recordTimer, audioBlob, faceClock, animation;
let version = 0;
let visibleTurns = '';
const poseImages = new Map();

function drawFace() {
  const face = byId('voiceStage').querySelector('img');
  const elapsed = faceClock ? (performance.now() - faceClock.origin) / 1000 : 0;
  let pose = 'rest';
  for (const [start, shape] of faceClock?.poses || []) {
    if (start > elapsed) break;
    pose = shape;
  }
  const source = poseImages.get(pose);
  if (source?.complete && source.naturalWidth && face.src !== source.src) face.src = source.src;
  if (faceClock && ui.mode === 'voice') animation = requestAnimationFrame(drawFace);
}

function faceTime(last) {
  cancelAnimationFrame(animation);
  faceClock = last?.state === 'started' ? {
    poses: last.poses,
    origin: performance.now() - last.elapsed * 1000,
  } : null;
  if (ui.mode === 'voice') drawFace();
}

async function api(path, body) {
  const response = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : {error:'Площадка недоступна'};
  if (!response.ok) throw Object.assign(new Error(data.error), {status: response.status});
  if (path === 'site' && typeof data.online !== 'boolean') {
    throw Object.assign(new Error('Площадка недоступна'), {status:404});
  }
  return data;
}

function forget() {
  token = '';
  pending = null;
  snapshot = undefined;
  sessionStorage.removeItem('popov-session');
  sessionStorage.removeItem('popov-pending');
  visibleTurns = '';
  ui.turns = [];
  ui.question = '';
  ui.reviewingTranscript = false;
  faceTime(null);
}

function turnStatus(turn) {
  return stationTurnStatus(turn);
}

function showSession(data) {
  snapshot = data;
  const turns = data.turns ?? [];
  ui.logged = Boolean(token);
  ui.online = data.online;
  ui.active = turns.some(turn => !terminal.has(turn.state));
  ui.ended = ui.logged && !ui.active && data.remaining === 0;
  ui.remaining = data.remaining;
  ui.availability = ui.ended ? 'Разговор завершён' : ui.online ? 'Проектор на связи' : 'Показ приостановлен';
  if (!ui.logged) return;
  if (pending && turns.some(turn => turn.key === pending.key)) {
    pending = null;
    sessionStorage.removeItem('popov-pending');
    ui.question = '';
    ui.reviewingTranscript = false;
  }
  const visible = JSON.stringify(turns.map(turn => [turn.key, turn.state, turn.ahead, turn.answer]));
  if (visibleTurns !== visible) {
    visibleTurns = visible;
    ui.turns = turns;
    if (ui.mode === 'text') nextTick(() => byId('history').lastElementChild?.scrollIntoView({block:'nearest'}));
  }
  const last = turns.at(-1);
  faceTime(last);
  ui.phase = last?.state || 'ready';
  ui.voiceStatus = last?.state === 'started' ? 'Попов говорит'
    : ui.active ? turnStatus(last) : ui.ended ? 'Разговор завершён' : 'Задайте вопрос';
  if (recorder?.state !== 'recording' && !audioBlob) {
    ui.caption = (last?.state === 'finished' ? last.answer : '') || (ui.active ? turnStatus(last) : idleCaption);
  }
}

async function update(path, body) {
  const current = ++version;
  clearTimeout(timer);
  try {
    const data = await api(path, body);
    if (current !== version) return;
    if (data.token) {
      token = data.token;
      sessionStorage.setItem('popov-session', token);
    }
    if (!body && pending && !ui.question) ui.question = pending.text;
    if (body) ui.notice = '';
    showSession(data);
  } catch (error) {
    if (current !== version) return;
    if (error.status === 404 && path === 'site') { offlineSite(); return; }
    if (error.status === 401) { forget(); showSession({online:false}); }
    ui.notice = error.status ? error.message : 'Нет связи с площадкой. Проверьте подключение.';
    if (!error.status) ui.availability = 'Связь прервана';
  } finally {
    if (current === version) {
      ui.sending = false;
      if (!isStatic) timer = setTimeout(() => update(token ? 'session' : 'site'), token ? 850 : 2500);
    }
  }
}

function start() {
  if (ui.sending) return;
  ui.sending = true;
  void update('start', {});
}

function again() {
  forget();
  void update('site');
}

function submitQuestion() {
  const text = ui.question.trim();
  if (!text) { byId('question').focus(); return; }
  if (ui.sending) return;
  if (pending?.text !== text) {
    const key = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
    pending = {text, key};
    sessionStorage.setItem('popov-pending', JSON.stringify(pending));
  }
  ui.sending = true;
  void update('question', pending);
}

function pickSuggestion(question) {
  ui.question = question;
  byId('question').focus();
}

function offlineSite() {
  isStatic = true;
  location.replace('./#popov');
}

function clearClip() {
  audioBlob = null;
  if (ui.clip) URL.revokeObjectURL(ui.clip);
  ui.clip = '';
  byId('upload').value = '';
}

function setClip(blob) {
  clearClip();
  if (!blob?.size || blob.size > 10 * 1024 * 1024) {
    ui.notice = 'Выберите запись до 10 МБ и не длиннее 20 секунд.';
    return;
  }
  audioBlob = blob;
  ui.clip = URL.createObjectURL(blob);
}

function uploadClip(event) {
  if (event.target.files.length) setClip(event.target.files[0]);
}

function stopRecord() {
  clearTimeout(recordTimer);
  if (recorder?.state === 'recording') recorder.stop();
  stream?.getTracks().forEach(track => track.stop());
}

function selectMode(mode) {
  ui.mode = mode;
  if (mode === 'voice' && !poseImages.size) {
    for (const pose of poseNames) {
      const img = new Image();
      img.src = pose === 'rest' ? './assets/popov.webp' : './assets/popov-' + pose + '.webp';
      poseImages.set(pose,img);
    }
  }
  faceTime(snapshot?.turns?.at(-1));
  if (mode === 'text') stopRecord();
}

async function recordQuestion() {
  if (recorder?.state === 'recording') { stopRecord(); return; }
  ui.requestingMic = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    if (ui.mode !== 'voice') { stopRecord(); return; }
    const mime = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    const recording = new MediaRecorder(stream, mime ? {mimeType:mime} : {});
    recorder = recording;
    const chunks = [];
    recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recording.onstop = () => {
      setClip(new Blob(chunks, {type:recording.mimeType}));
      ui.recordLabel = 'Записать ещё раз';
      ui.caption = 'Проверьте запись перед отправкой';
      recording.stream.getTracks().forEach(track => track.stop());
    };
    recording.start();
    ui.recordLabel = 'Остановить запись';
    ui.caption = 'Слушаю ваш вопрос…';
    recordTimer = setTimeout(stopRecord, 19500);
  } catch {
    stopRecord();
    ui.notice = 'Микрофон недоступен. Можно выбрать запись или написать вопрос.';
  } finally { ui.requestingMic = false; }
}

async function decodeClip() {
  if (!audioBlob || ui.decoding) return;
  ui.decoding = true;
  const form = new FormData();
  form.append('recording', audioBlob, 'question');
  ui.notice = 'Распознаём вопрос…';
  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST', headers: {Authorization: 'Bearer ' + token},
      body: form, signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    ui.question = data.text;
    clearClip();
    ui.reviewingTranscript = true;
    ui.notice = 'Проверьте текст и отправьте вопрос.';
    await nextTick();
    byId('question').focus();
  } catch (error) {
    ui.notice = error.message || 'Не удалось распознать запись.';
  } finally { ui.decoding = false; }
}

function connect() {
  const raw = ui.address.trim();
  try {
    const url = new URL(raw.includes('://') ? raw : 'http://' + raw);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw Error();
    location.assign(new URL('/popov.html', url));
  } catch { ui.connectionError = 'Проверьте адрес из пульта.'; }
}

const showSources = () => byId('sources').showModal();
const closeSources = () => byId('sources').close();
createApp({
  render: legacyPopovRender,
  components: { AppIcon },
  setup() {
    return {
      ui, settings, availableMic, suggestions, turnStatus, start, again, submitQuestion, pickSuggestion,
      selectMode, recordQuestion, uploadClip, decodeClip, clearClip, connect, showSources, closeSources,
    };
  },
}).mount('#popov-root');

window.addEventListener('pagehide', () => {
  stopRecord();
  clearTimeout(timer);
  cancelAnimationFrame(animation);
});
if (settings) document.title = 'Настройки Александра Попова · Город говорит';
else if (isStatic) offlineSite();
else void update(token ? 'session' : 'site');
