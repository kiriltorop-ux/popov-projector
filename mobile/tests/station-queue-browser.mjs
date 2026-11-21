import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser = await chromium.launch({headless: true, channel: 'chrome'});
const base = process.env.GG_TEST_URL || 'http://10.50.187.3:18776/';
const pages = [], errors = [];
const turns = [0, 1, 2].map(i => ({key: `question-${i}`, question: `Вопрос посетителя ${i + 1}`,
  state: i === 0 ? 'started' : 'generating', ahead: i,
  // Even an old server sending text early must not reveal it in the UI.
  answer: `Ответ посетителю ${i + 1}`, error: ''}));
try {
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({viewport: {width: 390, height: 844}});
    await context.addInitScript(() => sessionStorage.setItem('gorod-station-token', 'test-browser-token'));
    await context.route('**/api/**', route => route.fulfill({json: {
      online: true, turns: [turns[i]], remaining: turns[i].state === 'finished' ? 2 : 2,
      expires_at: null, can_send: true, server_time: Date.now() / 1000,
    }}));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '#popov');
    await page.locator('.station-conversation').waitFor();
    pages.push(page);
  }
  await pages[0].getByText('Сейчас Попов отвечает вам', {exact: true}).waitFor();
  await pages[1].getByText('Вы следующий в очереди', {exact: true}).waitFor();
  await pages[2].getByText('Ваш номер в очереди: 3', {exact: true}).waitFor();
  for (const page of pages) assert.equal(await page.locator('.station-reply').count(), 0);
  await pages[2].reload();
  await pages[2].getByText('Ваш номер в очереди: 3', {exact: true}).waitFor();
  assert.equal(await pages[2].locator('.station-reply').count(), 0);
  turns[0].state = 'finished';
  turns[1].state = 'started'; turns[1].ahead = 0;
  turns[2].ahead = 1;
  await pages[0].locator('.station-reply').getByText('Ответ посетителю 1', {exact: true}).waitFor();
  await pages[1].getByText('Сейчас Попов отвечает вам', {exact: true}).waitFor();
  await pages[2].getByText('Вы следующий в очереди', {exact: true}).waitFor();
  await pages[0].locator('#question').fill('Ещё один вопрос');
  assert.equal(await pages[0].locator('#sendQuestion').isEnabled(), true);
  assert.equal(await pages[1].locator('.station-reply').count(), 0);
  assert.equal(await pages[2].locator('.station-reply').count(), 0);
  turns[1].state = 'finished'; turns[2].state = 'started'; turns[2].ahead = 0;
  await pages[1].locator('.station-reply').getByText('Ответ посетителю 2', {exact: true}).waitFor();
  await pages[2].getByText('Сейчас Попов отвечает вам', {exact: true}).waitFor();
  assert.equal(await pages[2].locator('.station-reply').count(), 0);
  turns[2].state = 'finished';
  await pages[2].locator('.station-reply').getByText('Ответ посетителю 3', {exact: true}).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: three mobile visitors, live queue positions, reload, hidden answers, session continues');
} finally {
  await browser.close();
}
