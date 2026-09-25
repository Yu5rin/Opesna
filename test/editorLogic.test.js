'use strict';
// app/editorLogic.js（キャンバス・注釈の純粋な判断ロジック）のテスト。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFitZoom,
  cloneStepsShallow,
  nextBadgeNumber,
  renumberBadges,
  imageFormatFromDataUrl,
  exportFormatFor,
  computeMenuPosition,
} = require('../app/editorLogic.js');

test('computeFitZoom: 領域に収まる倍率を返す（最大1.0）', () => {
  assert.equal(computeFitZoom(1000, 500, 500, 500), 0.5);
  assert.equal(computeFitZoom(1000, 500, 2000, 2000), 1.0); // 小さい画像は拡大しない
  assert.equal(computeFitZoom(1000, 1000, 400, 800), 0.4);  // 幅の制約が厳しい
});

test('computeFitZoom: 寸法が無ければ既定の最大倍率を返す', () => {
  assert.equal(computeFitZoom(0, 0, 500, 500), 1.0);
  assert.equal(computeFitZoom(1000, 500, 0, 0), 1.0);
});

test('cloneStepsShallow: ステップと注釈は新しいオブジェクト、imageDataUrl は参照共有', () => {
  const url = 'data:image/png;base64,AAAA';
  const steps = [{ id: 's1', imageDataUrl: url, annotations: [{ id: 'a1', x: 1, points: [1, 2] }] }];
  const copy = cloneStepsShallow(steps);

  assert.notEqual(copy, steps);
  assert.notEqual(copy[0], steps[0]);
  assert.equal(copy[0].imageDataUrl, url); // 文字列は不変なので同一値でよい
  assert.notEqual(copy[0].annotations, steps[0].annotations);
  assert.notEqual(copy[0].annotations[0], steps[0].annotations[0]);
  assert.notEqual(copy[0].annotations[0].points, steps[0].annotations[0].points);
  assert.deepEqual(copy[0].annotations[0].points, [1, 2]);

  // 複製後に元を書き換えても複製側に影響しない
  steps[0].annotations[0].x = 999;
  steps[0].annotations[0].points.push(3);
  assert.equal(copy[0].annotations[0].x, 1);
  assert.deepEqual(copy[0].annotations[0].points, [1, 2]);
});

test('nextBadgeNumber: 現在の最大値+1、無ければ1', () => {
  assert.equal(nextBadgeNumber([]), 1);
  assert.equal(nextBadgeNumber([{ type: 'rect' }]), 1);
  assert.equal(nextBadgeNumber([
    { type: 'badge', badgeNumber: 2 },
    { type: 'badge', badgeNumber: 5 },
    { type: 'rect' },
  ]), 6);
});

test('renumberBadges: バッジだけを現在の番号順に1から振り直す', () => {
  const anns = [
    { id: 'a', type: 'badge', badgeNumber: 5 },
    { id: 'b', type: 'rect' },
    { id: 'c', type: 'badge', badgeNumber: 2 },
  ];
  const result = renumberBadges(anns);
  assert.equal(result.find(a => a.id === 'c').badgeNumber, 1);
  assert.equal(result.find(a => a.id === 'a').badgeNumber, 2);
  assert.equal(result.find(a => a.id === 'b').type, 'rect');
  // 非破壊
  assert.equal(anns[0].badgeNumber, 5);
});

test('imageFormatFromDataUrl / exportFormatFor: JPEG は品質0.92のJPEG、それ以外はPNG', () => {
  assert.equal(imageFormatFromDataUrl('data:image/jpeg;base64,AAAA'), 'jpeg');
  assert.equal(imageFormatFromDataUrl('data:image/jpg;base64,AAAA'), 'jpeg');
  assert.equal(imageFormatFromDataUrl('data:image/png;base64,AAAA'), 'png');
  assert.equal(imageFormatFromDataUrl(''), 'png');

  assert.deepEqual(exportFormatFor('data:image/jpeg;base64,AAAA'), { mime: 'image/jpeg', quality: 0.92 });
  assert.deepEqual(exportFormatFor('data:image/png;base64,AAAA'), { mime: 'image/png', quality: undefined });
});

test('computeMenuPosition: はみ出す側だけ内側にずらす', () => {
  // 右下に十分な余裕がある場合はそのまま
  assert.deepEqual(computeMenuPosition(10, 10, 100, 50, 1000, 800), { left: 10, top: 10 });
  // 右にはみ出す
  const r = computeMenuPosition(950, 10, 100, 50, 1000, 800);
  assert.ok(r.left <= 1000 - 100 - 4);
  // 下にはみ出す
  const b = computeMenuPosition(10, 780, 100, 50, 1000, 800);
  assert.ok(b.top <= 800 - 50 - 4);
});
