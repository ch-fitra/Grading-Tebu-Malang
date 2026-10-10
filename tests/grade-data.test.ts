import test from 'node:test';
import assert from 'node:assert/strict';
import { dominantGrade, meanClassScores, frameNumbers } from '../apps/web/src/utils/grade-data.ts';
test('database B and T remain B and T instead of impurity-based X', () => {
  assert.equal(dominantGrade([{grade:'B'}, {grade:'T'}, {grade:'B'}]), 'B');
  assert.equal(dominantGrade([{grade:'T'}, {grade:'T'}, {grade:'B'}]), 'T');
  assert.equal(dominantGrade([{grade:'S'}]), 'S');
});
test('probabilities use persisted model scores, including T and zero X', () => {
  assert.deepEqual(meanClassScores([{classScores:{B:100,T:0}}, {classScores:{B:0,T:100}}]), {B:50,T:50});
  assert.equal(meanClassScores([{}]), undefined);
});

test('frame numbering restarts per cycle and preserves chronological positions', () => {
  const history = [70,69,68,67].map((id, index) => ({id, cameraId:1, timestamp:new Date(10000-index*1000).toISOString()})) as any;
  const cycles = [{captureIds:[67,68],line:1}, {captureIds:[69,70],line:1}] as any;
  const numbers = frameNumbers(history, cycles);
  assert.deepEqual([67,68,69,70].map(id => numbers.get(id)), [1,2,1,2]);
});
