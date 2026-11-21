const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,...(process.env.GG_BROWSER_EXECUTABLE?{executablePath:process.env.GG_BROWSER_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
const base=process.env.GG_TEST_URL||'http://127.0.0.1:4176/gorod-govorit/';
fs.mkdirSync('qa',{recursive:true});
const errors=[],requests=[],checks=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
context.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
page.on('dialog',d=>d.accept());
const saved=()=>page.locator('#workspaceStatus [role=status]').filter({hasText:'Все изменения сохранены'}).waitFor({state:'attached'});
async function openGuideChat(tab, id) {
  await tab.locator(`a[href="#guide/${id}"]`).click();
  // Exercise the local chat independently of station admission.
  await tab.evaluate(id=>{
    history.pushState({flowBack:'#guide/'+id},'', '#chat/'+id);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  },id);
  const chat = tab.locator(`.conversation[data-guide="${id}"]`);
  await chat.waitFor();
  return chat;
}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
try{
 await check('The home page loads just the five guides, their archive photos and fonts',async()=>{
  await page.goto(base);
  const catalogue=page.locator('main .guide-library');
  await catalogue.waitFor();
  assert.equal(await page.locator('main > *').count(),1);
  assert.deepEqual(await catalogue.locator('h2').allTextContents(),[
   'Максим Горький','Александр Попов','Кузьма Минин','Валерий Чкалов','Городовой',
  ]);
  assert.equal(await catalogue.locator('.guide-card-open > .guide-open-icon').count(),5);
  assert.equal(await catalogue.locator('.guide-edit').count(),0);
  await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('LbchRoboto') && [...document.fonts].some(f=>f.family==='LbchRoboto' && f.status==='loaded')));
  await catalogue.locator('img').evaluateAll(images=>Promise.all(images.map(photo=>photo.decode())));
  await page.screenshot({path:'qa/home-desktop.png',fullPage:true});
 });
 await check('Source answer and refusal',async()=>{await page.goto(base+'#guides');await openGuideChat(page, 'gorky');await page.locator('#question').fill('Какое ваше настоящее имя?');await page.locator('#askForm').press('Enter');await page.locator('#messages').getByText(/Пешкова/).waitFor();await page.getByRole('button',{name:'Источники',exact:true}).click();const sources=page.getByRole('dialog',{name:'Источники',exact:true});assert.match(await sources.getByRole('link',{name:/Музей Горького и Шаляпина/}).getAttribute('href'),/^https:/);await page.keyboard.press('Escape');await sources.waitFor({state:'hidden'});await saved();await page.locator('#question').fill('Какая температура на Венере?');await page.locator('#askForm').press('Enter');await page.locator('#messages').getByText(/нет достаточно/).waitFor();await saved();await page.screenshot({path:'qa/chat-desktop.png',fullPage:true});});
 await check('Compact guides align and the chat fits at each viewport',async()=>{
  const preview=await browser.newPage();
  try {
   for(const width of [320,360,390,430,1280]){
    await preview.setViewportSize({width,height:844});
    await preview.goto(base+'#guides');
    const cards=preview.locator('.guide-compact');
    await cards.first().waitFor();
    await preview.evaluate(()=>document.fonts.ready);
    const heights=await cards.evaluateAll(rows=>rows.map(row=>row.offsetHeight));
    assert.equal(heights.length,4);
    assert.equal(new Set(heights).size,1);
    const frame=await openGuideChat(preview, 'chkalov');
    const chat=await frame.boundingBox();
    assert.ok(chat.width<=width);
    assert.equal(chat.x, (width-chat.width)/2);
    assert.equal(await frame.locator('.conversation-modes,.conversation-voice,#voiceToggle').count(),0);
    await frame.locator('.conversation-back').click();
    await preview.locator('.guide-detail .conversation-back').click();
    await cards.first().waitFor();
    await preview.locator('.moving-portrait,.portrait-in-motion').first().waitFor({state:'detached'});
   }
  } finally {await preview.close();}
 });
 await check('Popov uses the shared text chat and keeps reply sources',async()=>{
  const tab=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  try {
   await tab.goto(base+'#guides');
   const frame=await openGuideChat(tab, 'popov');
   await frame.getByRole('heading',{name:'Александр Попов'}).waitFor();
   await frame.getByRole('button',{name:'Как работает приёмник?'}).click();
   const reply=frame.locator('.message .reply-markdown').filter({hasText:'срабатывает реле'});
   await reply.waitFor();
   await frame.getByRole('button',{name:'Источники',exact:true}).click();
   const sources=tab.getByRole('dialog',{name:'Источники'});
   assert.match(await sources.getByRole('link').getAttribute('href'),/polymus/);
   await tab.keyboard.press('Escape');
   for(const width of [320,390,430,1280]){
    await tab.setViewportSize({width,height:width===320 ? 568 : 844});
    assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth),width);
    assert.ok(await frame.locator('#question').isVisible());
    assert.equal(await reply.count(),1);
   }
   await frame.locator('.conversation-back').click();
   await tab.locator('.guide-detail .conversation-back').click();
   await openGuideChat(tab, 'chkalov');
   await tab.getByRole('button',{name:'Как прошёл перелёт через Северный полюс?'}).click();
   await tab.locator('#messages').getByText(/63 часа 16 минут/).waitFor();
   await tab.getByRole('button',{name:'Источники',exact:true}).click();
   assert.match(await tab.getByRole('dialog',{name:'Источники'}).getByRole('link').getAttribute('href'),/^https:\/\/www\.prlib\.ru/);
   assert.equal(await tab.locator('#messages').getByText(/срабатывает реле/).count(),0);
   await tab.keyboard.press('Escape');
   await tab.locator('.conversation-back').click();
   await tab.locator('.guide-detail .conversation-back').click();
   await openGuideChat(tab, 'gorodovoy');
   await tab.getByText(/собирательный образ полицейского/).waitFor();
   await tab.getByRole('button',{name:'Кто такой городовой?'}).click();
   await tab.locator('#messages').getByText(/дежурили на постах/).waitFor();
   await tab.getByRole('button',{name:'Источники',exact:true}).click();
   assert.match(await tab.getByRole('dialog',{name:'Источники'}).getByRole('link').getAttribute('href'),/^https:\/\/journals\.rcsi\.science/);
   await tab.goto(base+'#dobrolyubov');
   await tab.getByRole('link',{name:'О персонаже: Городовой'}).waitFor();
   assert.equal(new URL(tab.url()).hash,'#home');
   await tab.goto(base+'popov.html');
   await frame.waitFor();
   await tab.goto(base+'popov.html?settings');
   await tab.getByLabel('Адрес площадки').waitFor();
  } finally {await tab.close();}
 });
 await check('Fast local answers show preparation, then words, then actions',async()=>{
  const tab=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference'});
  try {
   await tab.goto(base+'#popov');
   await tab.getByRole('button',{name:'Как работает приёмник?'}).click();
   await tab.locator('.conversation-waiting').getByText('Готовлю ответ…').waitFor();
   const preview=tab.locator('#messages .message[inert]');
   await preview.waitFor();
   const partial=await preview.innerText();
   await tab.getByRole('button',{name:'Скопировать ответ'}).waitFor();
   const full=await tab.locator('#messages .message').last().locator('.reply-markdown').innerText();
   assert.ok(partial.trim().length>0 && partial.trim().length<full.length);
   assert.equal(await preview.count(),0);
   await tab.getByRole('button',{name:'Кто вы?'}).click();
   await preview.waitFor();
   await tab.locator('.conversation-back').click();
   await openGuideChat(tab, 'popov');
   await tab.getByText('Меня зовут Александр Степанович Попов. Я занимался физикой и опытами с радиоволнами.').waitFor();
   assert.equal(await tab.locator('#messages [inert],.conversation-waiting').count(),0);
  } finally {await tab.close();}
 });
 await check('Dictation follows the microphone, preserves edits and sends only on confirmation', async () => {
  const tab = await browser.newPage({viewport:{width:320,height:650}, reducedMotion:'no-preference'});
  try {
   // Exercise the native engine even when the preview has an offline model installed.
   await tab.route(base, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body:(await response.text()).replace(/<meta name="dictation-endpoint"[^>]*>/, '')});
   });
   await tab.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value:async () => {
     const audio = new AudioContext();
     const output = audio.createMediaStreamDestination();
     const tone = audio.createOscillator();
     tone.connect(output);
     tone.start();
     await audio.resume();
     window.testTrack = output.stream.getAudioTracks()[0];
     return output.stream;
    }});
    window.SpeechRecognition = class extends EventTarget {
     start(track) {
      if (track !== window.testTrack) throw Error('Wrong microphone track');
      window.testRecognition = this;
      this.dispatchEvent(new Event('audiostart'));
     }
     phrase(text) {
      this.dispatchEvent(Object.assign(new Event('result'), {results:[[{transcript:text}]]}));
     }
     stop() {
      this.phrase('Ваше настоящее имя?');
      this.dispatchEvent(new Event('end'));
     }
     abort() {}
    };
   });
   await tab.goto(base + '#chat/gorky');
   const field = tab.getByRole('textbox', {name:'Ваш вопрос'});
   const mic = tab.getByRole('button', {name:'Диктовать вопрос'});
   const pause = tab.getByRole('button', {name:'Приостановить диктовку'});
   await field.fill('Подскажите,');
   await mic.click();
   await tab.getByText('Слушаю…', {exact:true}).waitFor();
   assert.equal(await field.isVisible(), false);
   await tab.waitForFunction(() => {
    const pixels = document.querySelector('.dictation-panel canvas').getContext('2d').getImageData(0, 0, 240, 4).data;
    return pixels.some((value, i) => i % 4 === 3 && value > 0);
   });
   const cancel = tab.getByRole('button', {name:'Отменить запись'});
   const send = tab.getByRole('button', {name:'Отправить вопрос'});
   const [left, wave, right, arrow] = await Promise.all([cancel,tab.locator('.dictation-panel'),pause,send].map(el => el.boundingBox()));
   assert.ok(left.x + left.width <= wave.x && wave.x + wave.width <= right.x && right.x + right.width <= arrow.x);
   await tab.evaluate(() => testRecognition.phrase('ошибочный вопрос'));
   await cancel.click();
   assert.equal(await field.inputValue(), 'Подскажите,');
   assert.equal(await tab.evaluate(() => testTrack.readyState), 'ended');
   assert.equal(await tab.locator('.message.user').count(), 0);
   await mic.click();
   await tab.getByText('Слушаю…',{exact:true}).waitFor();
   await tab.evaluate(() => { testRecognition.phrase('как'); testRecognition.phrase('как вас зовут?'); });
   await pause.click();
   assert.equal(await field.inputValue(), 'Подскажите, как вас зовут?');
   assert.equal(await tab.evaluate(() => testTrack.readyState), 'ended');
   assert.equal(await tab.locator('.message.user').count(), 0);
   assert.equal(await field.evaluate(e => e === document.activeElement), true);
   await field.fill('Хочу узнать:');
   await tab.getByRole('button', {name:'Продолжить диктовку'}).click();
   await tab.getByText('Слушаю…', {exact:true}).waitFor();
   await tab.evaluate(() => testRecognition.phrase('Ваше имя'));
   await tab.getByRole('button', {name:'Отправить вопрос'}).click();
   await tab.getByText('Хочу узнать: Ваше настоящее имя?', {exact:true}).and(tab.locator('.message.user, .message.user *')).first().waitFor();
   assert.equal(await tab.locator('.message.user').count(), 1);
   assert.equal(await tab.evaluate(() => testTrack.readyState), 'ended');
   await tab.getByRole('button', {name:'Источники',exact:true}).waitFor();
   await mic.click();
   await tab.getByText('Слушаю…',{exact:true}).waitFor();
   await tab.evaluate(() => testRecognition.dispatchEvent(Object.assign(new Event('error'), {error:'no-speech'})));
   await tab.getByRole('status').filter({hasText:'Речь не слышна'}).waitFor();
   assert.equal(await tab.locator('#askError').isVisible(), false);
   await mic.click();
   await tab.getByText('Слушаю…',{exact:true}).waitFor();
   await tab.evaluate(() => testRecognition.dispatchEvent(Object.assign(new Event('error'), {error:'not-allowed'})));
   await tab.getByRole('alert').filter({hasText:'Доступ к микрофону закрыт'}).waitFor();
   assert.equal(await field.isVisible(), true);
   assert.equal(await tab.evaluate(() => testTrack.readyState), 'ended');
  } finally { await tab.close(); }
 });
 await check('The text chat retains manual playback for individual answers',async()=>{
  const tab=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  try {
   await tab.addInitScript(()=>{
    const played=[];
    window.testSpoken=played;
    Object.defineProperty(window,'speechSynthesis',{value:{
     getVoices:()=>[],
     cancel(){},
     speak(utterance){played.push(utterance.text);utterance.onstart();},
    }});
   });
   await tab.goto(base+'#gorky');
   await tab.getByRole('button',{name:'Ваше настоящее имя?',exact:true}).click();
   const read=tab.getByRole('button',{name:'Озвучить ответ',exact:true});
   await read.waitFor();
   assert.deepEqual(await tab.evaluate(()=>window.testSpoken),[]);
   await read.click();
   assert.match((await tab.evaluate(()=>window.testSpoken))[0],/Пешкова/);
   await tab.getByRole('button',{name:'Остановить озвучку',exact:true}).click();
   assert.ok(await read.isVisible());
  } finally {await tab.close();}
 });
 await check('Create avatar, upload, draft and knowledge persist',async()=>{await page.goto(base+'#studio');await page.locator('#newGuide').click();await page.locator('#guidePicker option:checked').filter({hasText:'Новый гид'}).waitFor({state:'attached'});await page.locator('[name=name]').fill('Смотритель маяка');await page.locator('[name=role]').fill('Гид по учебной выставке');await page.locator('#avatarUpload').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN5sAAAAASUVORK5CYII=','base64')});await page.getByText('Картинка добавлена в черновик.',{exact:false}).waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Смотритель маяка');await page.locator('#studio-knowledge').click();await page.locator('#addDoc').click();await page.locator('#docForm [name=title]').fill('Экскурсия на маяк');await page.locator('#docForm [name=text]').fill('Учебная экскурсия на маяк начинается в 16:30 у северного входа.');await page.locator('#docForm [name=source]').fill('Программа выставки');await page.getByRole('button',{name:'Сохранить материал',exact:true}).click();await page.locator('#docForm').waitFor({state:'detached'});await saved();await page.reload();await page.locator('[name=name]').waitFor();assert.equal(await page.locator('[name=name]').inputValue(),'Смотритель маяка');await page.locator('#previewChat').click();await page.locator('#question').fill('Экскурсия на маяк');await page.locator('#askForm').press('Enter');await page.locator('#messages').getByText(/16:30/).waitFor();await saved();});
 await check('Offline answers and saving without API',async()=>{await page.goto(base+'#studio');await page.locator('#guidePicker').selectOption('hotel');await context.setOffline(true);await page.locator('#studio-knowledge').click();await page.locator('[data-doc=h-breakfast]').click();await page.locator('#docForm [name=text]').fill('В учебной гостинице завтрак с 08:30 до 11:00.');await page.getByRole('button',{name:'Сохранить материал',exact:true}).click();await page.locator('#docForm').waitFor({state:'detached'});await page.locator('#previewChat').click();await page.locator('#question').fill('Во сколько завтрак?');await page.locator('#askForm').press('Enter');await page.locator('#messages').getByText(/08:30/).waitFor();await saved();await context.setOffline(false);assert.deepEqual(requests,[]);});
 await check('Two tabs keep conflicting drafts',async()=>{await page.goto(base+'#studio');const q=await context.newPage();q.on('dialog',d=>d.accept());await q.goto(base+'#studio');await q.locator('[name=name]').fill('Черновик второй вкладки');await page.locator('[name=name]').fill('Версия первой вкладки');await page.getByRole('button',{name:'Сохранить персонажа',exact:true}).click();await saved();await q.getByRole('button',{name:'Сохранить персонажа',exact:true}).click();await q.locator('#workspaceStatus').getByText(/В другом окне/).waitFor();assert.equal(await q.locator('[name=name]').inputValue(),'Черновик второй вкладки');await q.locator('#loadRemote').click();await q.locator('#workspaceStatus').getByText('Все изменения сохранены').waitFor();assert.equal(await q.locator('[name=name]').inputValue(),'Версия первой вкладки');await q.close();});
 await check('Export, import and validation',async()=>{const d=page.waitForEvent('download');await page.locator('#backupProject').click();await(await d).saveAs('qa/test-export.json');const fresh=await browser.newContext(),q=await fresh.newPage();q.on('dialog',d=>d.accept());await q.goto(base+'#studio');await q.locator('#importProject').setInputFiles('qa/test-export.json');await q.getByText('Проект восстановлен',{exact:true}).waitFor();await q.goto(base+'#studio');await q.locator('#guidePicker').waitFor();assert.equal(await q.locator('#guidePicker option').count(),4);await q.goto(base+'#studio');await q.locator('#importProject').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"guides":[null]}')});await q.locator('#toast').getByText(/Импорт:/).waitFor();await fresh.close();});
 await check('Visitor screen follows selected guide',async()=>{const q=await context.newPage();await q.goto(base+'#screen');await q.locator('#screenAnswer').waitFor();await page.goto(base+'#studio');await page.locator('#guidePicker').selectOption('gorky');await q.getByRole('heading',{name:'Максим Горький',exact:true}).waitFor();await q.locator('#screenFormat').click();assert.equal(await q.locator('.round-format').count(),1);await q.close();});
 await check('Keyboard dialog focus and return',async()=>{await page.locator('#studio-knowledge').click();await page.locator('#addDoc').click();await page.locator('#closeModal').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Сохранить материал');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'addDoc');});
 const clean=await browser.newContext(),m=await clean.newPage();
 await check('Keyboard skips to the current content and reaches a projector link',async()=>{
  const tab=await clean.newPage();
  try {
   await tab.goto(base+'#map',{waitUntil:'domcontentloaded'});
   await tab.locator('.projection-pin').first().waitFor();
   await tab.keyboard.press('Tab');
   assert.equal(await tab.evaluate(()=>document.activeElement.className),'skip');
   await tab.keyboard.press('Enter');
   assert.equal(new URL(tab.url()).hash,'#map');
   assert.equal(await tab.evaluate(()=>document.activeElement.id),'main');
   const pin=tab.locator('.projection-pin').first();
   await pin.focus();
   await tab.keyboard.press('Space');
   const profile = tab.locator('.guide-detail[data-guide="minin"]');
   await profile.locator('h1:focus').waitFor();
   await profile.getByRole('link', {name:'Открыть в Яндекс Картах'}).waitFor();
   const scan = profile.getByRole('button', {name:'Сканировать QR-код'});
   await scan.press('Enter');
   const scanner = tab.locator('#qr-scanner:modal');
   await scanner.waitFor();
   assert.equal(new URL(tab.url()).hash,'#guide/minin');
   assert.equal(await tab.locator('.conversation').count(),0);
   assert.equal(await tab.locator('#mobileNav').isVisible(), false);
   await tab.keyboard.press('Escape');
   await scanner.waitFor({state:'hidden'});
   await scan.and(tab.locator(':focus')).waitFor();
   await profile.getByRole('link', {name:'Назад'}).click();
   await pin.and(tab.locator(':focus')).waitFor();
  } finally {await tab.close();}
 });
 await check('320 and 390px: all screens fit',async()=>{for(const width of [320,390]){await m.setViewportSize({width,height:844});for(const route of ['home','guide/popov','studio','chat','map','screen','about','analytics']){await m.goto(base+'#'+route);await m.locator('main').waitFor();if(route==='map')await m.locator('.projection-map').waitFor();else await m.locator('main h1:visible, main h2:visible').first().waitFor();await m.evaluate(()=>document.fonts.ready);assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' overflow '+width);if(['home','chat','map','studio'].includes(route))await m.screenshot({path:`qa/${route}-${width}.png`,fullPage:true});}}});
 await check('Mobile bottom navigation and guide access',async()=>{
  await m.addInitScript(()=>{
   Object.defineProperty(navigator,'mediaDevices',{value:{
    getUserMedia:async options=>{
     window.qrCameraRequest=options;
     window.qrCameraCount=(window.qrCameraCount||0)+1;
     throw new DOMException('Permission denied','NotAllowedError');
    },
   }});
  });
  await m.goto(base);
  await m.reload();
  await m.locator('#mobileNav [href="#map"]').click();
  await m.locator('.projection-map').waitFor();
  const scan=m.getByRole('button',{name:'Сканировать QR-код'});
  await scan.click();
  const scanner=m.getByRole('dialog',{name:'Сканировать QR-код'});
  await scanner.getByRole('button',{name:'Включить камеру'}).waitFor();
  assert.equal(await scanner.locator('input[type="file"]').count(),0);
  assert.equal(await scanner.getByRole('button',{name:'Выбрать фото'}).count(),0);
  assert.equal(await m.evaluate(()=>window.qrCameraRequest.video.facingMode.ideal),'environment');
  assert.match(await scanner.getByRole('status').textContent(),/Проверьте доступ/);
  await m.keyboard.press('Escape');
  await scanner.waitFor({state:'hidden'});
  await m.goto(base+'#about');
  await m.getByRole('heading',{name:'О проекте'}).waitFor();
  assert.equal(await m.locator('main a[href="#studio"], main a[href="#analytics"], #importProject').count(),0);
  assert.equal(await m.locator('#workspaceStatus').isVisible(),false);
  await m.getByRole('link',{name:'Выбрать гида'}).click();
  await openGuideChat(m, 'gorky');
  await m.getByRole('heading',{name:'Максим Горький'}).waitFor();
  await scanner.waitFor({state:'hidden'});
  assert.equal(await m.evaluate(()=>window.qrCameraCount), 1);
 });
 await check('Tourist languages persist and translate the catalogue, map and guide answers',async()=>{
  const tab=await browser.newPage({viewport:{width:320,height:740},isMobile:true,reducedMotion:'reduce'});
  try {
   await tab.goto(base);
   const picker=tab.locator('.language-picker');
   assert.equal(await picker.innerText(),'Русский');
   await picker.focus();
   await tab.keyboard.press('ArrowDown');
   await tab.keyboard.press('ArrowDown');
   await tab.keyboard.press('Enter');
   await tab.getByRole('heading',{name:'Valery Chkalov',exact:true}).waitFor();
   await tab.reload();
   assert.equal(await picker.innerText(),'English');
   await tab.getByRole('link',{name:'Map',exact:true}).click();
   await tab.getByRole('button',{name:'Satellite',exact:true}).waitFor();
   await tab.getByRole('button',{name:'Map locations'}).click();
   await tab.locator('.projection-sites').getByRole('button',{name:/Maxim Gorky Museum Apartment/}).click();
   await tab.locator('.guide-detail').getByText('19 Semashko Street').waitFor();
   await tab.getByRole('link',{name:'Back',exact:true}).click();
   await tab.getByRole('link',{name:'Home',exact:true}).click();
   await picker.click();
   await tab.getByRole('button',{name:'简体中文',exact:true}).click();
   assert.equal(await tab.locator('html').getAttribute('lang'),'zh-Hans');
   await tab.getByRole('link',{name:/瓦列里·契卡洛夫/}).click();
   await tab.getByRole('button',{name:'扫描二维码'}).click();
   await tab.locator('#qr-scanner:modal').waitFor();
   await tab.keyboard.press('Escape');
   await tab.goto(base+'#chat/chkalov');
   await tab.getByRole('button',{name:'您出生在哪里？',exact:true}).click();
   await tab.locator('#messages').getByText(/我出生在下诺夫哥罗德省/).waitFor();
   await tab.getByRole('button',{name:'资料来源',exact:true}).click();
   await tab.getByRole('dialog',{name:'资料来源',exact:true}).waitFor();
  } finally {await tab.close();}
 });
 await clean.close();assert.deepEqual(errors,[]);checks.push('No JavaScript errors');
} catch(e){await page.screenshot({path:'qa/failure.png',fullPage:true});throw e;}finally{fs.writeFileSync('qa/results.json',JSON.stringify({date:new Date().toISOString(),base,checks,errors,apiRequests:requests},null,2));await browser.close();}
