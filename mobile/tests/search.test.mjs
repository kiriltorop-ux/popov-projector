import test from 'node:test';
import assert from 'node:assert/strict';
import {answer,validateState} from '../docs/engine.mjs';
import {initialState} from '../docs/data.mjs';
test('Answers have sources, and unrelated questions are refused',()=>{
 const g=initialState().guides[0];
 const result=answer('Какое ваше настоящее имя?',g);
 assert.match(result.text,/Пешкова/);assert.equal(result.source.id,'museum');
 assert.equal(answer('Какая температура на Венере?',g).matched,false);
});
test('An operator change affects the next answer',()=>{
 const s=initialState(),g=s.guides[2];
 g.docs[0].text='Завтрак с 08:30 до 11:00.';
 validateState(s);assert.match(answer('Во сколько завтрак?',g).text,/08:30/);
});
test('Import rejects unsafe links and duplicate guide IDs',()=>{
 const s=initialState();s.guides[0].docs[0].url='javascript:alert(1)';
 assert.throws(()=>validateState(s),/HTTPS/);
 const other=initialState();other.guides[1].id=other.guides[0].id;
 assert.throws(()=>validateState(other),/идентификатор/);
});
