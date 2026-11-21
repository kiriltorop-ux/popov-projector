import { t } from './i18n.mjs';
import MarkdownIt from './vendor/markdown-it-15.0.3.mjs';

const markdown = new MarkdownIt({ html: false, breaks: true });
const isLocalPhoto = url => /^\.\/assets\/[a-z0-9_-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(url);

function isHttps(url) {
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

markdown.validateLink = url => isHttps(url) || isLocalPhoto(url) || url.startsWith('#');

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  if (isHttps(token.attrGet('href'))) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, index, options);
};

const renderImage = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const url = token.attrGet('src');
  if (!isLocalPhoto(url) && !isHttps(url)) return markdown.utils.escapeHtml(token.content);
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  token.attrSet('referrerpolicy', 'no-referrer');
  const image = renderImage(tokens, index, options, env, self);
  const linkBoundary = tokens.slice(0, index).findLast(item => item.type === 'link_open' || item.type === 'link_close');
  return linkBoundary?.type === 'link_open' ? image
    : `<button type="button" class="reply-photo-open" aria-label="${markdown.utils.escapeHtml(t('Увеличить фото'))}">${image}</button>`;
};

export function renderReplyMarkdown(text) {
  return markdown.render(text);
}

function inlineText(tokens) {
  return tokens.map(token => {
    switch (token.type) {
      case 'text':
      case 'code_inline':
        return token.content;
      case 'softbreak':
      case 'hardbreak':
        return '\n';
      case 'image':
        return inlineText(token.children);
      default:
        return '';
    }
  }).join('');
}

export function plainReply(text) {
  return markdown.parse(text, {}).flatMap(token => {
    if (token.type === 'inline') return inlineText(token.children);
    if (token.type === 'fence' || token.type === 'code_block') return token.content.trimEnd();
    return [];
  }).filter(Boolean).join('\n').trim();
}
