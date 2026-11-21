import { bindDictation, canDictate } from './dictation.mjs';
import { locale, speechLocale, t } from './i18n.mjs';
import { conversationPageRender } from './vue-renders.mjs?v=guide-flow';
import { createStaticVNode, onBeforeUnmount, onMounted, ref } from './vendor/vue.esm-browser.prod.mjs';
import { AppIcon, PortraitImage } from './views.mjs?v=guide-flow';
import { avatarModels } from './avatar-models.mjs';
import { stopPortraitMotion } from './motion.mjs?v=guide-motion';
import { plainReply } from './reply-markdown.mjs';

const signs = {
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6"/>',
  send: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  speaker: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  sources: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  helpful: '<path d="M7 21H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3m0 10h10a2 2 0 0 0 2-1.65l1.23-7A2 2 0 0 0 18.26 10H14V6a3 3 0 0 0-3-3l-4 8v10Z"/>',
  unhelpful: '<path d="M7 3H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3m0-10h10a2 2 0 0 1 2 1.65l1.23 7A2 2 0 0 1 18.26 14H14v4a3 3 0 0 1-3 3l-4-8V3Z"/>',
};

export function sign(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${signs[name]}</svg>`;
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionEase = 'cubic-bezier(.16, 1, .3, 1)';

function playMotion(element, frames, options) {
  if (reduceMotion.matches || document.hidden || !element?.animate) return null;
  return element.animate(frames, { easing: motionEase, ...options });
}

function sendMotion(bubble, arrow) {
  playMotion(arrow, [
    { transform: 'translateY(0)', opacity: 1 },
    { transform: 'translateY(-9px)', opacity: 0, offset: .48 },
    { transform: 'translateY(5px)', opacity: 0, offset: .49 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: 210, easing: 'ease-out' });
  return playMotion(bubble, [
    { transform: 'translateY(5px)', opacity: .75 },
    { transform: 'none', opacity: 1 },
  ], { duration: 210 });
}

const thinkingMs = 650;

function pause(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted || ms <= 0) return resolve();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, {once: true});
  });
}

// Use word boundaries in the rendered markup so emphasis, lists and tables
// take their final shape as the reply appears.
async function revealReplyText(message, preview, signal, animate, follow) {
  const content = message.querySelector('.reply-markdown');
  if (!animate() || !content) return;
  const words = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const match of node.data.matchAll(/\S+\s*/gu)) {
      words.push({node, end: match.index + match[0].length});
    }
  }
  if (words.length < 2) return;
  const range = document.createRange();
  range.setStart(content, 0);
  const duration = Math.min(1450, Math.max(220, words.length * 37));
  const start = performance.now();
  while (!signal.aborted && animate()) {
    const count = Math.min(words.length, 1 + Math.floor((performance.now() - start) * words.length / duration));
    if (count === words.length) break;
    const {node, end} = words[count - 1];
    range.setEnd(node, end);
    const keepPosition = follow();
    preview.replaceChildren(range.cloneContents());
    keepPosition();
    await pause(45, signal);
  }
}

function waitingMessage() {
  const waiting = document.createElement('div');
  waiting.className = 'conversation-waiting';
  waiting.setAttribute('role', 'status');
  waiting.innerHTML = '<span class="conversation-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span></span>'
  waiting.lastElementChild.textContent = t('Готовлю ответ…');
  return waiting;
}

const StoredMessage = {
  props: ['message', 'renderMessage'],
  setup(props) {
    return () => createStaticVNode(props.renderMessage(props.message), 1);
  },
};

export const ConversationPage = {
  props: ['guide', 'questions', 'binding', 'back'],
  components: { AppIcon, PortraitImage, StoredMessage },
  setup(props) {
    const root = ref(null);
    const look = ['writer', 'guide', 'fox'].includes(props.guide.art) ? props.guide.art : 'custom';
    let controls;
    onMounted(() => { controls = bindConversation(root.value, props.binding); });
    onBeforeUnmount(() => controls?.destroy());
    return { root, look, sign, t, canDictate };
  },
  render: conversationPageRender,
  template: `<section ref="root" class="conversation" data-mode="text" data-phase="ready" :data-look="look" :data-guide="guide.id" :aria-label="t('Диалог с персонажем')">
    <header class="conversation-header">
      <a :href="back" data-flow-back class="conversation-back round-control" :aria-label="t('Назад')"><AppIcon name="caret" /></a>
      <div class="conversation-avatar" aria-hidden="true">
        <div class="avatar-frame">
          <div class="avatar-image"><PortraitImage :guide="guide" :use-archive="!guide.image && ['gorky','popov','chkalov','minin','gorodovoy'].includes(guide.id)" /></div>
        </div>
        <span class="avatar-speaking"><i></i><i></i><i></i></span>
      </div>
      <div class="conversation-identity">
        <h1>{{ guide.name }}</h1>
      </div>
    </header>
    <div class="conversation-log" id="messages" role="log" :aria-label="t('История сообщений')" tabindex="0">
      <div class="conversation-turns">
        <div class="message conversation-greeting"><div class="message-text reply-markdown">{{ guide.greeting }}</div></div>
        <StoredMessage v-for="(message, index) in binding.messages" :key="index" :message="message" :render-message="binding.renderMessage" />
      </div>
    </div>
    <div class="conversation-topics" :hidden="!questions.length">
      <div class="conversation-topic-list" role="group" :aria-label="t('Темы для разговора')"><button v-for="question in questions" :key="question" type="button" :data-question="question">{{ question }}</button></div>
    </div>
    <div class="conversation-composer">
      <form class="conversation-form" id="askForm">
        <button v-if="canDictate" type="button" class="round-control conversation-dictate" :aria-label="t('Диктовать вопрос')" :title="t('Диктовать вопрос')"><AppIcon :markup="sign('mic')" /></button>
        <input id="question" name="question" :aria-label="t('Ваш вопрос')" :placeholder="t('Напишите вопрос…')" maxlength="500" required autocomplete="off" enterkeyhint="send">
        <template v-if="canDictate">
          <button type="button" class="round-control dictation-cancel" :aria-label="t('Отменить запись')" :title="t('Отменить запись')"><AppIcon :markup="sign('cancel')" /></button>
          <div class="dictation-panel">
            <div class="dictation-meta"><span role="status"></span><time aria-hidden="true"></time></div>
            <canvas width="240" height="38" aria-hidden="true"></canvas>
            <div class="dictation-preview"></div>
          </div>
          <button type="button" class="round-control dictation-pause" :aria-label="t('Приостановить диктовку')" :title="t('Приостановить диктовку')"><AppIcon :markup="sign('pause')" /></button>
          <button type="button" class="round-control dictation-confirm" :aria-label="t('Отправить вопрос')" :title="t('Отправить вопрос')" disabled><AppIcon :markup="sign('send')" /></button>
        </template>
        <button type="submit" class="round-control conversation-send" id="sendQuestion" :aria-label="t('Отправить вопрос')" :title="t('Отправить вопрос')" disabled><AppIcon :markup="sign('send')" /></button>
      </form>
      <p class="dictation-hint" role="status" hidden></p>
      <p id="askError" class="conversation-error" role="alert" hidden></p>
    </div>
  </section>`,
};

const ratings = new WeakMap();

function bindConversation(root, { guide, messages, renderMessage, ask, feedback, notify, replySources, openReplySources }) {
  const listeners = new AbortController();
  const { signal } = listeners;
  const $ = selector => root.querySelector(selector);
  const transcript = $('#messages');
  const turns = $('.conversation-turns');
  const form = $('#askForm');
  const questionInput = $('#question');
  const send = $('#sendQuestion');
  const dictate = $('.conversation-dictate');
  const error = $('#askError');
  const avatarFrame = $('.avatar-frame');
  const topicButtons = [...root.querySelectorAll('[data-question]')];
  const supportsSpeech = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  let phase = 'ready';
  let speaking = null;
  let sending = false;
  let model = null;
  const dictation = dictate && bindDictation(form, {
    onChange:updateControls, onSend:sendQuestion, showError, beforeStart:stopSpeech,
  });

  const on = (target, name, fn) => target.addEventListener(name, fn, { signal });

  function scrollToLatest() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function showError(text) {
    error.textContent = text;
    error.hidden = !text;
  }

  function updateControls() {
    for (const button of turns.querySelectorAll('[data-read-reply]')) {
      button.disabled = !supportsSpeech || sending || Boolean(dictation?.active);
      const reading = speaking?.button === button;
      const label = reading ? t('Остановить озвучку') : t('Озвучить ответ');
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = sign(reading ? 'stop' : 'speaker');
      }
    }
    root.dataset.phase = phase;
    send.disabled = sending || Boolean(dictation?.active) || !questionInput.value.trim();
    for (const button of topicButtons) button.disabled = sending || Boolean(dictation?.active);
    if (dictate) dictate.disabled = sending || Boolean(dictation?.active);
  }

  function setPhase(next) {
    phase = next;
    updateControls();
  }

  function stopSpeech() {
    if (!speaking) return;
    clearTimeout(speaking.startTimer);
    speaking = null;
    window.speechSynthesis.cancel();
    model?.setSpeaking(false);
    setPhase(sending ? 'thinking' : 'ready');
  }

  function say(text, button) {
    if (!text || signal.aborted) return;
    stopSpeech();
    if (!supportsSpeech) {
      showError(t('Озвучка недоступна в этом браузере.'));
      return;
    }
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = synth.getVoices().find(voice => voice.lang.toLowerCase().split(/[-_]/)[0] === locale());
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = speechLocale();
    utterance.rate = guide.voice === 'calm' ? .92 : 1.02;
    const playback = { utterance, button, startTimer: null };
    speaking = playback;
    setPhase('preparing');
    const finish = () => {
      if (speaking !== playback) return false;
      clearTimeout(playback.startTimer);
      speaking = null;
      model?.setSpeaking(false);
      setPhase(sending ? 'thinking' : 'ready');
      return true;
    };
    const failed = () => {
      if (!finish()) return;
      showError(t('Не удалось озвучить ответ. Проверьте, доступен ли русский голос.'));
    };
    utterance.onstart = () => {
      if (speaking !== playback) return;
      clearTimeout(playback.startTimer);
      model?.setSpeaking(true);
      setPhase('speaking');
    };
    utterance.onboundary = () => {
      if (speaking === playback) model?.accent();
    };
    utterance.onend = finish;
    utterance.onerror = failed;
    playback.startTimer = setTimeout(() => {
      if (speaking !== playback) return;
      failed();
      synth.cancel();
    }, 6500);
    try {
      synth.speak(utterance);
    } catch {
      failed();
    }
  }

  function addReplyActions(message, reply) {
    const actions = document.createElement('div');
    actions.className = 'reply-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', t('Действия с ответом'));

    function action(glyph, label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = sign(glyph);
      actions.append(button);
      return button;
    }

    const copy = action('copy', t('Скопировать ответ'));
    on(copy, 'click', async () => {
      try {
        await navigator.clipboard.writeText(plainReply(reply.text));
        if (!signal.aborted) notify(t('Ответ скопирован'), true);
      } catch {
        if (!signal.aborted) notify(t('Не удалось скопировать ответ'));
      }
    });

    const up = action('helpful', t('Хороший ответ'));
    const down = action('unhelpful', t('Плохой ответ'));
    function paintRating() {
      up.setAttribute('aria-pressed', String(ratings.get(reply) === 'helpful'));
      down.setAttribute('aria-pressed', String(ratings.get(reply) === 'unhelpful'));
    }
    let savingRating = false;
    async function rate(value) {
      const previous = ratings.get(reply);
      if (savingRating || previous === value) return;
      savingRating = true;
      ratings.set(reply, value);
      paintRating();
      try {
        await feedback(reply, value);
      } catch {
        ratings.set(reply, previous);
        paintRating();
      } finally {
        savingRating = false;
      }
    }
    paintRating();
    on(up, 'click', () => void rate('helpful'));
    on(down, 'click', () => void rate('unhelpful'));

    const read = action('speaker', t('Озвучить ответ'));
    read.dataset.readReply = '';
    read.disabled = !supportsSpeech;
    on(read, 'click', () => {
      if (speaking?.button === read) stopSpeech();
      else say(plainReply(reply.text), read);
    });
    const sources = replySources(reply);
    if (sources.length) {
      const button = action('sources', t('Источники'));
      button.setAttribute('aria-haspopup', 'dialog');
      on(button, 'click', () => openReplySources(sources));
    }
    message.append(actions);
  }

  async function sendQuestion(value) {
    const question = value.trim();
    if (!question || question.length > 500 || sending) return;
    stopSpeech();
    sending = true;
    showError('');
    dictation?.resetPause();
    questionInput.value = '';
    const user = { user: true, text: question };
    turns.insertAdjacentHTML('beforeend', renderMessage(user));
    const bubble = turns.lastElementChild;
    sendMotion(bubble, send.firstElementChild);
    const waiting = waitingMessage();
    turns.append(waiting);
    setPhase('thinking');
    scrollToLatest();
    const started = performance.now();
    let reply;
    try {
      reply = await ask(question);
      if (signal.aborted) return;
      if (!reply) {
        bubble.remove();
        questionInput.value ||= question;
        return;
      }
      messages.push(user, reply);
      // Store the complete turn before presentation so reopening the chat is instant.
      if (!document.hidden) await pause(thinkingMs - (performance.now() - started), signal);
      if (signal.aborted) return;

      const template = document.createElement('template');
      template.innerHTML = renderMessage(reply);
      const message = template.content.firstElementChild;
      const preview = document.createElement('div');
      preview.className = 'message reply-markdown';
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      function follow() {
        const nearEnd = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 64;
        return () => {
          if (nearEnd) {
            const item = message.isConnected ? message : preview;
            const top = item.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
            transcript.scrollTop = Math.min(transcript.scrollHeight - transcript.clientHeight,
              transcript.scrollTop + Math.max(0, top - 12));
          }
        };
      }
      waiting.replaceWith(preview);
      setPhase('writing');
      await revealReplyText(message, preview, signal,
        () => !document.hidden && !reduceMotion.matches, follow);
      if (signal.aborted) return;
      const keepPosition = follow();
      addReplyActions(message, reply);
      preview.replaceWith(message);
      keepPosition();
    } catch (cause) {
      if (signal.aborted) return;
      bubble.remove();
      questionInput.value ||= question;
      const message = cause.name === 'TimeoutError' ? t('Ответ задерживается. Попробуйте ещё раз.') : cause.message;
      showError(message);
    } finally {
      if (!signal.aborted) {
        sending = false;
        waiting.remove();
        setPhase('ready');
      }
    }
  }

  on(form, 'submit', event => {
    event.preventDefault();
    if (!dictation?.active) void sendQuestion(questionInput.value);
  });
  on(questionInput, 'input', () => {
    showError('');
    updateControls();
  });
  for (const button of topicButtons) {
    on(button, 'click', () => void sendQuestion(button.dataset.question));
  }
  on(window, 'pagehide', () => dictation?.close());
  on(document, 'visibilitychange', () => {
    root.classList.toggle('conversation-in-background', document.hidden);
    if (!document.hidden) return;
    dictation?.close();
    stopSpeech();
  });

  const asset = guide.id !== 'gorky' && !guide.image && Object.hasOwn(avatarModels, guide.id) ? avatarModels[guide.id] : null;
  if (asset) {
    import('./avatar-model.mjs').then(async ({ mountAvatar }) => {
      if (signal.aborted) return;
      model = await mountAvatar(avatarFrame, asset, signal);
      if (phase === 'speaking') model?.setSpeaking(true);
    }).catch(() => {
      // The guide's regular portrait stays visible if the 3D scene can't load.
    });
  }

  messages.forEach((message, index) => {
    if (!message.user) addReplyActions(turns.children[index + 1], message);
  });
  updateControls();
  scrollToLatest();

  return {
    destroy() {
      listeners.abort();
      dictation?.close();
      stopPortraitMotion();
      stopSpeech();
      model?.dispose();
    },
  };
}
