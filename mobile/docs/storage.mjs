import {initialState,routes} from './data.mjs?v=river-design';
import {answer,validateState} from './engine.mjs?v=source-style';

// IndexedDB serializes read/write transactions across tabs. The revision check
// and write share one transaction, so two editors cannot overwrite each other.
const scope=new URL('.',import.meta.url).pathname;
let connection;
function database(){
 if(!connection)connection=new Promise((resolve,reject)=>{
  const request=indexedDB.open('gorod-govorit:'+scope,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};
  request.onerror=()=>{connection=null;reject(Error('Хранилище браузера недоступно. Разрешите сохранение данных для этого сайта.'));};
 });
 return connection;
}
async function workspace(update){
 const db=await database();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');let result,error;
  const request=store.get('current');
  request.onsuccess=()=>{
   try{
    const current=request.result||{state:initialState(),revision:0};
    if(update){
     if(update.revision!==current.revision)throw Object.assign(Error('В другом окне сохранена новая версия.'),{status:409});
     validateState(update.state);result={state:structuredClone(update.state),revision:current.revision+1};
     store.put(result,'current');
    }else{result=current;if(!request.result)store.put(current,'current');}
   }catch(e){error=e;tx.abort();}
  };
  tx.oncomplete=()=>resolve(result);
  tx.onabort=tx.onerror=()=>reject(error||Error('Не удалось сохранить данные в браузере. Скачайте резервную копию проекта.'));
 });
}
export async function request(path,{method='GET',body,signal}={}){
 signal?.throwIfAborted();
 if(path==='/api/state')return workspace(method==='PUT'?body:undefined);
 if(path.startsWith('/api/routes')){const minutes=Number(new URL(path,'https://local.invalid').searchParams.get('minutes')||180);return {routes:routes.filter(r=>r.minutes<=minutes)};}
 if(path==='/api/ask'){
  const {state}=await workspace();signal?.throwIfAborted();
  const guide=state.guides.find(g=>g.id===body.guideId);
  if(!guide)throw Error('Персонаж удалён. Выберите другого гида.');
  if(typeof body.question!=='string'||!body.question.trim()||body.question.length>500)throw Error('Введите вопрос до 500 символов.');
  return answer(body.question,guide);
 }
 throw Error('Неизвестное действие.');
}
