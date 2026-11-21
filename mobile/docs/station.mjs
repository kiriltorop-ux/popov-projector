import { locale, localizedGuide, setLocale, t } from './i18n.mjs';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from './vendor/vue.esm-browser.prod.mjs';
import { AppIcon, PortraitImage } from './views.mjs?v=guide-flow';
import { popovQuestions, projectorGuide } from './popov-guide.mjs';
import { sign } from './conversation.mjs?v=guide-flow';
import { stationConversationRender } from './vue-renders.mjs?v=guide-flow';
import {bindHoldRecording} from './hold-recording.mjs';
import {stationTurnStatus} from './station-status.mjs';

const prefix = 'gorod-station-';
const terminal = new Set(['finished', 'failed', 'cancelled']);
const storage = {
  get(key) { try { return sessionStorage.getItem(prefix + key) || ''; } catch { return ''; } },
  set(key, value) {
    try {
      if (value) sessionStorage.setItem(prefix + key, value);
      else sessionStorage.removeItem(prefix + key);
    } catch { /* In-memory session still works. */ }
  },
};
const randomKey = () => Array.from(crypto.getRandomValues(new Uint32Array(4)),
  value => value.toString(16).padStart(8, '0')).join('');

export function saveStationAdmission(code) {
  storage.set('auto-join','1');
  if (code === storage.get('admission')) return;
  storage.set('admission', code);
  storage.set('token', '');
  storage.set('pending', '');
}

function admissionExpiry(code) {
  return (Number(code.split('.')[0]) + 1) * 120000;
}

export function hasCurrentStationAdmission() {
  if(storage.get('token'))return true;
  const admission = storage.get('admission');
  return /^\d+\.[a-f\d]{64}$/.test(admission) && Date.now() < admissionExpiry(admission);
}

export function enterStationRoute() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const legacyEntry = location.pathname.endsWith('/popov.html');
  if (fragment.has('join')) {
    if (fragment.has('lang')) setLocale(fragment.get('lang'));
    saveStationAdmission(fragment.get('join'));
    history.replaceState(history.state, '', legacyEntry ? './#popov' : './#home');
  } else if (!location.hash && legacyEntry) {
    history.replaceState(history.state, '', './#popov');
  }
}

function turnStatus(turn) {
  return stationTurnStatus(turn, t);
}

export const StationConversation = {
  props: ['back'],
  components: { AppIcon, PortraitImage },
  render: stationConversationRender,
  setup() {
    const httpsSetupUrl = window.isSecureContext ? '' : `http://${location.hostname}:18778/`;
    const admission = storage.get('admission');
    const client = storage.get('client') || randomKey();
    storage.set('client', client);
    let pending;
    try { pending = JSON.parse(storage.get('pending') || 'null'); }
    catch { storage.set('pending', ''); }
    const ui = reactive({
      token: storage.get('token'), online: null, turns: [], remaining: 3,
      question: pending?.text || storage.get('draft'), working: '', error: '', offline: false,
      recording: false,
    });
    const transcript = ref(null), input = ref(null), voiceForm = ref(null);
    let dictation;
    async function installDictation(){
      await nextTick();
      if(dictation || !voiceForm.value || life.signal.aborted)return;
      dictation=bindHoldRecording(voiceForm.value,{
        beforeStart:()=>Boolean(available.value&&!ui.working),
        onChange:()=>{ui.recording=Boolean(dictation?.active);if(input.value)draft(input.value.value);},
        onSend:text=>{draft(text);void submit();},
        showError:text=>{ui.error=text;},
        transcribe:async(blob,name,signal)=>{
          const form=new FormData();form.append('recording',blob,name);form.append('language',locale());
          return (await api('transcribe',form,signal)).text;
        },
      });
    }
    const clock = ref(Date.now());
    let serverOffset = 0;
    let expiry = admissionExpiry(admission);
    const active = computed(() => ui.turns.some(turn => !terminal.has(turn.state)));
    const valid = computed(() => /^\d+\.[a-f\d]{64}$/.test(admission) && clock.value < expiry);
    const available = computed(() => ui.token && ui.online && ui.remaining > 0 && !active.value);
    const access = computed(() => {
      if(ui.token && ui.remaining>0)return t('Осталось вопросов: {count} из 3', {count:ui.remaining});
      if (!admission) return t('Отсканируйте QR-код на экране Попова, чтобы начать разговор.');
      if (!ui.token && !valid.value) return t('Время доступа истекло. Отсканируйте новый QR-код на экране Попова.');
      if (ui.token && !ui.remaining && !active.value) return t('Три вопроса использованы. Для нового разговора отсканируйте следующий QR-код.');
      if (!ui.token) return t('Ответ прозвучит у проектора. За один разговор можно задать три вопроса.');
      return t('Осталось вопросов: {count} из 3', {count:ui.remaining});
    });
    const connection = computed(() => {
      if (ui.offline) return t('Связь с площадкой прервана');
      if (ui.online === null) return t('Проверяем связь…');
      return ui.online ? t('Проектор на связи') : t('Проектор не на связи');
    });

    const life = new AbortController();
    let timer, ticker, poll;
    async function api(path, body, signal = life.signal) {
      const multipart = body instanceof FormData;
      const headers = ui.token ? { Authorization: 'Bearer ' + ui.token } : {};
      if (body && !multipart) headers['Content-Type'] = 'application/json';
      const response = await fetch('./api/' + path, {
        method: body ? 'POST' : 'GET', headers, cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(multipart ? 55000 : 8000)]),
        body: multipart ? body : body && JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(typeof data.error === 'string' ? data.error : t('Проверьте запрос.')), {
          status: response.status,
        });
      }
      return data;
    }

    function accept(data) {
      if (Number.isFinite(data.server_time)) serverOffset = data.server_time * 1000 - Date.now();
      if (Number.isFinite(data.expires_at)) expiry = data.expires_at * 1000;
      clock.value = Date.now() + serverOffset;
      ui.online = data.online;
      ui.offline = false;
      if (data.token) storage.set('token', ui.token = data.token);
      if (!data.turns) return;
      ui.remaining = data.remaining;
      ui.turns = data.turns;
      if (pending && data.turns.some(turn => turn.key === pending.key)) {
        if (ui.question.trim() === pending.text) draft('');
        pending = null;
        storage.set('pending', '');
      }
    }

    function schedule(delay) {
      clearTimeout(timer);
      if (!life.signal.aborted) timer = setTimeout(refresh, delay);
    }
    async function refresh() {
      if (ui.working || poll || life.signal.aborted) return;
      const request = new AbortController();
      poll = request;
      try {
        const data = await api(ui.token ? 'session' : 'site', undefined, AbortSignal.any([request.signal, life.signal]));
        if (!request.signal.aborted && !life.signal.aborted) accept(data);
      } catch (err) {
        if (request.signal.aborted || life.signal.aborted) return;
        if (err.status === 401) {
          storage.set('token', ui.token = '');
          ui.error = t(err.message);
        } else {
          ui.online = false;
          ui.offline = true;
        }
      } finally {
        if (poll === request) {
          poll = null;
          schedule(active.value || pending ? 700 : 2400);
        }
      }
    }

    async function perform(phase, action) {
      if (ui.working || life.signal.aborted) return;
      clearTimeout(timer);
      poll?.abort();
      poll = null;
      ui.working = phase;
      ui.error = '';
      try { await action(); }
      catch (err) {
        if (!life.signal.aborted) ui.error = err.status ? t(err.message)
          : t('Связь с площадкой прервана. Попробуйте ещё раз.');
      } finally {
        if (!life.signal.aborted) {
          ui.working = '';
          schedule(0);
        }
      }
    }

    function draft(text) {
      ui.question = text;
      storage.set('draft', text);
    }
    async function pick(question) {
      draft(question);
      await nextTick();
      input.value?.focus();
    }
    function join() {
      if (!valid.value || !ui.online) return;
      return connect();
    }
    function connect() {
      return perform(t('Подключаемся…'), async () => {
        accept(await api('start', {admission, client_id: client, language: locale()}));
      });
    }
    function submit() {
      const text = ui.question.trim();
      if (!text || !available.value || ui.working || ui.recording) return;
      if (pending?.text !== text) {
        pending = {text, key: randomKey()};
        storage.set('pending', JSON.stringify(pending));
      }
      return perform(t('Отправляем вопрос…'), async () => {
        accept(await api('question', {...pending, language:locale()}));
      });
    }
    function retry(turn) {
      if (!available.value) return;
      draft(turn.question);
      void submit();
    }

    watch(() => ui.turns.map(turn => [turn.key, turn.answer, turn.state, turn.ahead, turn.error]).flat().join(';'), () => {
      const log = transcript.value;
      if (!log || log.scrollHeight - log.clientHeight - log.scrollTop > 72) return;
      nextTick(() => { if (log.isConnected) log.scrollTop = log.scrollHeight; });
    });
    watch(()=>ui.token,()=>{
      dictation?.close();dictation=null;
      void installDictation();
    });
    onMounted(() => {
      void installDictation();
      void refresh().then(()=>{
        if(storage.get('auto-join')){
          storage.set('auto-join','');
          if(!ui.token)void connect();
        }
      });
      ticker = setInterval(() => { clock.value = Date.now() + serverOffset; }, 1000);
      window.addEventListener('pagehide', ()=>dictation?.close(), {signal: life.signal});
    });
    onBeforeUnmount(() => {
      dictation?.close();
      life.abort();
      poll?.abort();
      clearTimeout(timer);
      clearInterval(ticker);
    });
    return {ui, sign, t, transcript, input, voiceForm, active, available, valid, access, connection,
      guide: localizedGuide(projectorGuide), questions: popovQuestions.map(question => t(question)), httpsSetupUrl, turnStatus, draft, pick, join, submit, retry};
  },
  template: `<section class="conversation station-conversation" data-mode="text" data-guide="popov"
    :data-phase="active ? 'thinking' : 'ready'" :aria-label="t('Разговор с Поповым у проектора')">
    <header class="conversation-header">
      <a :href="back" data-flow-back class="conversation-back round-control" :aria-label="t('Назад')"><AppIcon name="caret" /></a>
      <div class="conversation-avatar" aria-hidden="true">
        <div class="avatar-frame"><div class="avatar-image"><PortraitImage :guide="guide" use-archive /></div></div>
      </div>
      <div class="conversation-identity"><h1>{{ guide.name }}</h1></div>
    </header>
    <div ref="transcript" class="conversation-log" id="messages" role="log" :aria-label="t('История сообщений')" tabindex="0">
      <div class="conversation-turns">
        <div class="message conversation-greeting"><div class="message-text reply-markdown">{{ guide.greeting }}</div></div>
        <template v-for="turn in ui.turns" :key="turn.key">
          <div class="message user"><span class="message-text">{{ turn.question }}</span></div>
          <div v-if="turn.state === 'finished' && turn.answer" class="message station-reply"><div class="message-text reply-markdown">{{ turn.answer }}</div></div>
          <div v-if="turnStatus(turn)" class="conversation-waiting" :data-state="turn.state">
            <span v-if="turn.state === 'generating'" class="conversation-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>{{ turnStatus(turn) }}</span>
            <button v-if="available && (turn.state === 'failed' || turn.state === 'cancelled')" type="button" class="text-link" @click="retry(turn)">{{ t('Повторить') }}</button>
          </div>
        </template>
      </div>
    </div>
    <div v-if="available" class="conversation-topics">
      <div class="conversation-topic-list" role="group" :aria-label="t('Темы для разговора')">
        <button v-for="question in questions" :key="question" type="button" @click="pick(question)">{{ question }}</button>
      </div>
    </div>
    <div class="conversation-composer">
      <p class="station-access" role="status">{{ connection }}</p>
      <p class="station-access" role="status">{{ access }}</p>
      <button v-if="!ui.token && valid" type="button" class="button primary station-join"
        :disabled="!ui.online || !!ui.working" @click="join">{{ t('Начать разговор') }}</button>
      <template v-if="ui.token">
        <form ref="voiceForm" class="conversation-form" id="askForm" @submit.prevent="submit">
          <button type="button" class="round-control conversation-dictate" :aria-label="t('Зажмите, чтобы записать вопрос')" :title="t('Зажмите, чтобы записать вопрос')" :disabled="!available || !!ui.working"><AppIcon :markup="sign('mic')" /></button>
          <input ref="input" id="question" name="question" :value="ui.question" @input="draft($event.target.value)" :aria-label="t('Ваш вопрос')"
            :placeholder="t('Напишите вопрос…')" maxlength="500" required autocomplete="off" enterkeyhint="send">
          <button type="submit" id="sendQuestion" class="round-control conversation-send" :aria-label="t('Отправить вопрос')"
            :disabled="!available || !ui.question.trim() || !!ui.working || ui.recording"><AppIcon :markup="sign('send')" /></button>
        </form>
        <p class="dictation-hint" role="status" hidden></p>
        <p v-if="httpsSetupUrl" class="station-access"><a :href="httpsSetupUrl">{{ t('Подключить микрофон на телефоне') }}</a></p>

      </template>
      <p v-if="ui.error" class="conversation-error" role="alert">{{ ui.error }}</p>
      <p v-if="ui.working" class="station-access" role="status">{{ ui.working }}</p>
    </div>
  </section>`,
};
