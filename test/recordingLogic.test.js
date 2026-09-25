'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isDoubleClick, createClickQueue } = require('../app/recordingLogic.js');

test('近い時刻・近い位置の連続した左クリックはダブルクリックと判定する', () => {
  const pending = { clickType: 'left', x: 100, y: 100, time: 1000 };
  const next    = { clickType: 'left', x: 105, y: 98,  time: 1200 };
  assert.equal(isDoubleClick(pending, next), true);
});

test('時間が離れすぎている場合はダブルクリックと判定しない', () => {
  const pending = { clickType: 'left', x: 100, y: 100, time: 1000 };
  const next    = { clickType: 'left', x: 100, y: 100, time: 1400 }; // 350ms 超
  assert.equal(isDoubleClick(pending, next), false);
});

test('位置が離れすぎている場合はダブルクリックと判定しない', () => {
  const pending = { clickType: 'left', x: 100, y: 100, time: 1000 };
  const next    = { clickType: 'left', x: 150, y: 100, time: 1100 }; // 20px 超
  assert.equal(isDoubleClick(pending, next), false);
});

test('右クリックはダブルクリックの対象にしない', () => {
  const pending = { clickType: 'right', x: 100, y: 100, time: 1000 };
  const next    = { clickType: 'left',  x: 100, y: 100, time: 1100 };
  assert.equal(isDoubleClick(pending, next), false);
});

test('pending が無ければダブルクリックにならない', () => {
  const next = { clickType: 'left', x: 100, y: 100, time: 1100 };
  assert.equal(isDoubleClick(null, next), false);
});

test('クリックキューは積んだ順に1件ずつ実行する', async () => {
  const queue = createClickQueue();
  const order = [];
  const delays = [30, 5, 15]; // 早く終わるものが混じっても順序は保たれる

  const results = delays.map((ms, i) =>
    queue.enqueue(() => new Promise(resolve => {
      setTimeout(() => { order.push(i); resolve(); }, ms);
    }))
  );

  await Promise.all(results);
  assert.deepEqual(order, [0, 1, 2]);
});

test('キューの1件が失敗しても後続は実行され、順序も保たれる', async () => {
  const queue = createClickQueue();
  const order = [];

  const r0 = queue.enqueue(() => Promise.reject(new Error('失敗')));
  const r1 = queue.enqueue(() => { order.push('b'); return Promise.resolve(); });

  await Promise.allSettled([r0, r1]);
  assert.deepEqual(order, ['b']);
});

test('drain はキューが空になるまで待ち、待っている間は size() が0より大きい', async () => {
  const queue = createClickQueue();
  let done = false;
  queue.enqueue(() => new Promise(resolve => setTimeout(() => { done = true; resolve(); }, 20)));

  assert.equal(queue.size() > 0, true);
  const finished = await queue.drain(1000);
  assert.equal(finished, true);
  assert.equal(done, true);
  assert.equal(queue.size(), 0);
});

test('drain はタイムアウトを過ぎたら false を返す（キューは止めない）', async () => {
  const queue = createClickQueue();
  queue.enqueue(() => new Promise(resolve => setTimeout(resolve, 100)));

  const finished = await queue.drain(10);
  assert.equal(finished, false);
});
