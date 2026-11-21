import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser = await chromium.launch({headless: true, ...(process.env.GG_BROWSER_EXECUTABLE ? {executablePath: process.env.GG_BROWSER_EXECUTABLE} : {channel: 'chrome'}), args: [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
]});
const context = await browser.newContext({ignoreHTTPSErrors: true, permissions: ['microphone'],
  viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
const base = process.env.GG_TEST_URL || 'https://10.50.187.3:18777/';
const errors = [], messages = [];
let recordings = 0, choosers = 0, asr = 'ok';
await context.addInitScript(() => sessionStorage.setItem('gorod-station-token', 'test-browser-token'));
await context.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/transcribe')) {
    recordings++;
    const body = route.request().postDataBuffer();
    assert.ok(body.length > 500, 'Actual recorded audio must be uploaded');
    assert.match(body.toString('latin1'), /name="recording"; filename="question.webm"/);
    assert.match(body.toString('latin1'), /name="language"\r\n\r\nru/);
    if (asr === 'failure') return route.fulfill({status: 502, json: {error: 'Test ASR unavailable'}});
    if (asr === 'empty') return route.fulfill({json: {text: ''}});
    return route.fulfill({json: {text: 'Как работает приёмник?'}});
  }
  if (path.endsWith('/question')) messages.push(route.request().postDataJSON().text);
  return route.fulfill({json: {online: true, remaining: 3, turns: [], can_send: true, expires_at: null,
    server_time: Date.now() / 1000}});
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('filechooser', () => choosers++);
const mic = page.locator('.station-conversation .conversation-dictate');
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for recording');
    await page.waitForTimeout(50);
  }
}
async function beginTouch() {
  const box = await mic.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [
    {x: box.x + box.width / 2, y: box.y + box.height / 2},
  ]});
}
async function endTouch() { await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); }
const cdp = await context.newCDPSession(page);
try {
  await page.goto(base + '#popov');
  await mic.waitFor();
  assert.equal(await page.evaluate(() => isSecureContext), true);
  await beginTouch();
  await page.locator('.holding-recording').waitFor();
  await page.waitForTimeout(850);
  assert.equal(messages.length, 0, 'Nothing is sent while held');
  await endTouch();
  await until(() => messages.length === 1);
  assert.equal(recordings, 1);
  assert.equal(messages[0], 'Как работает приёмник?');
  assert.equal(await page.locator('input[type=file]').count(), 0);
  assert.equal(choosers, 0);
  await mic.waitFor({state: 'visible'});
  await beginTouch();
  await page.waitForTimeout(70);
  await endTouch();
  await page.waitForTimeout(500);
  assert.equal(recordings, 1, 'Accidental tap must not upload audio');
  await beginTouch();
  await page.locator('.holding-recording').waitFor();
  await page.waitForTimeout(450);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
  await page.waitForTimeout(300);
  assert.equal(recordings, 1, 'Cancelled touch must not send');
  await mic.focus();
  await page.keyboard.down('Space');
  await page.locator('.holding-recording').waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.up('Space');
  await until(() => messages.length === 2);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return window.lateStream = await original(options);
    };
  });
  await beginTouch(); await page.waitForTimeout(80); await endTouch();
  await page.waitForFunction(() => window.lateStream?.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(recordings, 2, 'Late permission must not start recording after release');
  await page.locator('#question').fill('Сохранить мой черновик');
  for (const mode of ['empty', 'failure']) {
    asr = mode;
    await mic.focus();
    await page.keyboard.down('Space');
    await page.locator('.holding-recording').waitFor();
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    await page.locator('.conversation-error').waitFor();
    assert.equal(await page.locator('#question').inputValue(), 'Сохранить мой черновик');
  }
  assert.equal(messages.length, 2, 'Empty and failed recognition must not send questions');
  await page.evaluate(() => navigator.mediaDevices.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  });
  await beginTouch(); await page.waitForTimeout(100); await endTouch();
  await page.getByText('Доступ к микрофону закрыт. Разрешите его в браузере или введите вопрос.', {exact: true}).waitFor();
  assert.equal(await page.locator('.holding-recording').count(), 0);
  assert.equal(choosers, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real MediaRecorder with mobile touch hold/release, automatic send, no file picker, short tap, cancellation, keyboard, permission race and denial');
} finally { await browser.close(); }
