const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,...(process.env.GG_BROWSER_EXECUTABLE?{executablePath:process.env.GG_BROWSER_EXECUTABLE}:{})});
const base=process.env.GG_TEST_URL||'http://127.0.0.1:4176/gorod-govorit/';
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const p=await context.newPage(),errors=[],checks=[];
p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
fs.mkdirSync('qa/mobile',{recursive:true});
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await check('Small and tall phones: no overflow, readable input, reachable navigation',async()=>{
  for(const [width,height] of [[320,568],[360,740],[390,844],[430,932]]){
   await p.setViewportSize({width,height});
   for(const route of ['home','guide/popov','studio','chat','map','screen','about','analytics']){
    await p.goto(base+'#'+route);await p.locator(route==='map'?'.projection-map':'main h1:visible,main h2:visible').first().waitFor();
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${route}: overflow`);
    assert.ok(await p.locator('input:not([type=file]):not([type=checkbox]):not([type=color]),textarea,select').evaluateAll(es=>es.filter(e=>e.offsetWidth).every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)),`${route}: input font triggers iOS zoom`);
    if(route.startsWith('guide/')) assert.equal(await p.locator('#mobileNav').isVisible(),false);
    else if(!['screen','chat'].includes(route)){const r=await p.locator('#mobileNav').boundingBox();assert.ok(r.y+r.height<=height+1);}
    if(['home','chat','map','studio'].includes(route))await p.screenshot({path:`qa/mobile/${route}-${width}.png`,fullPage:false});
   }
  }
 });
 await check('Studio: draft survives all three tabs, advanced controls and guide switch',async()=>{
  await p.setViewportSize({width:390,height:844});await p.goto(base+'#studio');await p.locator('[name=name]').fill('Мобильный гид');await p.locator('#studio-knowledge').click();await p.locator('#addDoc').waitFor();await p.locator('#studio-preview').click();assert.match(await p.locator('.studio-preview h2').innerText(),/Мобильный гид/);await p.locator('#studio-profile').click();assert.equal(await p.locator('[name=name]').inputValue(),'Мобильный гид');await p.getByText('Голос и оформление',{exact:true}).click();await p.locator('[name=voice]').selectOption('friendly');await p.locator('#guidePicker').selectOption('nika');await p.waitForFunction(()=>document.querySelector('[name=name]').value==='Ника');await p.locator('#guidePicker').selectOption('gorky');await p.waitForFunction(()=>document.querySelector('[name=name]').value==='Мобильный гид');assert.equal(await p.locator('[name=name]').inputValue(),'Мобильный гид');await p.getByRole('button',{name:'Сохранить персонажа',exact:true}).click();await p.locator('#workspaceStatus').getByText('Все изменения сохранены').waitFor();await p.reload();await p.locator('[name=name]').waitFor();assert.equal(await p.locator('[name=name]').inputValue(),'Мобильный гид');
 });
 await check('Mobile material sheet: scroll lock, save reachable, source retained',async()=>{
  await p.locator('#studio-knowledge').click();await p.locator('#addDoc').click();assert.equal(await p.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');await p.locator('#docForm [name=title]').fill('Ночная прогулка');await p.locator('#docForm [name=text]').fill('Ночная прогулка начинается в 21:00 у маяка.');await p.locator('#docForm [name=source]').fill('Учебное расписание');await p.locator('#docForm [name=tags]').fill('ночная прогулка маяк');await p.getByRole('button',{name:'Сохранить материал',exact:true}).click();await p.locator('#docForm').waitFor({state:'detached'});await p.locator('[data-doc]').filter({hasText:'Изменить'}).last().waitFor();assert.ok(!await p.locator('body').evaluate(e=>e.classList.contains('modal-open')));await p.screenshot({path:'qa/mobile/knowledge-390.png'});
 });
 await check('Chat: composer fits a short visual viewport and sends without scrolling page',async()=>{
  await p.locator('#previewChat').click();await p.setViewportSize({width:390,height:430});await p.locator('#question').fill('Ночная прогулка');const b=await p.locator('#question').boundingBox();assert.ok(b.y>=0&&b.y+b.height<=430);assert.equal(await p.locator('#mobileNav').isVisible(),false);await p.locator('#sendQuestion').click();await p.locator('#messages').getByText(/21:00/).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollTop),0);await p.screenshot({path:'qa/mobile/chat-short.png'});
 });
 await check('VisualViewport keyboard event hides navigation and keeps send control above keyboard',async()=>{
  await p.setViewportSize({width:390,height:844});await p.locator('#question').focus();
  await p.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>420});window.visualViewport.dispatchEvent(new Event('resize'));});
  assert.ok(await p.locator('body').evaluate(e=>e.classList.contains('keyboard-open')));assert.ok(!await p.locator('#mobileNav').isVisible());const b=await p.locator('#sendQuestion').boundingBox();assert.ok(b.y+b.height<=420);await p.screenshot({path:'qa/mobile/chat-keyboard-layout.png'});
  await p.evaluate(()=>{delete window.visualViewport.height;window.visualViewport.dispatchEvent(new Event('resize'));});
 });
 await check('Chat photos zoom and pan independently of the page',async()=>{
  await p.goto(base+'#chat/gorky');
  await p.getByRole('button',{name:'Покажите фото кремля',exact:true}).click();
  const thumbnail=p.locator('.reply-photo-open').first();
  await thumbnail.click();
  const viewer=p.getByRole('dialog',{name:'Просмотр фотографии'});
  const photo=viewer.locator('img');
  await photo.evaluate(img=>img.decode());
  const scale=()=>photo.evaluate(img=>new DOMMatrix(getComputedStyle(img).transform).a);
  const pageScale=await p.evaluate(()=>visualViewport.scale);
  const fit=await photo.boundingBox();
  assert.equal(await scale(),1);
  assert.ok(fit.width<=390 && fit.height<=844);

  const touch=await context.newCDPSession(p);
  const center={x:Math.round(fit.x+fit.width/2),y:Math.round(fit.y+fit.height/2)};
  const left={id:1,x:center.x-45,y:center.y};
  const right={id:2,x:center.x+45,y:center.y};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[left,right]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...left,x:left.x-60},{...right,x:right.x+60}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await scale()>2);
  const enlarged=await photo.boundingBox();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[center]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...center,x:center.x+60}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await photo.boundingBox()).x>enlarged.x);
  assert.equal(await p.evaluate(()=>visualViewport.scale),pageScale);
  await touch.detach();

  await p.touchscreen.tap(center.x,center.y);
  await p.touchscreen.tap(center.x,center.y);
  assert.equal(await scale(),1);
  await viewer.getByRole('button',{name:'Приблизить',exact:true}).tap();
  assert.equal(await scale(),1.5);
  await viewer.getByRole('button',{name:'Отдалить',exact:true}).tap();
  assert.equal(await scale(),1);
  await viewer.getByRole('button',{name:'Закрыть фото',exact:true}).tap();
  await thumbnail.click();
  assert.equal(await scale(),1);
  await p.keyboard.press('Escape');
  await viewer.waitFor({state:'hidden'});
 });
 await check('The map shows the five projectors and old route links open it',async()=>{
  await p.goto(base+'#routes');
  await p.locator('.projection-map').waitFor();
  assert.equal(new URL(p.url()).hash,'#map');
  assert.equal(await p.locator('.projection-sites button').count(),5);
  const pins = p.locator('.projection-pin');
  await pins.last().waitFor();
  assert.equal(await pins.count(),5);
  await p.getByRole('button',{name:'Спутник',exact:true}).click();
  assert.equal(await p.getByRole('button',{name:'Спутник',exact:true}).getAttribute('aria-pressed'),'true');
  await p.locator('.projection-map img[src*="/World_Imagery/"]').first().waitFor({state:'attached'});
  await p.getByRole('button',{name:'Схема',exact:true}).click();
  await p.locator('.projection-map img[src*="tile.openstreetmap.org"]').first().waitFor({state:'attached'});
  const handle = p.getByRole('button',{name:'Точки на карте'});
  const visibleSites = p.locator('.projection-sites').getByRole('button');
  assert.equal(await visibleSites.count(),1);
  const firstSite = await visibleSites.first().boundingBox();
  const scanButton = await p.locator('.nav-scan').boundingBox();
  assert.ok(firstSite.y + firstSite.height <= scanButton.y);
  const touch = await context.newCDPSession(p);
  const bounds = await handle.boundingBox();
  const start = {x:bounds.x + bounds.width / 2, y:bounds.y + bounds.height / 2};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y - 80}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.detach();
  assert.equal(await handle.getAttribute('aria-expanded'),'true');
  assert.equal(await visibleSites.count(),5);
  await handle.press('Escape');
  assert.equal(await handle.getAttribute('aria-expanded'),'false');
  await handle.tap();
  assert.equal(await handle.getAttribute('aria-expanded'),'true');
  const details = p.locator('.guide-detail');
  const points = ['44.006961,56.326997','44.008924,56.330091','43.995413,56.317288','44.013937,56.329342','44.01851,56.3228'];
  for (const [index, coords] of points.entries()) {
   await p.locator('.projection-sites button').nth(index).click();
   const link = details.getByRole('link', {name:'Открыть в Яндекс Картах'});
   const destination = new URL(await link.getAttribute('href'));
   assert.equal(destination.origin + destination.pathname,'https://yandex.ru/maps/');
   assert.equal(destination.searchParams.get('ll'),coords);
   assert.equal(destination.searchParams.get('pt'),coords);
   await details.locator('.guide-detail-map .projection-pin').waitFor();
   assert.equal(await p.locator('#mobileNav').isVisible(),false);
   if (index === 4) await details.getByText('Улица Семашко, 19').waitFor();
   await details.getByRole('link',{name:'Назад',exact:true}).click();
   await p.locator('.projection-map').waitFor();
  }
  await p.locator('.projection-pin').first().waitFor();
  assert.equal(await p.getByRole('button',{name:'Все точки',exact:true}).count(),0);
  assert.deepEqual(await p.locator('#mobileNav a, #mobileNav button').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label') || item.textContent)),['Главная','Сканировать QR-код','Карта']);
  const nav = await p.locator('#mobileNav').boundingBox();
  const scan = await p.getByRole('button',{name:'Сканировать QR-код'}).boundingBox();
  assert.ok(scan.y < nav.y && Math.abs(scan.x + scan.width / 2 - (nav.x + nav.width / 2)) < 1);
  assert.equal(await p.locator('#mobileNav a.active').innerText(),'Карта');
  assert.equal(await p.locator('.topbar').isVisible(),false);
  await p.locator('#mobileNav [href="#home"]').click();
  await p.locator('.guide-library').waitFor();
  await p.locator('.guide-archive-portrait').evaluateAll(photos=>Promise.all(photos.map(photo=>photo.decode())));
  assert.deepEqual(await p.locator('.guide-library h2').allTextContents(),['Мобильный гид','Александр Попов','Кузьма Минин','Валерий Чкалов','Городовой']);
  assert.equal(await p.locator('#newGuide,.studio-invite').count(),0);
  assert.equal(await p.locator('main > *').count(),1);
  await p.goto(base+'#guides');
  await p.waitForURL(base+'#home');
  assert.equal(await p.locator('a[href="#routes"]').count(),0);
 });
 await check('Touch targets and reduced motion',async()=>{await p.goto(base+'#home');const small=await p.locator('button:visible,#mobileNav a').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height<44).map(e=>e.textContent));assert.deepEqual(small,[]);await p.emulateMedia({reducedMotion:'reduce'});await p.goto(base+'#screen');assert.equal(await p.locator('.bars i').first().evaluate(e=>getComputedStyle(e).animationName),'none');});
 assert.deepEqual(errors,[]);
}finally{fs.writeFileSync('qa/mobile/results.json',JSON.stringify({checks,errors},null,2));await browser.close();}
