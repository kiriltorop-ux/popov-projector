import { guidePortraitRender, appHeaderRender, appNavigationRender, guideCardRender, guideCatalogueRender, guidePageRender, mapPageRender, aboutPageRender, visitorScreenRender, statisticsPageRender } from './vue-renders.mjs?v=guide-flow';
import { createStaticVNode, defineComponent, h, onBeforeUnmount, onMounted, ref } from './vendor/vue.esm-browser.prod.mjs';
import { icon } from './icons.mjs?v=river-design';
import { languages, t } from './i18n.mjs';
import { mountProjectionMap, openCoordinates, projectionSites } from './projection-map.mjs?v=guide-flow';

const illustrations = { writer: 'gorky', guide: 'nika', fox: 'boris' };
const archivePortraitPath = id => './assets/guide-portraits/' + id + '.webp';
const archiveSizes = {
  gorky: { width: 370, height: 370 },
  popov: { width: 532, height: 500 },
  chkalov: { width: 376, height: 480 },
  minin: { width: 293, height: 345 },
  gorodovoy: { width: 381, height: 480 },
};

export const AppIcon = defineComponent({
  props: { name: String, markup: String },
  setup(props) {
    return () => createStaticVNode(props.markup || icon(props.name), 1);
  },
});

export const PortraitImage = defineComponent({
  props: { guide: { type: Object, required: true }, useArchive: Boolean },
  setup(props) {
    return () => {
      const guide = props.guide;
      const illustration = Object.hasOwn(illustrations, guide.art) ? illustrations[guide.art] : 'nika';
      const archive = props.useArchive || (!guide.image && guide.id === 'gorky');
      const source = archive ? archivePortraitPath(guide.id) : guide.image || './assets/illustrations/' + illustration + '.webp';
      return h('img', {
        class: archive ? 'archival-portrait' : guide.image ? 'uploaded-portrait' : 'illustrated-portrait',
        src: source,
        alt: guide.name,
        ...(archive ? archiveSizes[guide.id] : !guide.image && { width: 560, height: 560 }),
        decoding: 'async',
      });
    };
  },
});

export const GuidePortrait = {
  props: ['guide', 'extra'],
  components: { PortraitImage },
  render: guidePortraitRender,
  template: `<div :class="['portrait', extra]" :style="{ '--portrait': guide.color }">
    <PortraitImage :guide="guide" />
  </div>`,
};

function releasePress(event) {
  if (event.isPrimary) event.currentTarget.classList.remove('is-pressed');
}
const pressFeedback = {
  pointerdown(event) {
    if (event.isPrimary && event.button === 0) event.currentTarget.classList.add('is-pressed');
  },
  pointerup: releasePress,
  pointercancel: releasePress,
  pointerleave: releasePress,
};

export const AppHeader = {
  props: ['showLanguages', 'language'],
  emits: ['language'],
  components: { AppIcon },
  setup(props, {emit}) {
    const menu = ref(null);
    function dismiss(restoreFocus = false) {
      if (!menu.value?.open) return;
      menu.value.open = false;
      if (restoreFocus) menu.value.querySelector('summary').focus();
    }
    function outside(event) {
      if (!menu.value?.contains(event.target)) dismiss();
    }
    function keys(event) {
      if (event.key === 'Escape' && menu.value.open) {
        event.preventDefault();
        dismiss(true);
        return;
      }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      menu.value.open = true;
      const options = [...menu.value.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      let next = index < 0 ? languages.findIndex(item => item.id === props.language)
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = options.length - 1;
      options[next].focus();
    }
    function choose(id) {
      dismiss(true);
      emit('language', id);
    }
    onMounted(() => {
      document.addEventListener('pointerdown', outside);
      document.addEventListener('focusin', outside);
    });
    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    });
    return { languages, menu, keys, choose, pressFeedback, t };
  },
  render: appHeaderRender,
  template: `
    <a href="#home" class="brand" :aria-label="t('Город говорит, главная')">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M5 36 17 30V15l7-10 7 10v15l12 6-19 7z" fill="currentColor" />
        <path d="M22 17v12m5-12v12M5 37l19-5 19 5" stroke="#cce3ff" stroke-width="2" />
      </svg>
      <span>{{ t('Город говорит') }}<small class="brand-light">{{ t('Нижний Новгород') }}</small></span>
    </a>
    <details v-if="showLanguages" ref="menu" class="language-menu" @keydown="keys">
      <summary class="language-picker" v-on="pressFeedback" :aria-label="t('Язык приложения') + ': ' + languages.find(item => item.id === language).name">
        <svg class="language-globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>
        <span>{{ languages.find(item => item.id === language).name }}</span>
        <svg class="language-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
      </summary>
      <div class="language-options" role="group" :aria-label="t('Язык приложения')">
        <button v-for="item in languages" :key="item.id" type="button" :lang="item.tag"
          :aria-pressed="item.id === language" @click="choose(item.id)">
          {{ item.name }}<span v-if="item.id === language" class="language-check" aria-hidden="true"><AppIcon name="check" /></span>
        </button>
      </div>
    </details>
  `,
};

const sections = [
  { route: 'home', label: 'Главная', icon: 'home' },
  { route: 'scan', label: 'Сканировать QR-код', icon: 'qr' },
  { route: 'map', label: 'Карта', icon: 'map' },
];

export const AppNavigation = {
  props: ['page'],
  emits: ['scan'],
  components: { AppIcon },
  setup() { return { sections, t }; },
  render: appNavigationRender,
  template: `
    <template v-for="section in sections" :key="section.route">
      <button v-if="section.route === 'scan'" type="button" class="nav-scan" :aria-label="t(section.label)"
        aria-haspopup="dialog" @click="$emit('scan')">
        <AppIcon :name="section.icon" />
      </button>
      <a v-else :href="'#' + section.route" :data-nav="section.route"
         :class="{active: section.route === page}"
         :aria-current="section.route === page ? 'page' : null">
        <AppIcon :name="section.icon" /><span>{{ t(section.label) }}</span>
      </a>
    </template>
  `,
};

export function highlightNavigation(nav, page) {
  const index = sections.findIndex(item => item.route === page);
  nav.toggleAttribute('data-current', index >= 0);
  if (index >= 0) nav.style.setProperty('--nav-index', index);
}

const GuideCard = {
  props: ['entry'],
  components: { AppIcon },
  setup() { return { archivePortraitPath, archiveSizes, pressFeedback, t }; },
  render: guideCardRender,
  template: `
    <article :data-guide="entry.id" :class="['guide-card', entry.spotlight ? 'guide-spotlight' : 'guide-compact']">
      <div class="guide-profile">
        <div class="guide-title">
          <h2>{{ entry.name }}</h2>
          <p v-if="entry.category" class="guide-caption">{{ entry.category }}</p>
        </div>
      </div>
      <div aria-hidden="true" class="guide-portrait" :data-portrait-for="entry.id">
        <img class="guide-archive-portrait" :src="archivePortraitPath(entry.id)" alt="" decoding="async"
          v-bind="archiveSizes[entry.id]" :loading="entry.spotlight ? 'eager' : 'lazy'" :fetchpriority="entry.spotlight ? 'high' : null">
      </div>
      <a class="guide-card-open" :href="'#guide/' + entry.id" data-flow-link :aria-label="t('О персонаже: {name}', {name: entry.name})">
        <span v-if="entry.spotlight" class="guide-talk" v-on="pressFeedback">{{ t('О персонаже') }}</span>
        <span class="guide-open-icon" aria-hidden="true" v-on="pressFeedback"><AppIcon name="arrow" /></span>
      </a>
    </article>
  `,
};

export const GuideCatalogue = {
  props: ['entries'],
  components: { GuideCard },
  setup() { return { t }; },
  render: guideCatalogueRender,
  template: `
    <section class="guide-library guide-collection" aria-labelledby="catalogue-title">
      <h1 id="catalogue-title" class="visually-hidden">{{ t('Гиды') }}</h1>
      <GuideCard :entry="entries[0]" />
      <div class="compact-guides">
        <GuideCard v-for="entry in entries.slice(1)" :key="entry.id" :entry="entry" />
      </div>
    </section>
  `,
};

export const GuidePage = {
  props: ['guide', 'site', 'back'],
  emits: ['scan'],
  components: { AppIcon, PortraitImage },
  render: guidePageRender,
  setup(props) {
    const canvas = ref(null);
    const lifecycle = new AbortController();
    onMounted(async () => {
      if (!props.site) return;
      try {
        const map = await mountProjectionMap(canvas.value, {site: props.site, signal: lifecycle.signal});
        map?.setLayer('street');
      } catch {
        // The location and its external map link remain available.
        if (canvas.value) canvas.value.hidden = true;
      }
    });
    onBeforeUnmount(() => lifecycle.abort());
    return {canvas, openCoordinates, t};
  },
  template: `
    <article class="guide-detail" :data-guide="guide.id" aria-labelledby="guide-detail-title">
      <header class="guide-detail-header">
        <a :href="back" data-flow-back class="conversation-back round-control" :aria-label="t('Назад')"><AppIcon name="caret" /></a>
        <h1 id="guide-detail-title" tabindex="-1">{{ guide.name }}</h1>
      </header>
      <div class="guide-detail-card">
        <div class="guide-detail-portrait"><PortraitImage :guide="guide" :use-archive="guide.id !== 'gorky' || !guide.image" /></div>
        <p class="guide-detail-role">{{ guide.role }}</p>
        <p>{{ site ? t(site.story) : guide.greeting }}</p>
      </div>
      <div class="guide-detail-action">
        <button type="button" class="button" aria-haspopup="dialog" @click="$emit('scan')">
          <AppIcon name="qr" />{{ t('Сканировать QR-код') }}
        </button>
      </div>
      <section v-if="site" class="guide-detail-site" aria-labelledby="guide-detail-place">
        <div class="guide-detail-address">
          <h2 id="guide-detail-place">{{ t(site.place) }}</h2>
          <p>{{ t(site.location) }}</p>
        </div>
        <div ref="canvas" class="guide-detail-map" role="region" :aria-label="t('Карта точек проекции')"></div>
        <a class="text-link" :href="openCoordinates(site)" target="_blank" rel="noopener">{{ t('Открыть в Яндекс Картах') }} <AppIcon name="arrow" /></a>
      </section>
    </article>
  `,
};

export const MapPage = {
  props: ['memory'],
  emits: ['choose'],
  components: { AppIcon },
  render: mapPageRender,
  setup(props, {emit}) {
    const canvas = ref(null);
    const list = ref(null);
    const memory = props.memory;
    const sheet = ref(null);
    const handle = ref(null);
    const expanded = ref(Boolean(memory.sheetOpen));
    const dragHeight = ref(null);
    let gesture;
    let suppressClick = false;
    function setExpanded(open) {
      expanded.value = memory.sheetOpen = open;
      if (!open) list.value.scrollTop = 0;
    }
    function startDrag(event) {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({preventScroll:true});
      suppressClick = false;
      gesture = {id:event.pointerId, y:event.clientY, height:sheet.value.offsetHeight};
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    function moveDrag(event) {
      if (gesture?.id !== event.pointerId) return;
      const distance = gesture.y - event.clientY;
      if (Math.abs(distance) > 5 || dragHeight.value !== null) dragHeight.value = gesture.height + distance;
    }
    function endDrag(event) {
      if (gesture?.id !== event.pointerId) return;
      const distance = gesture.y - event.clientY;
      suppressClick = dragHeight.value !== null || Math.abs(distance) > 5;
      if (event.type === 'pointerup' && Math.abs(distance) > 24) setExpanded(distance > 0);
      gesture = null;
      dragHeight.value = null;
    }
    function toggleSheet(event) {
      if (!suppressClick || event.detail === 0) setExpanded(!expanded.value);
      suppressClick = false;
    }
    const layer = ref(memory.layer);
    const status = ref('');
    const lifecycle = new AbortController();
    let map;
    function select(index, source) {
      const {id} = projectionSites[index];
      memory.selected = id;
      memory.focus = source;
      memory.sheetScroll = list.value.scrollTop;
      emit('choose', id);
    }
    function basemap(kind) {
      layer.value = kind;
      memory.layer = kind;
      map?.setLayer(kind);
    }
    onMounted(async () => {
      const rows = [...list.value.children];
      function measureSheet() {
        const top = handle.value.offsetHeight + 2;
        sheet.value.parentElement.style.setProperty('--sheet-peek', (top + rows[0].offsetHeight) + 'px');
        sheet.value.style.setProperty('--sheet-full', (top + rows.reduce((sum, row) => sum + row.offsetHeight, 0)) + 'px');
      }
      measureSheet();
      const size = new ResizeObserver(measureSheet);
      [handle.value, ...rows].forEach(element => size.observe(element));
      lifecycle.signal.addEventListener('abort', () => size.disconnect(), {once:true});
      if (expanded.value) list.value.scrollTop = memory.sheetScroll || 0;
      const focus = memory.focus;
      memory.focus = null;
      if (focus === 'list') list.value?.querySelector(`[data-site="${memory.selected}"]`)?.focus({preventScroll: true});
      try {
        map = await mountProjectionMap(canvas.value, {
          initialView: memory.view,
          onViewChange: view => { memory.view = view; },
          onSelect: index => select(index, 'pin'),
          onTileStatus: text => { status.value = text; },
          signal: lifecycle.signal,
        });
        if (lifecycle.signal.aborted) return;
        map.highlight(memory.selected);
        map.setLayer(layer.value);
        if (focus === 'pin' && document.activeElement === document.body) {
          canvas.value.querySelector(`[data-site="${memory.selected}"]`)?.focus({preventScroll: true});
        }
      } catch {
        if (!lifecycle.signal.aborted) status.value = t('Карта недоступна. Точки можно открыть из списка ниже.');
      }
    });
    onBeforeUnmount(() => lifecycle.abort());
    return {canvas, list, sheet, handle, expanded, dragHeight, startDrag, moveDrag, endDrag, toggleSheet,
      setExpanded, layer, status, select, basemap, sites: projectionSites, t};
  },
  template: `
    <section class="projection-map" aria-labelledby="projection-map-title">
      <header class="visually-hidden">
        <h1 id="projection-map-title">{{ t('Нижний Новгород') }}</h1>
      </header>
      <div class="projection-map-frame">
        <div ref="canvas" class="projection-map-canvas" role="region" :aria-label="t('Карта точек проекции')"></div>
        <div class="projection-map-layers" role="group" :aria-label="t('Вид карты')">
          <button type="button" :aria-pressed="layer === 'street'" @click="basemap('street')">{{ t('Схема') }}</button>
          <button type="button" :aria-pressed="layer === 'satellite'" @click="basemap('satellite')">{{ t('Спутник') }}</button>
        </div>
        <p v-if="status" class="projection-map-status" role="status">{{ status }}</p>
      </div>
      <div ref="sheet" class="projection-sheet" :class="{'is-expanded':expanded, 'is-dragging':dragHeight !== null}"
        :style="{'--drag-height':dragHeight === null ? null : dragHeight + 'px'}"
        @keydown.esc="setExpanded(false); handle.focus()">
        <button ref="handle" type="button" class="projection-sheet-handle" :aria-expanded="expanded"
          aria-controls="projection-site-list" @click="toggleSheet" @pointerdown="startDrag" @pointermove="moveDrag"
          @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
          <span aria-hidden="true" class="sheet-grip"></span>
          {{ t('Точки на карте') }}
        </button>
        <ul ref="list" id="projection-site-list" class="projection-sites" :aria-label="t('Пять точек проекции')">
          <li v-for="(site, index) in sites" :key="site.id" :inert="!expanded && index > 0">
            <button type="button" :data-site="site.id" @click="select(index, 'list')">
              <span class="projection-site-index" aria-hidden="true">{{ index + 1 }}</span>
              <span class="projection-site-label"><strong>{{ t(site.place) }}</strong><small>{{ t(site.guide) }}</small></span>
              <AppIcon name="caret" />
            </button>
          </li>
        </ul>
      </div>
    </section>
  `,
};

export const AboutPage = {
  components: { AppIcon },
  setup() { return { archivePortraitPath, t }; },
  render: aboutPageRender,
  template: `
    <article class="about about-project" aria-labelledby="aboutTitle">
      <h1 id="aboutTitle">{{ t('О проекте') }}</h1>
      <p class="about-intro">{{ t('«Город говорит» знакомит с историей Нижнего Новгорода через разговор с цифровыми образами людей, связанных с городом.') }}</p>
      <p>{{ t('Спросите Попова о радиоприёмнике, Чкалова — о перелёте через Северный полюс, Минина — об ополчении. Городовой расскажет о старом Нижнем, а Максим Горький — о литературе.') }}</p>
      <p>{{ t('Выберите персонажа на главной или на карте, чтобы открыть его страницу.') }}</p>
      <a class="button about-start" href="#home">{{ t('Выбрать гида') }} <AppIcon name="arrow" /></a>
    </article>
  `,
};

export const VisitorScreen = {
  props: ['guide', 'round'],
  emits: ['format', 'fullscreen', 'reset', 'stop-voice', 'ask'],
  components: { GuidePortrait },
  setup() { return { t }; },
  render: visitorScreenRender,
  template: `
    <section :class="['screen-layout', round ? 'round-format' : 'monitor-format']">
      <div class="screen-top">
        <div><strong>{{ t('Город говорит') }}</strong><p>Предпросмотр экрана · оборудование не подключено</p></div>
        <a href="#studio" class="button white small">Вернуться в студию</a>
      </div>
      <div class="screen-controls">
        <button class="button white small" id="screenFormat" @click="$emit('format')">{{ round ? 'Формат монитора' : 'Круглый формат' }}</button>
        <button class="button white small" id="fullscreen" @click="$emit('fullscreen')">Во весь экран</button>
        <button class="button white small" id="resetSession" @click="$emit('reset')">Новый посетитель</button>
        <button class="button white small" id="stopVoice" @click="$emit('stop-voice')">Остановить речь</button>
      </div>
      <div id="screenPortrait"><GuidePortrait :guide="guide" /></div>
      <div class="bars" aria-hidden="true"><i v-for="number in 9" :key="number"></i></div>
      <h1>{{ guide.name }}</h1>
      <p class="subtitle">{{ guide.role }} · цифровой образ</p>
      <div class="screen-subtitle" id="screenAnswer" aria-live="polite">{{ guide.greeting }}</div>
      <form class="ask-form" id="askForm" @submit.prevent="$emit('ask', $event)">
        <input id="question" name="question" :aria-label="t('Ваш вопрос')" :placeholder="t('Напишите вопрос…')" maxlength="500" required autocomplete="off" enterkeyhint="send">
        <button class="button" id="sendQuestion">Спросить</button>
      </form>
      <div id="askError" class="error" role="alert"></div>
      <label class="screen-voice-label"><input type="checkbox" id="voiceToggle" style="vertical-align:middle"> Озвучивать ответы</label>
      <p class="note" style="color:#a6c1c6">Круглый предпросмотр иллюстрирует формат LED-дисплея. Синхронизация губ не реализована.</p>
    </section>
  `,
};

export const StatisticsPage = {
  props: ['asks', 'likes'],
  emits: ['export'],
  render: statisticsPageRender,
  template: `
    <div class="page-heading">
      <div>
        <div class="eyebrow muted">Результаты вашей демонстрации</div>
        <h1>Статистика</h1>
        <p>События этой рабочей области. Данные появляются после реальных действий.</p>
      </div>
      <button class="button secondary" id="exportEvents" @click="$emit('export')">Экспорт событий</button>
    </div>
    <div class="metric-grid">
      <div class="metric"><strong>{{ asks }}</strong><span>Заданных вопросов</span></div>
      <div class="metric"><strong>{{ likes }}</strong><span>Полезных ответов</span></div>
    </div>
    <section class="panel">
      <h2>Как проверять гипотезу</h2>
      <p>Пригласите 10 участников. Попросите выбрать гида, задать вопрос и открыть источник ответа. Запишите, кому потребовалась помощь и сколько заняло выполнение.</p>
      <p class="note">Счётчики отражают события, а не число уникальных туристов. Хранятся последние 200 событий; тексты вопросов в статистику не записываются.</p>
      <a href="#home" class="button">Начать проверку</a>
    </section>
  `,
};
