import test from 'node:test';
import assert from 'node:assert/strict';
import {projectorQr} from '../docs/qr-scanner.mjs';
const code='12345.'+'a'.repeat(64);
test('QR scanner accepts actual station and story links',()=>{
 const chat=projectorQr('https://192.168.1.3:18777/popov.html#join='+code);
 assert.equal(chat?.hash,'#join='+code);
 assert.ok(projectorQr('https://station.example/listen.html#guide=popov&key='+'a'.repeat(32)));
});
test('QR scanner refuses executable, credentialed and malformed URLs',()=>{
 for(const text of ['javascript:alert(1)','not a URL','file:///tmp/photo',
  'https://user:password@station.example/popov.html#join='+code,
  'https://station.example/unrelated#join='+code,
  'https://station.example/popov.html#join=forged',
  'https://station.example/popov.html?redirect=evil#join='+code]) assert.equal(projectorQr(text),null);
});
