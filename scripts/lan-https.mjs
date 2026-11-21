import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../work'),tlsDir=path.join(root,'lan-tls');
const settings=JSON.parse(fs.readFileSync(path.join(tlsDir,'settings.json'),'utf8'));
const address=`https://${settings.host}:${settings.port}`;
const certificate=fs.readFileSync(path.join(tlsDir,'popov-local-ca.crt'));
const proxy=https.createServer({key:fs.readFileSync(path.join(tlsDir,'server-key.pem')),cert:fs.readFileSync(path.join(tlsDir,'server.pem')),minVersion:'TLSv1.2'},(request,response)=>{
 const target=http.request({hostname:'127.0.0.1',port:18776,path:request.url,method:request.method,headers:request.headers},upstream=>{
  response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);
 });
 target.on('error',()=>{if(!response.headersSent)response.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});response.end('Сервер Попова ещё запускается. Обновите страницу через несколько секунд.');});
 request.on('aborted',()=>target.destroy());request.pipe(target);
});
proxy.listen(settings.port,settings.host,()=>console.log('Local HTTPS:',address));
const page=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключить телефон к Попову</title><style>body{margin:0;background:linear-gradient(130deg,#ecf5ff,#d1e8fc);font:17px/1.6 system-ui;color:#173958}main{max-width:520px;margin:24px auto;padding:24px}h1{font-size:29px;line-height:1.2}li{margin-bottom:16px}a.button{display:block;text-align:center;border:1px solid white;border-radius:15px;padding:14px;color:white;background:#1468b7;text-decoration:none;margin:14px 0}small{display:block;color:#476882}code{overflow-wrap:anywhere;font:15px system-ui}</style><main><h1>Подключить телефон к Попову</h1><p>Телефон и ноутбук должны быть в одной Wi-Fi сети. Публичной ссылки нет.</p><ol><li><a href="/popov-local-ca.crt">Скачайте сертификат Popov local Wi-Fi CA</a>.</li><li>В настройках Android найдите «Установить сертификат». Выберите «Сертификат ЦС / CA» и скачанный файл.<small>Это сертификат локального адреса ноутбука. Для него не нужен пароль. Не выбирайте сертификат Wi-Fi или VPN.</small></li><li>На iPhone: установите скачанный профиль в настройках, затем включите полное доверие Popov local Wi-Fi CA в настройках доверия сертификатам.</li><li>Вернитесь сюда и откройте приложение по защищённому адресу. После установки отсканируйте новый QR-код на экране Попова.</li></ol><a class="button" href="${address}/#home">Открыть приложение</a><p>Зажмите кнопку микрофона и говорите. Отпустите — голос распознается, вопрос отправится Попову. При первом запуске разрешите доступ к микрофону.</p><small>Адрес: <code>${address}</code>. Если появилось предупреждение сертификата, сначала завершите его установку в настройках.</small></main></html>`;
const setup=http.createServer((request,response)=>{
 if(request.url==='/popov-local-ca.crt'){
  response.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="popov-local-ca.crt"'});response.end(certificate);
 }else if(request.url==='/' || request.url==='/index.html'){
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end(page);
 }else{response.writeHead(404);response.end();}
});
setup.listen(settings.setupPort,settings.host,()=>console.log('Phone setup:',`http://${settings.host}:${settings.setupPort}`));
function close(){proxy.close();setup.close();}process.on('SIGINT',close);process.on('SIGTERM',close);
