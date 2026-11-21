import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState } from '../docs/data.mjs';
import { answer } from '../docs/engine.mjs';
import { plainReply, renderReplyMarkdown } from '../docs/reply-markdown.mjs';

test('City guides can share photos from the existing catalogue', () => {
  const [gorky, nika, boris] = initialState().guides;
  for (const [question, expected] of [
    ['Покажите фото кремля', 'kremlin'],
    ['Покажи фотку Чкаловской лестницы', 'stairs'],
    ['Как выглядит Нижне-Волжская набережная?', 'river'],
    ['Покажи снимок Рождественской церкви', 'church'],
  ]) {
    assert.equal(answer(question, gorky).photoId, expected);
  }
  assert.equal(answer('Что посмотреть в кремле?', nika).photoId, 'kremlin');
  assert.equal(answer('Можно на велосипеде в кремле?', nika).photoId, undefined);
  assert.equal(answer('Покажи фото кремля', boris).photoId, undefined);
  assert.equal(answer('Покажите фото неизвестного места', gorky).matched, false);
});

test('Reply Markdown formats text and photos while keeping voice transcripts readable', () => {
  const reply = '## Кремль\n\n- **Башни**\n- *Стены*\n\n![Фото](./assets/city.jpg)\n\n[Музей](https://example.org/)';
  const html = renderReplyMarkdown(reply);
  assert.match(html, /<h2>Кремль<\/h2>/);
  assert.match(html, /<li><strong>Башни<\/strong><\/li>/);
  assert.match(html, /<li><em>Стены<\/em><\/li>/);
  assert.match(html, /<img src="\.\/assets\/city\.jpg" alt="Фото"/);
  assert.match(html, /href="https:\/\/example\.org\/" target="_blank" rel="noopener noreferrer"/);
  assert.equal(plainReply(reply), 'Кремль\nБашни\nСтены\nФото\nМузей');
});

test('Reply Markdown escapes raw HTML and excludes unsafe URLs', () => {
  const reply = '<img src=x onerror="bad()">\n\n[Ссылка](javascript:bad())\n\n![X](data:image/png;base64,AAAA)\n\n![X](//example.org/image.png)';
  const html = renderReplyMarkdown(reply);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<(?:a|img)\b/i);
});
