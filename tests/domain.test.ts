import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundary,isDate,isBoundary,todayIn,addDays } from '../server/dates.js';
import { money } from '../server/validation.js';

test('month anchors recover after February and support leap years',()=>{
  assert.equal(boundary('2025-01-31',1),'2025-02-28');assert.equal(boundary('2025-01-31',2),'2025-03-31');
  assert.equal(boundary('2024-01-31',1),'2024-02-29');assert.equal(boundary('2024-01-31',2),'2024-03-31');
  assert.equal(boundary('2025-12-30',2),'2026-02-28');assert.equal(boundary('2025-12-30',3),'2026-03-30');
  assert.equal(isBoundary('2025-01-31','2025-02-28'),true);assert.equal(isBoundary('2025-01-31','2025-03-28'),false);
});
test('real dates and kopecks validated without accepting overflow or fractional money',()=>{
  for(const value of ['2025-02-29','2025-13-01','2025-04-31','invalid'])assert.equal(isDate(value),false);
  assert.equal(isDate('2024-02-29'),true);
  for(const value of [0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.equal(money.safeParse(value).success,false);
  assert.equal(money.safeParse(1).success,true);
});
test('business today respects timezone across UTC midnight',()=>{
  assert.equal(todayIn('Europe/Moscow',new Date('2026-11-09T22:00:00Z')),'2026-11-10');
  assert.equal(addDays('2024-03-01',-1),'2024-02-29');
});
