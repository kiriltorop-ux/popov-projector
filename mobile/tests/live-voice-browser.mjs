import {chromium} from 'playwright';import assert from 'node:assert/strict';import path from 'node:path';
const b=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+path.resolve('../work/asr-question.wav')]});
try{
 const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['microphone']});
 await c.addInitScript(()=>{localStorage.setItem('gorod-govorit-language','en');window.testStreams=[];const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await acquire(...args);window.testStreams.push(stream);return stream;};window.testAcquire=navigator.mediaDevices.getUserMedia;});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));let uploads=0,mode='ok',expired=false;
 const snapshot=()=>({online:true,server_time:Date.now()/1000,expires_at:null,remaining:3,turns:[],token:'voice-test-token'});
 await p.route('**/api/**',async r=>{
  const route=new URL(r.request().url()).pathname; if(route==='/api/session'&&expired){await r.fulfill({status:401,json:{error:'Session expired for regression test'}});return;}
  if(route==='/api/transcribe'){
   uploads++;assert.equal(r.request().headers().authorization,'Bearer voice-test-token');
   const body=r.request().postDataBuffer();assert.ok(body.length>3000);assert.match(body.toString('latin1'),/name="recording"; filename="question.webm"/);assert.match(body.toString('latin1'),/name="language"\r\n\r\nen/);
   await r.fulfill({status:mode==='fail'?502:200,json:mode==='fail'?{error:'Test ASR unavailable'}:{text:mode==='empty'?'':'How does your radio receiver work?'}});return;
  }
  await r.fulfill({json:route==='/api/site'?{online:true,server_time:Date.now()/1000}:snapshot()});
 });
 const epoch=Math.floor(Date.now()/120000);await p.goto('http://localhost:18776/popov.html#join='+epoch+'.'+'a'.repeat(64));await p.locator('#question').waitFor();
 const mic=p.locator('.conversation-dictate');
 await p.locator('#question').fill('Edited:');await mic.click();await p.waitForFunction(()=>!document.querySelector('.dictation-confirm').disabled);await p.locator('.dictation-pause').click();
 await p.waitForFunction(()=>document.querySelector('#question').value.includes('receiver'));assert.equal(await p.locator('#question').inputValue(),'Edited: How does your radio receiver work?');assert.equal(uploads,1);
 assert.ok(await p.evaluate(()=>testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await p.screenshot({path:'../../../outputs/popov-live-dictation-reviewed.jpg'});
 await p.locator('#question').fill('Keep my draft');await mic.click();await p.locator('.dictation-cancel').click();assert.equal(await p.locator('#question').inputValue(),'Keep my draft');assert.equal(uploads,1);assert.ok(await p.evaluate(()=>testStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 mode='empty';await mic.click();await p.waitForFunction(()=>!document.querySelector('.dictation-confirm').disabled);await p.locator('.dictation-pause').click();await p.waitForFunction(()=>!document.querySelector('.conversation-dictate').disabled);assert.equal(await p.locator('#question').inputValue(),'Keep my draft');
 mode='fail';await mic.click();await p.waitForFunction(()=>!document.querySelector('.dictation-confirm').disabled);await p.locator('.dictation-pause').click();await p.getByText('Test ASR unavailable',{exact:true}).waitFor();assert.equal(await p.locator('#question').inputValue(),'Keep my draft');
 await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}});await mic.click();await p.locator('.conversation-error:visible').waitFor();assert.equal(await p.locator('#askForm').evaluate(e=>e.classList.contains('dictating')),false);
 expired=true;await p.locator('.station-join').waitFor();expired=false;await p.locator('.station-join').click();await p.locator('#question').waitFor();await p.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.testAcquire});await p.locator('.conversation-dictate').click();await p.waitForFunction(()=>document.querySelector('#askForm').classList.contains('dictating'));await p.locator('.dictation-cancel').click();assert.deepEqual(errors,[]);console.log('PASS actual MediaRecorder with simulated microphone: multipart, language, editable result, cancel releases mic, empty ASR, provider failure and permission denial preserve drafts.');
}finally{await b.close()}
