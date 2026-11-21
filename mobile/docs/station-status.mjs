const waiting = new Set(['generating', 'queued', 'delivered', 'prepared']);

export function stationTurnStatus(turn, t = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ''), guide = 'popov') {
  if (waiting.has(turn.state) && turn.ahead > 0) {
    return turn.ahead === 1
      ? t('Вы следующий в очереди')
      : t('Ваш номер в очереди: {count}', {count: turn.ahead + 1});
  }
  return {
    generating: t('Готовлю ответ…'),
    queued: t('Ответ готов, ждём проектор'),
    delivered: t('Ответ передан на проектор'),
    prepared: t('Готовлюсь говорить…'),
    started: guide === 'minin' ? t('Минин говорит у проектора') : t('Сейчас Попов отвечает вам'),
    failed: t(turn.error || 'Ответ не прозвучал. Вопрос можно повторить.'),
    cancelled: t('Озвучка остановлена. Вопрос можно повторить.'),
    finished: '',
  }[turn.state] || '';
}
