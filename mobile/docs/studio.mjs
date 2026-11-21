import { studioProfileRender, studioMaterialRender, studioKnowledgeRender, studioPreviewRender, studioPageRender, materialEditorRender } from './vue-renders.mjs';
import { AppIcon, GuidePortrait } from './views.mjs?v=matching-gorky';
import { sources } from './data.mjs?v=river-design';

const appearances = [
  ['writer', 'Писатель'],
  ['guide', 'Проводник'],
  ['fox', 'Лис'],
  ['custom', 'Свой герой'],
];
const voices = [
  ['calm', 'Спокойный рассказчик'],
  ['friendly', 'Дружелюбный проводник'],
];

const StudioProfile = {
  props: ['guide', 'actions'],
  components: { AppIcon, GuidePortrait },
  setup() { return { appearances, voices }; },
  render: studioProfileRender,
  template: `<form id="guideForm" class="studio-profile"
      @input="actions.captureDraft" @change="actions.captureDraft" @submit.prevent="actions.saveGuide">
    <section class="studio-media" aria-labelledby="studioPortraitTitle">
      <GuidePortrait :guide="guide" extra="studio-portrait" />
      <div class="studio-photo-tools">
        <h2 id="studioPortraitTitle">Портрет</h2>
        <label class="studio-button studio-upload">
          <AppIcon name="plus" /> <span>{{ guide.image ? 'Заменить фото' : 'Загрузить фото' }}</span>
          <input type="file" id="avatarUpload" @change="actions.uploadImage" accept="image/png,image/jpeg,image/webp" aria-describedby="studioPhotoHint">
        </label>
        <p class="studio-note" id="studioPhotoHint">PNG, JPEG или WebP · до 1 МБ</p>
        <button v-if="guide.image" type="button" class="studio-text-button" id="resetImage" @click="actions.resetImage">Вернуть стандартный образ</button>
      </div>
    </section>

    <div class="studio-edit">
      <section class="studio-fields" aria-labelledby="studioProfileTitle">
        <h2 id="studioProfileTitle">Профиль</h2>
        <div class="studio-pair">
          <label class="studio-field">
            <span>Имя персонажа</span>
            <input name="name" required maxlength="60" :value="guide.name">
          </label>
          <label class="studio-field">
            <span>Роль</span>
            <input name="role" required maxlength="100" :value="guide.role">
          </label>
        </div>
        <label class="studio-field">
          <span>Приветствие</span>
          <textarea name="greeting" rows="3" required maxlength="500" :value="guide.greeting"></textarea>
        </label>
      </section>

      <details class="studio-details">
        <summary><AppIcon name="studio" /><span>Голос и оформление</span><AppIcon name="caret" /></summary>
        <div class="studio-details-content">
          <div class="studio-pair">
            <label class="studio-field">
              <span>Характер голоса</span>
              <select name="voice" aria-describedby="studioVoiceHint"><option v-for="[value, label] in voices" :key="value" :value="value" :selected="guide.voice === value">{{ label }}</option></select>
              <small id="studioVoiceHint">Используется русский голос браузера</small>
            </label>
            <label class="studio-field">
              <span>Базовый образ</span>
              <select name="art"><option v-for="[value, label] in appearances" :key="value" :value="value" :selected="guide.art === value">{{ label }}</option></select>
            </label>
          </div>
          <div class="studio-pair studio-colors">
            <label class="studio-field">
              <span>Категория</span>
              <input name="tag" maxlength="60" :value="guide.tag">
            </label>
            <label class="studio-field">
              <span>Цвет фона</span>
              <input type="color" name="color" :value="guide.color">
            </label>
          </div>
        </div>
      </details>

      <details class="studio-details studio-manage">
        <summary><AppIcon name="more" /><span>Управление персонажем</span><AppIcon name="caret" /></summary>
        <div class="studio-details-content studio-actions">
          <button type="button" class="studio-button" id="exportGuide" @click="actions.exportGuide">Экспорт JSON</button>
          <button type="button" class="studio-button" id="duplicateGuide" @click="actions.duplicateGuide">Дублировать</button>
          <button type="button" class="studio-button studio-danger" id="deleteGuide" @click="actions.deleteGuide">Удалить персонажа</button>
        </div>
      </details>

      <div class="studio-save">
        <div id="guideError" class="error" role="alert"></div>
        <button type="submit" class="studio-button studio-primary">Сохранить персонажа<AppIcon name="check" /></button>
      </div>
    </div>
  </form>`,
};

const StudioMaterial = {
  props: ['doc', 'edit'],
  computed: {
    excerpt() {
      const text = this.doc.text.trim().replace(/\s+/g, ' ');
      return text.length > 130 ? text.slice(0, 130).replace(/\s+\S*$/, '') + '…' : text;
    },
    sourceLabel() {
      return (sources[this.doc.source]?.title || this.doc.source)
        + (this.doc.checkedAt ? ' · проверено ' + this.doc.checkedAt : '');
    },
  },
  render: studioMaterialRender,
  template: `<li class="studio-material">
    <div class="studio-material-content">
      <h3>{{ doc.title }}</h3>
      <p class="studio-material-excerpt">{{ excerpt }}</p>
      <p class="studio-note">{{ sourceLabel }}</p>
    </div>
    <button type="button" class="studio-button studio-material-edit" :data-doc="doc.id" :aria-label="'Изменить ' + doc.title" @click="edit(doc.id)">Изменить</button>
  </li>`,
};

const StudioKnowledge = {
  props: ['guide', 'actions'],
  components: { AppIcon, StudioMaterial },
  render: studioKnowledgeRender,
  template: `<section class="studio-knowledge" aria-labelledby="studioKnowledgeTitle">
    <header class="studio-knowledge-header">
      <h2 id="studioKnowledgeTitle">База знаний</h2>
      <button type="button" class="studio-button studio-primary" id="addDoc" @click="actions.addMaterial" aria-label="Добавить материал"><AppIcon name="plus" /><span>Материал</span></button>
    </header>
    <ul v-if="guide.docs.length" class="studio-materials">
      <StudioMaterial v-for="doc in guide.docs" :key="doc.id" :doc="doc" :edit="actions.editMaterial" />
    </ul>
    <div v-else class="studio-empty">
      <strong>Пока нет материалов</strong>
      <p>Добавьте первый факт с источником, чтобы гид мог на него опираться.</p>
    </div>
  </section>`,
};

const StudioPreview = {
  props: ['guide', 'actions'],
  components: { AppIcon, GuidePortrait },
  render: studioPreviewRender,
  template: `<section class="studio-preview" aria-label="Предпросмотр персонажа">
    <div class="studio-preview-stage" :style="{ '--studio-preview-color': guide.color }"><GuidePortrait :guide="guide" extra="studio-portrait" /></div>
    <div class="studio-preview-content">
      <div class="studio-preview-identity">
        <h2>{{ guide.name }}</h2>
        <p>{{ guide.role }}</p>
      </div>
      <blockquote class="studio-preview-greeting">{{ guide.greeting }}</blockquote>
      <div class="studio-actions">
        <button type="button" class="studio-button studio-primary" id="previewChatFromCard" @click="actions.previewChat">Проверить диалог<AppIcon name="chat" /></button>
        <button type="button" class="studio-button" id="screenStudio" @click="actions.openScreen">Экран посетителя<AppIcon name="screen" /></button>
      </div>
    </div>
  </section>`,
};

export const StudioPage = {
  props: ['guide', 'guides', 'tab', 'actions'],
  components: { AppIcon, StudioProfile, StudioKnowledge, StudioPreview },
  setup() {
    return { tabs: [['profile', 'Образ'], ['knowledge', 'Знания'], ['preview', 'Просмотр']] };
  },
  render: studioPageRender,
  template: `<section class="guide-studio" aria-labelledby="studioTitle">
    <header class="studio-heading">
      <h1 id="studioTitle">Студия гида</h1>
      <button type="button" class="studio-button studio-create" id="newGuide" @click="actions.newGuide" title="Новый гид"><AppIcon name="plus" /><span>Новый гид</span></button>
    </header>
    <div class="studio-toolbar">
      <div class="studio-picker">
        <label for="guidePicker">Персонаж</label>
        <select id="guidePicker" @change="actions.selectGuide($event.target.value)">
          <option v-for="item in guides" :key="item.id" :value="item.id" :selected="item.id === guide.id">
            {{ item.id === guide.id ? guide.name : item.name }}
          </option>
        </select>
        <button type="button" class="studio-button studio-open-chat" id="previewChat" @click="actions.previewChat" aria-label="Проверить диалог" title="Проверить диалог"><AppIcon name="chat" /></button>
      </div>
      <div id="studioStatusSlot"></div>
    </div>
    <div class="studio-tabs" role="tablist" aria-label="Настройка персонажа">
      <button v-for="[id, label] in tabs" :key="id" type="button" :id="'studio-' + id" role="tab"
          :aria-selected="tab === id" aria-controls="studioPanel" :tabindex="tab === id ? 0 : -1" :data-studio-tab="id"
          @click="actions.selectTab(id)" @keydown="actions.tabKeys">
        {{ label }}<span v-if="id === 'knowledge'">{{ guide.docs.length }}</span>
      </button>
    </div>
    <div id="studioPanel" role="tabpanel" :aria-labelledby="'studio-' + tab">
      <StudioProfile v-if="tab === 'profile'" :guide="guide" :actions="actions" />
      <StudioKnowledge v-else-if="tab === 'knowledge'" :guide="guide" :actions="actions" />
      <StudioPreview v-else :guide="guide" :actions="actions" />
    </div>
    <details class="studio-details">
      <summary><AppIcon name="studio" /><span>Резервная копия</span><AppIcon name="caret" /></summary>
      <div class="studio-details-content">
        <label class="studio-field">
          <span>Импорт проекта или персонажа</span>
          <input type="file" id="importProject" @change="actions.importProject" accept="application/json,.json">
        </label>
      </div>
    </details>
  </section>`,
};

export const MaterialEditor = {
  props: ['doc', 'editing', 'actions'],
  components: { AppIcon },
  computed: {
    knownSource() { return Object.hasOwn(sources, this.doc.source) ? sources[this.doc.source] : undefined; },
  },
  render: materialEditorRender,
  template: `<div class="modal-backdrop" @click.self="actions.close">
    <section class="modal-card studio-material-editor" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <header class="studio-modal-heading">
        <h2 id="modalTitle">{{ editing ? 'Редактировать материал' : 'Добавить материал' }}</h2>
        <button type="button" class="studio-button" id="closeModal" @click="actions.close" aria-label="Закрыть"><AppIcon name="close" /></button>
      </header>
      <form id="docForm" @submit.prevent="actions.save">
        <label class="studio-field">
          <span>Название</span>
          <input name="title" required maxlength="150" :value="doc.title">
        </label>
        <label class="studio-field">
          <span>Проверенный текст</span>
          <textarea name="text" rows="5" required maxlength="6000" :value="doc.text"></textarea>
        </label>
        <div class="studio-pair">
          <label class="studio-field">
            <span>Название источника</span>
            <input name="source" required maxlength="300" :value="knownSource?.title || doc.source">
          </label>
          <label class="studio-field">
            <span>Дата проверки</span>
            <input name="checkedAt" type="date" :value="doc.checkedAt">
          </label>
        </div>
        <label class="studio-field">
          <span>Ссылка на источник</span>
          <input name="url" type="url" placeholder="https://…" maxlength="2000" :value="doc.url || knownSource?.url || ''">
        </label>
        <label class="studio-field">
          <span>Ключевые слова</span>
          <input name="tags" maxlength="500" placeholder="Например: выставка, кремль" :value="doc.tags">
        </label>
        <div class="error" id="docError" role="alert"></div>
        <div class="studio-actions studio-material-save">
          <button class="studio-button studio-primary" type="submit">Сохранить материал</button>
          <button v-if="editing" type="button" class="studio-button studio-danger" id="deleteDoc" @click="actions.remove">Удалить</button>
        </div>
      </form>
    </section>
  </div>`,
};
