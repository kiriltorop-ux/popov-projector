import{chromium}from'playwright';import assert from'node:assert/strict';import path from'node:path';
const b=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+path.resolve('../work/qr-camera.y4m')]});
try{
 const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera']});
 await c.addInitScript(()=>{
  sessionStorage.setItem('gorod-station-token','existing-test-session');sessionStorage.setItem('gorod-station-admission',Math.floor(Date.now()/120000)+'.'+'a'.repeat(64));
  window.cameraStreams=[];const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const s=await native(...args);cameraStreams.push(s);return s;};
 });
 const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/site')?{online:true,server_time:Date.now()/1000}:{online:true,server_time:Date.now()/1000,remaining:3,turns:[],expires_at:null,token:"camera-test-session"}}));
 await p.goto('http://localhost:18776/#home');await p.locator('.nav-scan').click();
 await p.waitForFunction(()=>document.querySelector('#qr-scanner video').readyState>=2);
 assert.equal(new URL(p.url()).hash,'#home','Existing session must not bypass scanner');
 assert.equal(await p.locator('#qr-scanner .qr-open').isVisible(),false);
 await p.waitForURL('**/#popov',{timeout:15000});await p.locator('#question').waitFor();await p.locator('.station-conversation').waitFor();
 assert.equal(await p.locator('#qr-scanner').isVisible(),false);
 assert.ok(await p.evaluate(()=>cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await p.goto('http://localhost:18776/#home');await p.locator('.nav-scan').click();await p.locator('#qr-scanner .qr-close').click();
 await p.waitForFunction(()=>cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
 assert.equal(new URL(p.url()).hash,'#home');await p.goto('http://localhost:18776/#guide/popov');
 await p.locator('.guide-detail-action button').click();
 await p.locator('#qr-scanner:modal').waitFor();
 assert.equal(new URL(p.url()).hash,'#guide/popov');
 assert.equal(await p.locator('.conversation').count(),0);
 await p.waitForURL('**/#popov',{timeout:15000});
 await p.locator('.station-conversation #question').waitFor();
 assert.ok(await p.evaluate(()=>cameraStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 assert.deepEqual(errors,[]);
 console.log('PASS QR buttons in navigation and on guide profile open the scanner; accepted QR opens station chat and closing releases the camera.');
}finally{await b.close()}
