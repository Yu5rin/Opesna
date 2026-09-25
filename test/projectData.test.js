'use strict';
// .opn プロジェクトの読み込み時の検証・正規化（app/projectData.js）を確かめるテスト。
//
// なぜ置いたか: 以前の openProject / openProjectByPath は検証前に state.project を置き換え、
// 壊れた .opn を開くと途中の annotations.forEach で例外が出てエディタが壊れた状態のまま残った（F17）。
// また imageDataUrl の中身を確かめずに <img src> へそのまま渡しており、細工した .opn を開くと
// data: URL 経由でスクリプトが動く余地があった（S1）。normalizeProject はこれをまとめて防ぐ。

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeProject } = require('../app/projectData');

test('オブジェクトでない data は null（呼び出し側は state を変えずに「開けない」エラーにできる）', () => {
  assert.equal(normalizeProject(null), null);
  assert.equal(normalizeProject(undefined), null);
  assert.equal(normalizeProject('broken'), null);
  assert.equal(normalizeProject(42), null);
  assert.equal(normalizeProject([1, 2, 3]), null);
});

test('steps が配列でなければ空配列扱いにし、最低1ステップは持たせる', () => {
  const p = normalizeProject({ name: 'テスト', steps: 'not-an-array' });
  assert.ok(Array.isArray(p.steps));
  assert.equal(p.steps.length, 1);
});

test('壊れたステップ（annotations.forEach で落ちるような形）でも例外を投げず正規化する', () => {
  const p = normalizeProject({
    name: 'テスト',
    steps: [
      { title: '正常', annotations: [] },
      { title: '壊れている', annotations: 'not-an-array' }, // 以前は forEach で例外
      null,
      'string-step',
    ],
  });
  assert.equal(p.steps.length, 4);
  p.steps.forEach((step) => {
    assert.ok(Array.isArray(step.annotations));
    assert.equal(typeof step.id, 'string');
    assert.ok(step.id.length > 0);
  });
});

test('既知の種類でない注釈は捨てる（未知の type をそのまま残さない）', () => {
  const p = normalizeProject({
    steps: [{
      annotations: [
        { type: 'rect', x: 1, y: 2, x2: 3, y2: 4 },
        { type: 'script-injection', x: 1 },
        { type: 'onload=alert(1)' },
        123,
        null,
      ],
    }],
  });
  assert.equal(p.steps[0].annotations.length, 1);
  assert.equal(p.steps[0].annotations[0].type, 'rect');
});

test('注釈の数値項目が有限数でなければ 0 にする（NaN / Infinity / 文字列混入対策）', () => {
  const p = normalizeProject({
    steps: [{
      annotations: [
        { type: 'rect', x: NaN, y: Infinity, x2: -Infinity, y2: 5, strokeWidth: 'thick' },
      ],
    }],
  });
  const ann = p.steps[0].annotations[0];
  assert.equal(ann.x, 0);
  assert.equal(ann.y, 0);
  assert.equal(ann.x2, 0);
  assert.equal(ann.y2, 5);
  assert.equal(ann.strokeWidth, 'thick'); // 数値でない値はそのまま通す（型が違うだけなら別項目の責務）
});

test('imageDataUrl は許可した画像形式の data: URL のみ残し、それ以外は null にする（S1）', () => {
  const okPng = normalizeProject({
    steps: [{ imageDataUrl: 'data:image/png;base64,aGVsbG8=' }],
  });
  assert.equal(okPng.steps[0].imageDataUrl, 'data:image/png;base64,aGVsbG8=');

  const scriptAttempt = normalizeProject({
    steps: [{ imageDataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }],
  });
  assert.equal(scriptAttempt.steps[0].imageDataUrl, null);

  const svgAttempt = normalizeProject({
    // SVG は data: URL 内にスクリプトを埋め込めるため許可リストに含めない
    steps: [{ imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }],
  });
  assert.equal(svgAttempt.steps[0].imageDataUrl, null);

  const garbage = normalizeProject({
    steps: [{ imageDataUrl: 'javascript:alert(1)' }],
  });
  assert.equal(garbage.steps[0].imageDataUrl, null);
});

test('title は文字列にし、2000文字を超える分は切り詰める', () => {
  const p = normalizeProject({ steps: [{ title: 123 }] });
  assert.equal(typeof p.steps[0].title, 'string');

  const longTitle = 'あ'.repeat(3000);
  const p2 = normalizeProject({ steps: [{ title: longTitle }] });
  assert.equal(Array.from(p2.steps[0].title).length, 2000);
});

test('name が無ければファイル名から作る。category は sanitizeFileName を通し、無ければ null', () => {
  const p = normalizeProject({ steps: [] }, { fileName: '手順書.opn' });
  assert.equal(p.name, '手順書');

  const p2 = normalizeProject({ name: 'テスト', category: 'フォルダ/../etc' });
  assert.equal(typeof p2.category, 'string');
  assert.ok(!p2.category.includes('/'));

  const p3 = normalizeProject({ name: 'テスト' });
  assert.equal(p3.category, null);
});

test('色の値は #RGB〜#RRGGBBAA 形式でなければ既定色にする', () => {
  const p = normalizeProject({
    steps: [{
      annotations: [
        { type: 'rect', color: 'red' },
        { type: 'badge', badgeColor: 'javascript:alert(1)' },
        { type: 'rect', color: '#abc' },
      ],
    }],
  });
  assert.equal(p.steps[0].annotations[0].color, '#c0392b');
  assert.equal(p.steps[0].annotations[1].badgeColor, '#1f4e8c');
  assert.equal(p.steps[0].annotations[2].color, '#abc');
});

test('id が無いプロジェクト・ステップには生成した id を付ける', () => {
  const p = normalizeProject({ steps: [{}] });
  assert.equal(typeof p.id, 'string');
  assert.ok(p.id.length > 0);
  assert.equal(typeof p.steps[0].id, 'string');
  assert.ok(p.steps[0].id.length > 0);
});

test('既にある id は保たれる（保存のたびに変わらない）', () => {
  const p = normalizeProject({ id: 'keep-me', steps: [{ id: 'step-keep' }] });
  assert.equal(p.id, 'keep-me');
  assert.equal(p.steps[0].id, 'step-keep');
});
