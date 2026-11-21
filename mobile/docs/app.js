import { applyPageLanguage, locale, localizedGuide, setLocale, speechLocale, t } from './i18n.mjs';
import { h, render as renderVue } from './vendor/vue.esm-browser.prod.mjs';
import { AboutPage, AppHeader, AppNavigation, GuideCatalogue, GuidePage, MapPage, StatisticsPage, VisitorScreen, highlightNavigation } from './views.mjs?v=guide-flow';
import {chkalovGuide, gorodovoyGuide, mininGuide} from './historical-guides.mjs';
import {projectorGuide, popovQuestions, answerPopov} from './popov-guide.mjs';
import { openQrScanner } from './qr-scanner.mjs?v=guide-flow';
import { enterStationRoute, saveStationAdmission, StationConversation } from './station.mjs?v=minin-story';
import { ConversationPage } from './conversation.mjs?v=guide-flow';
import { projectionSites } from './projection-map.mjs?v=guide-flow';
import {cityPhotos} from './city-photos.mjs';
import {plainReply,renderReplyMarkdown} from './reply-markdown.mjs';
import { mountPhotoViewer } from './photo-viewer.mjs';
import {movePortrait,rememberPortrait,reveal,stopPortraitMotion} from './motion.mjs?v=guide-motion';
import { MaterialEditor, StudioPage } from './studio.mjs?v=matching-gorky';
import {request as api} from './storage.mjs?v=source-style';
import {icon} from './icons.mjs?v=river-design';
import {defaultGuides,initialState,sources} from './data.mjs?v=river-design';
import {answer,validateState} from './engine.mjs?v=source-style';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stationId = document.querySelector('meta[name="gorod-station"]')?.content;
const stationMode = ['popov', 'minin'].includes(stationId);
if (stationMode) enterStationRoute(stationId);
let state=initialState(),revision=0,ready=false,busy=false,saveQueue=Promise.resolve();
const scope=new URL('.',import.meta.url).pathname;
const draftKey='gg-pages-drafts:'+scope;
const channel='BroadcastChannel'in window?new BroadcastChannel('gg-pages:'+scope):null;
const main=$('#main'),workspaceStatus=$('#workspaceStatus');
$('.skip').addEventListener('click', event => {
 event.preventDefault();
 main.focus();
});
let dirty=false,conflict=false,saveError='',pendingSaves=0,viewId=0,askController=null,remotePending=false,screenRound=false;
let studioTab='profile';
const conversations=new Map();
const feedbackEvents=new WeakMap();
let drafts={},modalReturn=null;
try{drafts=JSON.parse(sessionStorage.getItem(draftKey)||'{}');}catch{}
function keepDrafts(){try{sessionStorage.setItem(draftKey,JSON.stringify(drafts));}catch{toast('Черновик слишком велик для восстановления после закрытия. Скачайте копию.');}}
function editGuide(){return drafts[state.selected]||guide();}
function captureDraft(){const form=$('#guideForm');if(!form)return;const g=drafts[state.selected]||structuredClone(guide());for(const [k,v]of new FormData(form))if(typeof v==='string')g[k]=v;if(JSON.stringify(g)===JSON.stringify(guide()))delete drafts[g.id];else drafts[g.id]=g;keepDrafts();status();}
function commitDrafts(){for(const [id,g]of Object.entries(drafts)){const i=state.guides.findIndex(x=>x.id===id);if(i>=0)state.guides[i]=structuredClone(g);}drafts={};keepDrafts();}
function exportProject(){captureDraft();const copy=structuredClone(state);copy.guides=copy.guides.map(g=>structuredClone(drafts[g.id]||g));download('gorod-govorit-project.json',JSON.stringify({format:'gorod-govorit',version:1,state:copy},null,2));}
function status(){const box=$('#workspaceStatus');if(!box)return;const changed=dirty||Object.keys(drafts).length;box.hidden=location.hash==='#about'||!(changed||pendingSaves||saveError||conflict||remotePending||['studio','analytics'].includes(location.hash.slice(1)));
 box.innerHTML=`<span role="status">${esc(conflict?'В другом окне есть новая версия. Ваши изменения сохранены в черновике.':saveError|| (pendingSaves?t('Сохраняем…'):changed?t('Есть несохранённые изменения'):remotePending?'Доступно обновление из другого окна':t('Все изменения сохранены')))}</span>${changed||saveError?'<button id="retrySave" class="button small">Сохранить изменения</button>':''}${conflict||remotePending?'<button id="loadRemote" class="button secondary small">Загрузить сохранённую версию</button>':''}<button id="backupProject" class="text-link">${esc(t('Скачать проект'))}</button>`;
 $('#backupProject').onclick=exportProject;
 if(document.body.dataset.page==='chat')updateViewport();
 $('#retrySave')?.addEventListener('click',async()=>{captureDraft();commitDrafts();try{await save();render();}catch(e){toast(e.message);}});
 $('#loadRemote')?.addEventListener('click',async()=>{if((changed||conflict)&&!confirm('Текущий черновик будет заменён. Сначала скачайте проект, если хотите сохранить свои правки. Загрузить сохранённую версию?'))return;try{await saveQueue.catch(()=>{});await sync();drafts={};keepDrafts();dirty=false;conflict=false;saveError='';remotePending=false;render();status();}catch(e){toast(e.message);}});
}

function toast(text, feedback = false){
 const notice = $('#toast');
 notice.classList.toggle('chat-feedback-toast', feedback);
 if (feedback) notice.innerHTML = `<span class="toast-check" aria-hidden="true">${icon('check')}</span><span>${esc(text)}</span>`;
 else notice.textContent = text;
 notice.classList.add('show');
 clearTimeout(toast.timer);
 toast.timer = setTimeout(() => notice.classList.remove('show'), feedback ? 2500 : 4000);
}
async function sync(){const j=await api('/api/state');state=j.state;revision=j.revision;ready=true;}
function save({quiet=false}={}){
 const snapshot=structuredClone(state);dirty=true;pendingSaves++;
 if(!quiet)status();
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  if(conflict)throw Object.assign(Error('Сначала разрешите конфликт: скачайте черновик и загрузите сохранённую версию.'),{status:409});
  validateState(snapshot);
  const j=await api('/api/state',{method:'PUT',body:{state:snapshot,revision}});revision=j.revision;
  dirty=JSON.stringify(state)!==JSON.stringify(snapshot);saveError='';channel?.postMessage({type:'updated',revision});return j;
 }).catch(e=>{dirty=true;conflict ||= e.status===409;saveError=e.status===409?'Конфликт версий. Ваш черновик не потерян.':'Не удалось сохранить. Изменения остались здесь; повторите сохранение.';throw e;}).finally(()=>{pendingSaves--;if(!quiet||!pendingSaves||saveError)status();});return saveQueue;
}
function event(type,value='',guideId=state.selected){state.events.push({type,value:String(value).slice(0,100),guide:guideId,at:new Date().toISOString()});state.events=state.events.slice(-200);}
function guide(){return state.guides.find(g=>g.id===state.selected)||state.guides[0];}
const featuredGorky=defaultGuides.find(g=>g.id==='gorky');
const archiveGuides=[projectorGuide,mininGuide,chkalovGuide,gorodovoyGuide];
const fixedGuides=new Map([featuredGorky,...archiveGuides].map(g=>[g.id,g]));
function publicGuides(){
 return [state.guides.find(g=>g.id==='gorky')||featuredGorky,...archiveGuides];
}
function publicGuide(id){return publicGuides().find(g=>g.id===id);}
function chatGuide(){
 const route=location.hash.slice(1);
 return (route.startsWith('chat/') ? publicGuide(route.slice(5)) : fixedGuides.get(route)) || guide();
}
function usesFixedGuide(g){return fixedGuides.get(g.id)===g;}
function catalogueEntries() {
 return publicGuides().map(g => ({
  id: g.id,
  name: t(g.name),
  spotlight: g.id === 'gorky',
  category: t(g.id === 'gorky' || g.id === 'minin' ? 'Народное ополчение' : g.tag?.trim()),
 }));
}

function conversationHistory(id) {
 const key = locale() + ':' + id;
 if (!conversations.has(key)) conversations.set(key, []);
 return conversations.get(key);
}

function suggestions(g){return g.id==='gorky'?['Ваше настоящее имя?','Что вы написали?','Покажите фото кремля','Диалоги на Кожевенной']:g.id==='nika'?['Что посмотреть в кремле?','Покажи фото Чкаловской лестницы','Можно на велосипеде?','Сколько стоят билеты?']:g.id==='hotel'?['Во сколько завтрак?','Когда заселение?']:g.docs.slice(0,3).map(d=>d.title);}
function replyPhotoHtml(id) {
 const photo = cityPhotos.find(item => item.id === id);
 if (!photo) return '';
 const url = './assets/' + photo.file;
 return `<figure class="reply-photo">
   <button type="button" class="reply-photo-open" aria-label="${esc(t('Увеличить фото'))}: ${esc(t(photo.title))}"><img src="${esc(url)}" alt="${esc(t(photo.alt))}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></button>
   <figcaption><span>${esc(t(photo.title))}</span><small><a href="${esc(photo.original)}" target="_blank" rel="noopener noreferrer">${esc(photo.author)}</a></small></figcaption>
 </figure>`;
}
const photoViewer = mountPhotoViewer(main);

function replySources(reply) {
 const photo = cityPhotos.find(item => item.id === reply.photoId);
 const items = [...(reply.sources ?? []), reply.source];
 if (photo) items.push({title: t('Фото') + ': ' + t(photo.title), url: photo.original});
 const seen = new Set();
 return items.filter(Boolean).flatMap(item => {
  const known = Object.hasOwn(sources, item.id) ? sources[item.id] : item;
  let url = null;
  try {
   const parsed = new URL(known.url);
   if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed;
  } catch { /* Internal materials can have no link. */ }
  const key = url?.href || known.title;
  if (!key || seen.has(key)) return [];
  seen.add(key);
  return [{title: t(known.title), url, checkedAt: item.checkedAt}];
 });
}

const sourcesViewer = document.createElement('dialog');
sourcesViewer.className = 'reply-sources-viewer';
sourcesViewer.setAttribute('aria-labelledby', 'replySourcesTitle');
sourcesViewer.innerHTML = `<header><h2 id="replySourcesTitle" data-i18n="Источники">Источники</h2><button type="button" aria-label="Закрыть источники" data-i18n-label="Закрыть источники" autofocus>${icon('close')}</button></header><ul></ul>`;
document.body.append(sourcesViewer);
sourcesViewer.querySelector('button').onclick = () => sourcesViewer.close();
sourcesViewer.addEventListener('click', event => {
 if (event.target === sourcesViewer) sourcesViewer.close();
});

function openReplySources(items) {
 if (sourcesViewer.open) return;
 sourcesViewer.querySelector('ul').innerHTML = items.map(({title, url, checkedAt}) => {
  const label = esc(title);
  const meta = [url?.hostname.replace(/^www\./, ''), checkedAt && t('Проверено') + ': ' + checkedAt].filter(Boolean).join(' · ');
  const content = `<span class="source-glyph" aria-hidden="true">${icon(url?.hostname.includes('wikimedia') ? 'layers' : 'museum')}</span><span class="source-details">${label}${meta ? `<small>${esc(meta)}</small>` : ''}</span>`;
  return `<li>${url ? `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${content}${icon('arrow')}</a>` : `<span>${content}</span>`}</li>`;
 }).join('');
 sourcesViewer.showModal();
}

function messageHtml(message, showCitation = false) {
 if (message.user) return `<div class="message user"><span class="message-text">${esc(message.text)}</span></div>`;
 const source = showCitation === true ? message.source : null;
 const details = source && (Object.hasOwn(sources, source.id) ? sources[source.id] : source);
 const date = source?.checkedAt ? `<small class="source-date">${esc(t('Проверено'))}: ${esc(source.checkedAt)}</small>` : '';
 const label = details ? t('Источник') + ': ' + esc(t(details.title)) : '';
 const citation = details?.url
  ? `<a class="message-source" href="${esc(details.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  : label ? `<span class="message-source">${label}</span>` : '';
 return `<div class="message"><div class="message-text reply-markdown">${renderReplyMarkdown(message.text)}</div>${replyPhotoHtml(message.photoId)}${date}${citation}</div>`;
}
function navigateTo(target){
 if(location.hash==='#'+target)render();
 else location.hash=target;
}
function navigateFlow(target){
 if(location.hash===target)return;
 const flowBack=location.hash||'#home';
 history.pushState({flowBack},'',target);
 handleRouteChange();
}
document.addEventListener('click', event => {
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const link=event.target.closest('a[data-flow-link], a[data-flow-back]');
 if(!link)return;
 const target=link.hash;
 if(link.hasAttribute('data-flow-link')){
  event.preventDefault();
  navigateFlow(target);
 }else if(history.state?.flowBack===target){
  event.preventDefault();
  history.back();
 }
});
async function chooseStudioGuide(id){
 captureDraft();studioTab='profile';state.selected=id;
 try{await save();navigateTo('studio');}catch(e){toast(e.message);}
}
let libraryScroll = 0;
let mapScroll = 0;
let lastHomeGuide;
const mapMemory = {layer:'street'};
function render(){
 if(!ready)return;
 const previous=document.body.dataset.page;
 if(['#guides','#lobachevsky','#dobrolyubov'].includes(location.hash)) history.replaceState(history.state,'','#home');
 if(location.hash==='#routes') history.replaceState(history.state,'','#map');
 const route=location.hash.slice(1);
 const profile=route.startsWith('guide/') && publicGuide(route.slice(6));
 const page=profile?'guide':fixedGuides.has(route)||route.startsWith('chat/')&&publicGuide(route.slice(5))?'chat'
  :['map','studio','about','screen','analytics','chat'].includes(route)?route:'home';
 const navigating=page!==previous;
 const restoringMapFocus = page === 'map' && mapMemory.focus;
 const studioPanel=$('#studioPanel')?.getAttribute('aria-labelledby');
 const enteringChat=previous==='home' && page==='chat';
 const returningToGuides=previous==='chat' && page==='home';
 const guidePortrait=()=>$('[data-portrait-for="' + CSS.escape(enteringChat ? chatGuide().id : main.dataset.chatGuide || state.selected) + '"] > img');
 const chatPortrait=()=>$('.conversation-avatar .avatar-image > img');
 if(previous==='home'&&navigating)libraryScroll=window.scrollY;
 if(previous==='home'&&profile)lastHomeGuide=profile.id;
 if(previous==='map'&&navigating)mapScroll=window.scrollY;
 const before=enteringChat ? rememberPortrait(guidePortrait()) : returningToGuides ? rememberPortrait(chatPortrait()) : null;
 stopPortraitMotion();
 viewId++;askController?.abort();busy=false;
 document.body.dataset.page=page;
 if(main.contains(workspaceStatus))main.before(workspaceStatus);
 renderVue(pageView(page,profile),main);
 const heading = main.querySelector('h1');
 const sectionName = {map:t('Карта'),chat:t('Диалог с персонажем'),screen:'Экран посетителя'}[page];
 document.title = [sectionName, heading?.textContent, t('Город говорит')].filter(Boolean).join(' · ');
 $('#studioStatusSlot')?.append(workspaceStatus);
 if(navigating) {
  window.scrollTo(0,page==='home'?libraryScroll:page==='map'?mapScroll:0);
  const focus=page==='guide' ? $(previous==='chat'?'.guide-detail-action button':'#guide-detail-title') : page==='home'&&previous==='guide'
    ? $(`[data-guide="${lastHomeGuide}"] .guide-card-open`) : null;
  if (focus) focus.focus({preventScroll:true});
  else if (previous && !restoringMapFocus) main.focus({preventScroll:true});
 }
 renderNavigation(page);
 status();
 updateViewport();
 if(navigating){
  reveal(page==='home' ? $('.guide-library') : main,{duration:180,distance:0});
  if(before){
   const target=enteringChat ? chatPortrait() : guidePortrait();
   if(!movePortrait(before,target))reveal(target,{duration:170,distance:0});
  }
 }else if(page==='studio'&&studioPanel!==$('#studioPanel')?.getAttribute('aria-labelledby')){
  reveal($('#studioPanel'),{duration:180,distance:4});
 }
}
function download(name,text,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function pageView(page, profile) {
 const key = viewId;
 const back = history.state?.flowBack || '#home';
 switch (page) {
  case 'studio':
   return h(StudioPage, {key, guide: editGuide(), guides: state.guides, tab: studioTab, actions: studioActions});
  case 'map':
   return h(MapPage, {key, memory:mapMemory, onChoose:id=>navigateFlow('#guide/'+id)});
  case 'guide':
   return h(GuidePage, {key, guide:localizedGuide(profile), site:projectionSites.find(site=>site.id===profile.id),
    back, onScan: openProjectorScanner});
  case 'about':
   return h(AboutPage, {key});
  case 'screen':
   return h(VisitorScreen, {key, guide: guide(), round: screenRound, onAsk: askOnScreen,
    onFormat: () => { screenRound = !screenRound; render(); },
    onFullscreen: toggleFullscreen,
    onStopVoice: stopVisitorSpeech,
    onReset: () => { stopVisitorSpeech(); render(); },
   });
  case 'analytics':
   return h(StatisticsPage, {
    key,
    asks: state.events.filter(item => item.type === 'ask').length,
    likes: state.events.filter(item => item.type === 'feedback' && item.value === 'helpful').length,
    onExport: () => download('events.json', JSON.stringify(state.events, null, 2)),
   });
  case 'chat': {
   const original = chatGuide();
   const guide = localizedGuide(original);
   main.dataset.chatGuide = guide.id;
   if (stationMode && location.hash === '#' + stationId) return h(StationConversation, {key, back, profile:original});
   return h(ConversationPage, {
    key, guide, back,
    questions: (original === projectorGuide ? popovQuestions : suggestions(original)).map(question => t(question)),
    binding: {
     guide,
     messages: conversationHistory(guide.id),
     renderMessage: messageHtml,
     ask: requestAnswer,
     notify: toast,
     replySources,
     openReplySources,
     feedback: (reply, value) => saveFeedback(guide.id, reply, value),
    },
   });
  }
  default:
   return h(GuideCatalogue, {key, entries: catalogueEntries()});
 }
}

async function saveFeedback(guideId, reply, value) {
 let record = feedbackEvents.get(reply);
 const previous = state.events.includes(record) ? record.value : undefined;
 if (previous !== undefined) record.value = value;
 else {
  event('feedback', value, guideId);
  record = state.events.at(-1);
  feedbackEvents.set(reply, record);
 }
 try {
  await save({quiet:true});
  if (document.body.dataset.page === 'chat') toast(t('Спасибо за оценку'), true);
 } catch (error) {
  if (previous === undefined) {
   state.events = state.events.filter(item => item !== record);
   feedbackEvents.delete(reply);
  } else record.value = previous;
  toast(error.message);
  throw error;
 }
}

async function toggleFullscreen() {
 try {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await $('.screen-layout').requestFullscreen();
 } catch { toast('Полноэкранный режим недоступен'); }
}

function stopVisitorSpeech() {
 window.speechSynthesis?.cancel();
 document.body.classList.remove('speaking');
}

function selectStudioTab(tab) {
 captureDraft();
 studioTab = tab;
 render();
 $('#studio-' + tab)?.focus();
}

function studioTabKeys(event) {
 if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
 event.preventDefault();
 const tabs = ['profile','knowledge','preview'];
 const index = tabs.indexOf(studioTab);
 const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
  : (index + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length;
 selectStudioTab(tabs[next]);
}

function resetImage() {
 captureDraft();
 drafts[state.selected] ||= structuredClone(guide());
 delete drafts[state.selected].image;
 keepDrafts();
 render();
 toast('Стандартный образ восстановлен в черновике');
}

async function deleteGuide() {
 if (state.guides.length === 1) return toast('Нужен хотя бы один персонаж');
 if (!confirm('Удалить персонажа и все его материалы? Резервную копию можно скачать кнопкой «Скачать проект».')) return;
 delete drafts[state.selected];
 state.guides = state.guides.filter(g => g.id !== state.selected);
 state.selected = state.guides[0].id;
 keepDrafts();
 try { await save(); } catch (error) { toast(error.message); }
 render();
}

const studioActions = {
 captureDraft, saveGuide, uploadImage, resetImage, deleteGuide, openScreen, importProject,
 selectGuide: chooseStudioGuide,
 selectTab: selectStudioTab,
 tabKeys: studioTabKeys,
 previewChat: () => navigateTo('chat'),
 newGuide: () => newGuide(),
 duplicateGuide: () => newGuide(true),
 addMaterial: () => docModal(),
 editMaterial: docModal,
 exportGuide: () => download('digital-guide.json', JSON.stringify(guide(), null, 2)),
};

async function saveGuide(e){e.preventDefault();captureDraft();commitDrafts();const b=e.submitter;b.disabled=true;try{await save();render();toast('Персонаж сохранён');}catch(err){if($('#guideError'))$('#guideError').textContent=err.message;b.disabled=false;}}
async function uploadImage(e){const file=e.target.files[0];if(!file)return;if(file.size>1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('Выберите PNG, JPEG или WebP до 1 МБ');e.target.value='';return;}captureDraft();const id=state.selected;
 const reader=new FileReader();reader.onload=async()=>{try{const img=new Image();img.src=reader.result;await img.decode();drafts[id] ||= structuredClone(state.guides.find(g=>g.id===id));drafts[id].image=reader.result;keepDrafts();if(state.selected===id&&location.hash==='#studio')render();status();toast('Картинка добавлена в черновик. Сохраните персонажа.');}catch{toast('Не удалось прочитать изображение');}};reader.readAsDataURL(file);}
async function newGuide(duplicate=false){captureDraft();studioTab='profile';if(state.guides.length>=12)return toast('В прототипе доступно до 12 персонажей');const g=duplicate===true?structuredClone(editGuide()):{name:'Новый гид',role:'Помощник моей площадки',tag:'Свой персонаж',color:'#dce9e3',art:'custom',greeting:'Здравствуйте! Чем могу помочь?',voice:'friendly',docs:[]};g.id='custom-'+makeId();if(duplicate===true)g.name=(g.name+' — копия').slice(0,60);state.guides.push(g);state.selected=g.id;try{await save();navigateTo('studio');toast('Персонаж создан. Добавьте знания и своё изображение.');}catch(e){navigateTo('studio');toast(e.message);}}
async function importProject(e){const file=e.target.files[0];if(!file)return;try{if(file.size>3000000)throw Error('Файл слишком велик: максимум 3 МБ');const data=JSON.parse(await file.text());let next;
 if(data.format==='gorod-govorit'&&data.version===1)next=data.state;
 else if(data.guides)next=data;
 else if(data.id&&data.docs){next=structuredClone(state);const g=structuredClone(data);g.id='custom-'+makeId();next.guides.push(g);next.selected=g.id;}
 else throw Error('Это не резервная копия проекта или персонажа');
 validateState(next);if(!confirm('Импорт заменит текущий проект данными файла (персонаж добавится отдельно). Скачайте текущий проект перед заменой. Продолжить?'))return;
 state=structuredClone(next);drafts={};keepDrafts();await save();render();toast('Проект восстановлен');
 }catch(err){toast('Импорт: '+err.message);}finally{e.target.value='';}}
function closeModal() {
 renderVue(null, $('#modal'));
 document.body.classList.remove('modal-open');
 main.inert = false;
 $('.topbar').inert = false;
 $('#mobileNav').inert = false;
 modalReturn?.focus();
 modalReturn = null;
 if (remotePending) status();
}

function docModal(id) {
 captureDraft();
 modalReturn = document.activeElement;
 document.body.classList.add('modal-open');
 main.inert = true;
 $('.topbar').inert = true;
 $('#mobileNav').inert = true;
 const ownerId = state.selected;
 const material = editGuide().docs.find(item => item.id === id) || {
  id:'doc-' + makeId(), title:'', text:'', source:'Материалы площадки', url:'', tags:'',
  checkedAt:new Date().toISOString().slice(0,10),
 };
 async function saveMaterial(event) {
  const fields = new FormData(event.target);
  const doc = {id:material.id, ...Object.fromEntries([...fields].map(([key, value]) => [key, String(value).trim()]))};
  if (doc.url && !doc.url.startsWith('https://')) {
   $('#docError').textContent = 'Ссылка должна начинаться с https://';
   return;
  }
  if (!doc.checkedAt) delete doc.checkedAt;
  commitDrafts();
  const owner = state.guides.find(g => g.id === ownerId);
  const index = owner.docs.findIndex(item => item.id === material.id);
  if (index >= 0) owner.docs[index] = doc;
  else owner.docs.push(doc);
  event.submitter.disabled = true;
  try {
   await save();
   closeModal();
   render();
   toast('База знаний обновлена');
  } catch (error) {
   const notice = $('#docError');
   if (notice) notice.textContent = error.message;
   event.submitter.disabled = false;
  }
 }
 async function removeMaterial() {
  commitDrafts();
  const owner = state.guides.find(g => g.id === ownerId);
  owner.docs = owner.docs.filter(item => item.id !== id);
  try {
   await save();
   closeModal();
   render();
   toast('Материал удалён');
  } catch (error) { toast(error.message); }
 }
 renderVue(h(MaterialEditor, {
  doc: material,
  editing: Boolean(id),
  actions: {close:closeModal, save:saveMaterial, remove:removeMaterial},
 }), $('#modal'));
 $('#docForm input').focus();
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='Tab'&&$('#modal .modal-card')){const els=[...$('#modal').querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(x=>!x.disabled);if(e.shiftKey&&document.activeElement===els[0]){e.preventDefault();els.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===els.at(-1)){e.preventDefault();els[0].focus();}}});
async function requestAnswer(question){
 if(busy)return null;
 const originView=viewId,activeGuide=chatGuide(),guideId=activeGuide.id;
 const controller=new AbortController();
 askController=controller;
 busy=true;
 const current=()=>originView===viewId&&guideId===chatGuide().id&&!controller.signal.aborted;
 try{
  await saveQueue;
  if(dirty||conflict)throw Error(t('Сначала сохраните изменения проекта.'));
  const response=activeGuide===projectorGuide ? answerPopov(question)
   : usesFixedGuide(activeGuide) || (locale() !== 'ru' && fixedGuides.has(guideId)) ? answer(question,localizedGuide(activeGuide))
   : await api('/api/ask',{method:'POST',body:{guideId,question},signal:controller.signal});
  if(!current())return null;
  event('ask',response.matched?'matched':'unknown',guideId);
  void save({quiet:true}).catch(()=>{});
  return response;
 }finally{
  if(current())busy=false;
  if(remotePending&&!dirty&&!Object.keys(drafts).length)void receiveUpdate();
 }
}
async function askOnScreen(e){
 e.preventDefault();
 if(busy)return;
 const input=$('#question'),send=$('#sendQuestion'),error=$('#askError'),answer=$('#screenAnswer');
 const question=input.value.trim();
 if(!question||question.length>500)return;
 error.textContent='';send.disabled=true;send.textContent='Ищем ответ…';input.value='';
 try{
  const response=await requestAnswer(question);
  if(!response||!input.isConnected)return;
  answer.innerHTML=messageHtml(response,true);
  if($('#voiceToggle')?.checked)speak(plainReply(response.text));
 }catch(cause){
  if(!input.isConnected)return;
  error.textContent=cause.message;input.value=question;
 }finally{
  if(input.isConnected){send.disabled=false;send.textContent='Спросить';}
 }
}
function speak(text){if(!('speechSynthesis'in window))return toast('Озвучка недоступна в этом браузере');speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=speechLocale();const v=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().split(/[-_]/)[0]===locale());if(v)u.voice=v;u.rate=guide().voice==='calm'?.9:1.02;u.onstart=()=>{document.body.classList.add('speaking');document.querySelectorAll('.portrait').forEach(p=>p.classList.add('talking'));};u.onend=u.onerror=()=>{document.body.classList.remove('speaking');document.querySelectorAll('.portrait').forEach(p=>p.classList.remove('talking'));};speechSynthesis.speak(u);}
function openScreen(){window.open(location.pathname+'#screen','gorod-visitor');}
function openProjectorScanner() {
 openQrScanner(stationMode ? {
  onStationCode(code) {
   saveStationAdmission(code);
   navigateFlow('#' + stationId);
  },
 } : undefined);
}
function renderNavigation(page) {
 const header = $('.topbar');
 header.hidden = ['map','guide','chat'].includes(page);
 if (!header.hidden) renderVue(h(AppHeader, {
  showLanguages: page === 'home',
  language: locale(),
  onLanguage: value => {
   if (value === locale() || !setLocale(value)) return;
   applyPageLanguage();
   render();
  },
 }), header);
 const nav = $('#mobileNav');
 nav.hidden = page === 'guide' || page === 'chat';
 renderVue(h(AppNavigation, {key:locale(), page, onScan: openProjectorScanner}), nav);
 highlightNavigation(nav, page);
}

function handleRouteChange(){
 if(stationMode){enterStationRoute(stationId);applyPageLanguage();}
 photoViewer.close();
 sourcesViewer.close();
 $('#qr-scanner').close();
 captureDraft();
 if(location.hash==='#studio')studioTab='profile';
 closeModal();
 document.body.classList.remove('speaking');
 window.speechSynthesis?.cancel();
 render();
}
window.addEventListener('hashchange',handleRouteChange);
async function receiveUpdate(){remotePending=true;if(busy||pendingSaves||dirty||Object.keys(drafts).length||$('#docForm')){status();return;}const view=viewId;try{const j=await api('/api/state');if(busy||pendingSaves||dirty||Object.keys(drafts).length||$('#docForm')||view!==viewId)return;if(j.revision>revision){state=j.state;revision=j.revision;window.speechSynthesis?.cancel();document.body.classList.remove('speaking');render();}remotePending=false;status();}catch{}}
channel&&(channel.onmessage=receiveUpdate);
window.addEventListener('beforeunload',e=>{if(dirty||Object.keys(drafts).length){e.preventDefault();e.returnValue='';}});

applyPageLanguage();
renderNavigation(location.hash.slice(1).split('/')[0] || 'home');
renderVue(h('section', {class:'panel'}, [h('span', {class:'loader'}), ' '+t('Загружаем вашу рабочую область…')]), main);
sync().then(render).catch(error => {
 renderVue(h('section', {class:'empty'}, [
  h('h2', t('Не удалось подключиться')),
  h('p', {class:'note'}, error.message),
  h('button', {class:'button', id:'retry', onClick:() => location.reload()}, t('Попробовать снова')),
 ]), main);
});

function updateViewport(){
 const vv=window.visualViewport,editable=document.activeElement?.matches('input:not([type=checkbox]):not([type=color]),textarea,select');
 document.documentElement.style.setProperty('--status-height',(main.contains(workspaceStatus)?0:workspaceStatus.offsetHeight)+'px');
 document.documentElement.style.setProperty('--viewport-height',(vv?.height||window.innerHeight)+'px');
 document.body.classList.toggle('keyboard-open',Boolean(editable&&vv&&window.innerHeight-vv.height>120));
}
window.visualViewport?.addEventListener('resize',updateViewport);
window.addEventListener('resize',updateViewport);
document.addEventListener('focusin',updateViewport);document.addEventListener('focusout',()=>requestAnimationFrame(updateViewport));

function makeId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2,"0")).join("");}
