import {locale} from './i18n.mjs';

export const stationAsr = Boolean(document.querySelector('meta[name="gorod-station"]'));
const prefix='gorod-station-';
const get=key=>{try{return sessionStorage.getItem(prefix+key)||'';}catch{return '';}};
const set=(key,value)=>{try{sessionStorage.setItem(prefix+key,value);}catch{}};

async function request(path, body, signal, token='') {
  const form=body instanceof FormData;
  const response=await fetch('./api/'+path,{method:'POST',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(55000)]),
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(!form?{'Content-Type':'application/json'}:{})},
    body:form?body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||'Не удалось распознать запись.'),{status:response.status});
  return data;
}

export async function transcribeOnStation(blob, fileName, signal) {
  if(!blob.size || blob.size>10*1024*1024)throw Error('Запись должна быть меньше 10 МБ.');
  const language=locale();
  async function transcribe(token){
    const form=new FormData();form.append('recording',blob,fileName);form.append('language',language);
    const data=await request('transcribe',form,signal,token);
    if(typeof data.text!=='string'||!data.text.trim())throw Error('Речь не слышна. Попробуйте ещё раз.');
    return data.text.trim();
  }
  const token=get('token');
  if(token){try{return await transcribe(token);}catch(error){if(error.status!==401)throw error;set('token','');}}
  const admission=get('admission');
  if(!admission)throw Error('Сначала отсканируйте QR-код проектора.');
  let client=get('client');
  if(!client){client=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('');set('client',client);}
  const session=await request('start',{admission,client_id:client,language},signal);
  set('token',session.token);
  return transcribe(session.token);
}
