import { messages } from './translations.mjs';

const key = 'gorod-govorit-language';
export const languages = [
  {id: 'ru', name: 'Русский', tag: 'ru-RU'},
  {id: 'en', name: 'English', tag: 'en-US'},
  {id: 'zh', name: '简体中文', tag: 'zh-CN'},
];
let current = 'ru';
try {
  const stored = localStorage.getItem(key);
  if (languages.some(item => item.id === stored)) current = stored;
} catch { /* Russian works when browser storage is unavailable. */ }

export const locale = () => current;
export const speechLocale = () => languages.find(item => item.id === current).tag;

export function setLocale(value) {
  if (!languages.some(item => item.id === value)) return false;
  current = value;
  try { localStorage.setItem(key, value); } catch {}
  return true;
}

export function t(text, values) {
  const result = messages.get(text)?.[current === 'en' ? 0 : current === 'zh' ? 1 : -1] ?? text;
  return values ? result.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match) : result;
}

export function applyPageLanguage() {
  document.documentElement.lang = current === 'zh' ? 'zh-Hans' : current;
  document.title = t('Город говорит — ваши цифровые гиды');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nLabel)));
}

export function localizedGuide(guide) {
  return {...guide, name:t(guide.name), role:t(guide.role), greeting:t(guide.greeting),
    docs: guide.docs?.map(doc => ({...doc, title:t(doc.title), text:t(doc.text), tags:t(doc.tags ?? '')})),
  };
}
