import { locale, t } from './i18n.mjs';

// Conversation materials from the station's visitor-question script.
export const projectorGuide = {
  id: 'popov',
  name: 'Александр Попов',
  tag: 'Радиоприёмник',
  role: 'Разговор у проектора',
  image: './assets/popov.webp',
  art: 'custom',
  color: '#d7e8fa',
  voice: 'calm',
  greeting: 'Здравствуйте. Меня зовут Александр Попов. Хотите узнать, как работает мой приёмник?',
};

const topics = [
  {
    title: 'Как работает приёмник?',
    pattern: /приемник|на столе|на стол|этот прибор|этот аппарат|реле|антенн/,
    text: 'Посмотрите на приёмник. Его антенна улавливает радиоволну. В ответ срабатывает реле, замыкается электрическая цепь, и мы слышим звонок.',
    source: {title: 'Политехнический музей · Прибор для обнаружения электрических колебаний', url: 'https://polymus.ru/collection/detail/pribor-dlya-obnaruzheniya-i-registrirovaniya-elektricheskikh-kolebaniy'},
  },
  {
    title: 'Кто вы?',
    pattern: /как (вас|тебя) зовут|кто (вы|ты|такой попов)|представь/,
    text: 'Меня зовут Александр Степанович Попов. Я занимался физикой и опытами с радиоволнами.',
  },
  {
    title: 'Что такое радиоволна?',
    pattern: /что такое радио|радиоволн|как работает радио|без провод/,
    text: 'Представьте передатчик и приёмник. Между ними нет провода. Сигнал переносит радиоволна.',
  },
];

export const popovQuestions = topics.map(topic => topic.title);

export function answerPopov(question) {
  const language = locale();
  if (language !== 'ru') {
    const query = question.toLowerCase();
    const patterns = language === 'en'
      ? [/receiver|antenna|relay/, /who are you|your name|introduce yourself/, /(?:radio )?waves?|wireless|signal/]
      : [/接收机|接收器|天线|继电器/, /你是谁|您是谁|叫什[么麼]|自我介绍/, /电波|无线电|信号/];
    const index = patterns.findIndex(pattern => pattern.test(query));
    if (index >= 0) return {text:t(topics[index].text), matched:true, source:topics[index].source};
    if (/hello|^hi\b|你好|您好/.test(query)) return {text:t(projectorGuide.greeting), matched:true};
    if (/thank|谢谢|感谢/.test(query)) return {text:t('Благодарю за интерес к моим опытам.'), matched:true};
    return {text:t('Об этом у меня пока нет рассказа. Спросите, как работает приёмник, или что такое радиоволна.'), matched:false};
  }
  const words = question.toLowerCase().replaceAll('ё', 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim();
  const topic = topics.find(item => item.pattern.test(words));
  if (topic) return {text: topic.text, matched: true, source: topic.source};
  if (/привет|здравств|добрый (день|вечер)|доброе утро/.test(words)) return {text: projectorGuide.greeting, matched: true};
  if (/спасибо|благодар/.test(words)) return {text: 'Благодарю за интерес к моим опытам.', matched: true};
  return {text: 'Об этом у меня пока нет рассказа. Спросите, как работает приёмник, или что такое радиоволна.', matched: false};
}
