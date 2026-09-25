'use strict';
// U10: styles.css の実際の色の組み合わせが WCAG のコントラスト比を満たすかを確かめるテスト。
//
// なぜ置いたか: --text-light 等の変数値は今後も調整され得るが、実際にその色を乗せている
// 背景（--bg・--surface・サイドバー・キャンバス背景など）との組み合わせで基準を割り込む
// 変更に気づけるよう、styles.css の値を読んで検査する（値を書き写して二重管理しない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contrastRatio } = require('../app/colorContrast');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');

// :root { --name: #xxxxxx; ... } から変数値を取り出す（最初の定義を採用）。
function cssVar(name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`);
  const m = CSS.match(re);
  assert.ok(m, `styles.css に --${name} が見つからない`);
  return m[1];
}

const bg = cssVar('bg');
const surface = cssVar('surface');
const textLight = cssVar('text-light');
const accent = cssVar('accent');
const orange = cssVar('orange');

// ホームサイドバー・キャンバス背景は変数化されていない直書きの色（styles.css を参照して転記）。
const SIDEBAR_BG = '#f2efe9';
const CANVAS_BG = '#e4e0d8';
const HOME_HEADER_BG = '#0f0c08';

test('--text-light は --bg の上で 4.5:1 以上', () => {
  assert.ok(contrastRatio(textLight, bg) >= 4.5, contrastRatio(textLight, bg));
});

test('--text-light は --surface の上で 4.5:1 以上', () => {
  assert.ok(contrastRatio(textLight, surface) >= 4.5, contrastRatio(textLight, surface));
});

test('--text-light はホームサイドバー背景の上で 4.5:1 以上', () => {
  assert.ok(contrastRatio(textLight, SIDEBAR_BG) >= 4.5, contrastRatio(textLight, SIDEBAR_BG));
});

test('--text-light はキャンバス背景の上で 4.5:1 以上', () => {
  assert.ok(contrastRatio(textLight, CANVAS_BG) >= 4.5, contrastRatio(textLight, CANVAS_BG));
});

test('ホームヘッダーの歯車ボタン色（rgba(255,255,255,.8) 相当）は黒背景の上で 3:1 以上', () => {
  // rgba(255,255,255,.8) を HOME_HEADER_BG に重ねた見かけ上の色で近似する。
  const blended = blend('#ffffff', 0.8, HOME_HEADER_BG);
  assert.ok(contrastRatio(blended, HOME_HEADER_BG) >= 3, contrastRatio(blended, HOME_HEADER_BG));
});

test('警告トースト（--orange に白文字）は 4.5:1 以上', () => {
  assert.ok(contrastRatio(orange, '#ffffff') >= 4.5, contrastRatio(orange, '#ffffff'));
});

test('「＋ フォルダを追加」（--accent、不透明）はサイドバー背景の上で 4.5:1 以上', () => {
  assert.ok(contrastRatio(accent, SIDEBAR_BG) >= 4.5, contrastRatio(accent, SIDEBAR_BG));
  // opacity を使っていないことも確かめる（U10: opacity .75 で約4.1:1 まで落ちていた）。
  const idx = CSS.indexOf('.sidebar-add-folder {');
  const end = CSS.indexOf('}', idx);
  const block = CSS.slice(idx, end);
  assert.ok(!/opacity:\s*\.?\d/.test(block), 'sidebar-add-folder に opacity が残っている');
});

function blend(fgHex, alpha, bgHex) {
  const f = hex(fgHex);
  const b = hex(bgHex);
  const r = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)));
  return '#' + r.map(x => x.toString(16).padStart(2, '0')).join('');
}
function hex(h) {
  h = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
