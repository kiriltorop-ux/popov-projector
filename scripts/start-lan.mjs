import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const scripts=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(scripts),work=path.join(root,'work');
const settings=JSON.parse(fs.readFileSync(path.join(work,'lan-tls','settings.json'),'utf8'));
const addresses=Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item=>item.address);
if(!addresses.includes(settings.host))throw Error(`Адрес ${settings.host} больше не принадлежит ноутбуку. Обновите локальный HTTPS-сертификат для новой Wi-Fi сети.`);
function listening(host,port){return new Promise(resolve=>{const socket=net.connect({host,port});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));socket.setTimeout(700,()=>{socket.destroy();resolve(false)});});}
function start(command,args,name){
 const log=fs.openSync(path.join(work,name+'.log'),'a');
 const child=spawn(command,args,{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.unref();fs.closeSync(log);
}
async function ready(host,port){for(let attempt=0;attempt<30;attempt++){if(await listening(host,port))return;await new Promise(resolve=>setTimeout(resolve,500));}throw Error(`Сервер не запустился на порту ${port}. Подробности в work/*-launch.log.`);}
if(!await listening('127.0.0.1',18776))start(path.join(root,'.server-venv','Scripts','pythonw.exe'),['-m','server.windows'],'projector-launch');
await ready('127.0.0.1',18776);
if(!await listening(settings.host,settings.port))start(process.execPath,[path.join(scripts,'lan-https.mjs')],'https-launch');
await ready(settings.host,settings.port);
console.log(`Попов готов: https://${settings.host}:${settings.port}`);
