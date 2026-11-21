import { locale, t } from './i18n.mjs';
import {defaultGuides,routes} from './data.mjs?v=river-design';
import {cityPhotos} from './city-photos.mjs';

// Russian suffix normalization follows Snowball's RV/R2 rules.
// Specification: https://snowballstem.org/algorithms/russian/stemmer.html
const stop=new Set('а и но это как что где когда кто какой какая какие какое мне меня ты вы ваш ваша ваше ваши вашем его её или о об по на в во из за у с со для до ли бы есть расскажи расскажите пожалуйста узнать хочу скажи про вас самом деле сколько разрешены таком каком перечислите такое находится стоят почитать'.split(' '));
export function stem(word){
 const w=word.toLowerCase().replaceAll('ё','е');
 if(!/^[а-я]+$/.test(w))return w;
 const rv=w.search(/[аеиоуыэюя]/)+1;if(!rv)return w;
 const region=s=>{const m=/[аеиоуыэюя][^аеиоуыэюя]/.exec(s);return m?m.index+2:s.length;};
 const r1=region(w),r2=r1+region(w.slice(r1));let tail=w.slice(rv);
 const remove=re=>{const next=tail.replace(re,'');const changed=next!==tail;tail=next;return changed;};
 if(!remove(/(?:ившись|ывшись|ивши|ывши|ив|ыв|(?<=[ая])вшись|(?<=[ая])вши|(?<=[ая])в)$/)){
  remove(/(?:ся|сь)$/);
  if(remove(/(?:ими|ыми|его|ого|ему|ому|ее|ие|ые|ое|ей|ий|ый|ой|ем|им|ым|ом|их|ых|ую|юю|ая|яя|ою|ею)$/))remove(/(?:ивш|ывш|ующ|(?<=[ая])ем|(?<=[ая])нн|(?<=[ая])вш|(?<=[ая])ющ|(?<=[ая])щ)$/);
  else if(!remove(/(?:ейте|уйте|ила|ыла|ена|ите|или|ыли|ило|ыло|ено|ует|уют|ены|ить|ыть|ишь|ей|уй|ил|ыл|им|ым|ен|ят|ит|ыт|ую|ю|(?<=[ая])нно|(?<=[ая])ете|(?<=[ая])йте|(?<=[ая])ешь|(?<=[ая])ла|(?<=[ая])на|(?<=[ая])ли|(?<=[ая])ем|(?<=[ая])ло|(?<=[ая])но|(?<=[ая])ет|(?<=[ая])ют|(?<=[ая])ны|(?<=[ая])ть|(?<=[ая])й|(?<=[ая])л|(?<=[ая])н)$/))remove(/(?:иями|ией|иям|ием|иях|ями|ами|ев|ов|ие|ье|еи|ии|ей|ой|ий|ям|ем|ам|ом|ах|ях|ию|ью|ия|ья|а|е|и|й|о|у|ы|ь|ю|я)$/);
 }
 remove(/и$/);let full=w.slice(0,rv)+tail;const deriv=/(ость|ост)$/.exec(full);if(deriv&&deriv.index>=r2)tail=tail.slice(0,-deriv[0].length);
 if(!remove(/(?<=н)н$/)){if(remove(/ейше?$/))remove(/(?<=н)н$/);else remove(/ь$/);}
 return w.slice(0,rv)+tail;
}
export function tokens(s){return (s.toLowerCase().replaceAll('ё','е').match(/[а-яa-z0-9]+/g)||[]).filter(x=>x.length>1&&!stop.has(x)).map(stem);}
// Keep a conservative noun-form alternative alongside Snowball for Russian.
const englishStop = new Set('a an the i me my you your he she his her they their who what where when why how did do does was were is are be been to of in on at for and or about can could would please show tell give it that over'.split(' '));
const chineseStop = new Set('什么 怎么 怎样 如何 哪里 哪儿 哪些 是谁 请问 告诉 知道 以及 关于 能否 可以 时候 谢谢'.split(' '));
const chineseWords = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh',{granularity:'word'}) : null;

function lexical(s) {
 if (locale() !== 'ru') {
  const words = locale() === 'zh' && chineseWords
   ? [...chineseWords.segment(s.toLowerCase())].filter(item=>item.isWordLike).map(item=>item.segment)
   : (s.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]);
  return words.filter(word=>word.length>1 && !englishStop.has(word) && !chineseStop.has(word))
   .map(word=>[...new Set([word,word.replace(/([a-z]{3,})s$/,'$1')])]);
 }
 return (s.toLowerCase().replaceAll('ё','е').match(/[а-яa-z0-9]+/g)||[])
  .filter(x=>x.length>1&&!stop.has(x)).map(w=>[...new Set([stem(w),w.replace(/(?:иями|ией|иям|ием|иях|ями|ами|ов|ев|ах|ях|ом|ем|ам|ям|ы|и|а|я|у|ю|е|о)$/,'')])]);
}

function requestedPhoto(question, query, guideId) {
 if (!['gorky', 'nika'].includes(guideId)) return null;
 if (locale() !== 'ru') {
  if (!/photo|picture|image|照片|图片|看看/i.test(question)) return null;
  const names = [/kremlin|克里姆林宫/i,/chkalov|契卡洛夫/i,/volga|伏尔加河/i,/nativity|圣诞/i];
  return cityPhotos[names.findIndex(pattern=>pattern.test(question))];
 }
 if (!/(?:^|[^а-яё])(?:фото[а-яё]*|фотк[а-яё]+|сним(?:ок|к[а-яё]+)|как\s+выгляд[а-яё]+)(?![а-яё])/i.test(question)) return null;
 return cityPhotos.find(photo => photo.names.some(name =>
  lexical(name).every(term => query.some(word => term.some(form => word.includes(form))))
 ));
}
const formattedExamples = new Map([
 ['g-books', `### Произведения Горького

Горький написал пьесу **«На дне»** и автобиографическую повесть **«Детство»**. В экспозиции также представлены:

- *«Макар Чудра»* — рассказ, опубликованный в 1892 году.
- *«Жизнь Клима Самгина»* — неоконченный роман.`],
 ['g-museum', `### Два раздела портала

| Раздел | Что в нём |
| --- | --- |
| **Начать диалог** | Беседа с цифровым образом Горького |
| **Виртуальный музей** | Материалы о писателе и местной истории |

[Посмотреть цифровых гидов](#guides)`],
]);
const originalExamples = new Map(defaultGuides[0].docs.map(doc => [doc.id, doc.text]));

export function answer(question,guide){
 const query=lexical(question);
 const photo=requestedPhoto(question,query,guide.id);
 if(photo)return {text:t(photo.text),photoId:photo.id,source:null,matched:true,algorithm:'photo'};
 const documents=guide.docs.map(d=>({d,terms:lexical(d.title+' '+(d.tags||'')+' '+d.text).flat()}));
 const avg=documents.reduce((a,d)=>a+d.terms.length,0)/(documents.length||1);
 const ranked=documents.map(({d,terms})=>{let hits=0,score=0;for(const q of query){const tf=terms.filter(t=>q.includes(t)).length;if(!tf)continue;hits++;const df=documents.filter(x=>q.some(t=>x.terms.includes(t))).length;score+=Math.log(1+(documents.length-df+.5)/(df+.5))*(tf*2.2)/(tf+1.2*(.25+.75*terms.length/(avg||1)));}return {d,score,hits};}).sort((a,b)=>b.score-a.score);
 const best=ranked[0];const coverage=best?best.hits/(query.length||1):0;
 if(!best||!best.hits||coverage<.6)return {text:t('В моей базе нет достаточно точных сведений об этом. Попробуйте уточнить вопрос или выберите одну из тем ниже.'),source:null,matched:false,algorithm:'BM25',coverage:0};
 const example=locale()==='ru'&&guide.id==='gorky'&&best.d.text===originalExamples.get(best.d.id)
  ? formattedExamples.get(best.d.id) : undefined;
 return {text:example??best.d.text,source:{id:best.d.source,title:best.d.source,url:best.d.url||'',checkedAt:best.d.checkedAt||null},matched:true,algorithm:'BM25',coverage:Number(coverage.toFixed(2)),documentId:best.d.id,...(guide.id==='nika'&&best.d.id==='n-kremlin'?{photoId:'kremlin'}:{})};
}
export function validateState(s){
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const str=(v,max,min=0)=>typeof v==='string'&&v.length<=max&&v.trim().length>=min;
 const fail=message=>{throw Error(message);};
 if(!object(s)||s.version!==1||!Array.isArray(s.guides)||s.guides.length<1||s.guides.length>12)fail('Допустимо от 1 до 12 персонажей; версия проекта должна быть 1.');
 const ids=new Set();
 for(const g of s.guides){
  if(!object(g)||typeof g.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(g.id)||ids.has(g.id))fail('Некорректный или повторяющийся идентификатор персонажа.');ids.add(g.id);
  if(!str(g.name,60,1))fail('Имя должно содержать от 1 до 60 символов.');
  if(!str(g.role,100,1)||!str(g.greeting,500,1)||g.tag!==undefined&&!str(g.tag,60))fail('Проверьте роль, приветствие и категорию.');
  if(!['writer','guide','fox','custom'].includes(g.art)||typeof g.color!=='string'||!/^#[0-9a-f]{6}$/i.test(g.color)||!['calm','friendly'].includes(g.voice))fail('Некорректный стиль.');
  if(g.image!==undefined&&(!str(g.image,1400000)||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(g.image)))fail('Изображение должно быть PNG, JPEG или WebP до 1 МБ.');
  if(!Array.isArray(g.docs)||g.docs.length>40)fail('Не более 40 материалов на гида.');
  const docIds=new Set();
  for(const d of g.docs){
   if(!object(d)||!str(d.id,100,1)||docIds.has(d.id)||!str(d.title,150,1)||!str(d.text,6000,1)||!str(d.source,300,1)||d.tags!==undefined&&!str(d.tags,500))fail('Проверьте поля материала и уникальность его ID.');docIds.add(d.id);
   if(d.url!==undefined){if(!str(d.url,2000))fail('Некорректная ссылка источника.');if(d.url){try{const u=new URL(d.url);if(u.protocol!=='https:'||!u.hostname||u.username||u.password)throw Error();}catch{fail('Нужна полная HTTPS-ссылка без логина и пароля.');}}}
   if(d.checkedAt!==undefined&&(!str(d.checkedAt,10)||!/^\d{4}-\d{2}-\d{2}$/.test(d.checkedAt)||!Number.isFinite(Date.parse(d.checkedAt))))fail('Некорректная дата проверки.');
  }
 }
 if(!ids.has(s.selected))fail('Выбранный персонаж не существует.');
 if(!Array.isArray(s.events)||s.events.length>200||s.events.some(e=>!object(e)||!['ask','route','feedback'].includes(e.type)||!str(e.at,40,1)||!str(e.guide,60,1)||!str(e.value,100)))fail('Некорректные события.');
 if(!Array.isArray(s.savedRoutes)||new Set(s.savedRoutes).size!==s.savedRoutes.length||s.savedRoutes.some(x=>!routes.some(route=>route.id===x)))fail('Некорректные маршруты.');
 if(JSON.stringify(s).length>2100000)fail('Рабочая область слишком велика. Уменьшите изображения.');
 return s;
}
