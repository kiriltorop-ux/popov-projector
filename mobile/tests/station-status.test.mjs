import test from 'node:test';
import assert from 'node:assert/strict';
import {stationTurnStatus} from '../docs/station-status.mjs';

test('queue positions apply during generation as well as when audio is ready', () => {
  for (const state of ['generating', 'queued', 'delivered', 'prepared']) {
    assert.equal(stationTurnStatus({state, ahead: 1}), 'Вы следующий в очереди');
    assert.equal(stationTurnStatus({state, ahead: 2}), 'Ваш номер в очереди: 3');
    assert.equal(stationTurnStatus({state, ahead: 4}), 'Ваш номер в очереди: 5');
    assert.doesNotMatch(stationTurnStatus({state, ahead: 0}), /очереди/);
  }
});

test('playing and terminal states do not show stale queue positions', () => {
  assert.equal(stationTurnStatus({state: 'started', ahead: 1}), 'Сейчас Попов отвечает вам');
  assert.equal(stationTurnStatus({state: 'finished', ahead: 1}), '');
  assert.match(stationTurnStatus({state: 'failed', ahead: 1}), /не прозвучал/);
});
