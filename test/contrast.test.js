'use strict';
// 段階1: app/theme.css の配色トークンが WCAG のコントラスト比を満たすかを確かめるテスト。
//
// なぜ置いたか: トークンの値は今後も調整され得るが、実際に組み合わせて使う場所
// （本文/地、補助文字/地、アクセント文字/アクセント面、主ボタンの文字/塗り、トーストの
// 文字/地 など）で基準を割り込む変更に気づけるよう、theme.css の値を読んで検査する
// （値を書き写して二重管理しない）。ライト・ダーク両方を検査する。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contrastRatio } = require('../app/colorContrast');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'theme.css'), 'utf8');

// :root { ... } と @media (prefers-color-scheme: dark) { :root { ... } } の
// それぞれから同じ名前の変数値を取り出す。
function extractBlock(css, re) {
  const m = re.exec(css);
  assert.ok(m, '対象のブロックが theme.css に見つからない');
  return m[0];
}
const LIGHT_BLOCK = extractBlock(CSS, /:root\s*\{[\s\S]*?\n\}/);
const DARK_BLOCK = extractBlock(CSS, /@media \(prefers-color-scheme: dark\)[\s\S]*?:root\s*\{[\s\S]*?\n\s*\}/);

function cssVar(block, name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`);
  const m = block.match(re);
  assert.ok(m, `theme.css に --${name} が見つからない`);
  return m[1];
}

function tokens(block) {
  return {
    paper: cssVar(block, 'paper'),
    surface: cssVar(block, 'surface'),
    ink: cssVar(block, 'ink'),
    inkMute: cssVar(block, 'ink-mute'),
    chromeBg: cssVar(block, 'chrome-bg'),
    chromeFg: cssVar(block, 'chrome-fg'),
    accentSoft: cssVar(block, 'accent-soft'),
    accentInk: cssVar(block, 'accent-ink'),
    onAccent: cssVar(block, 'on-accent'),
    danger: cssVar(block, 'danger'),
    surfaceForToast: cssVar(block, 'surface'),
    ok: cssVar(block, 'ok'),
    warn: cssVar(block, 'warn'),
  };
}

for (const [themeName, block] of [['ライト', LIGHT_BLOCK], ['ダーク', DARK_BLOCK]]) {
  const t = tokens(block);

  test(`[${themeName}] --ink は --paper の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.ink, t.paper) >= 4.5, contrastRatio(t.ink, t.paper));
  });

  test(`[${themeName}] --ink は --surface の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.ink, t.surface) >= 4.5, contrastRatio(t.ink, t.surface));
  });

  test(`[${themeName}] --ink-mute は --paper の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.inkMute, t.paper) >= 4.5, contrastRatio(t.inkMute, t.paper));
  });

  test(`[${themeName}] --ink-mute は --surface の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.inkMute, t.surface) >= 4.5, contrastRatio(t.inkMute, t.surface));
  });

  // --ink-mute は --chrome-bg の上では地の文字としては使わず（--chrome-fg を使う）、
  // 小さなアイコン・線としてだけ乗る想定のため、design-brief.md の「UI 部品の線・
  // アイコンだけなら 3:1 以上」の基準で見る。
  test(`[${themeName}] --ink-mute は --chrome-bg の上で 3:1 以上（アイコン・線として）`, () => {
    assert.ok(contrastRatio(t.inkMute, t.chromeBg) >= 3, contrastRatio(t.inkMute, t.chromeBg));
  });

  test(`[${themeName}] --chrome-fg は --chrome-bg の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.chromeFg, t.chromeBg) >= 4.5, contrastRatio(t.chromeFg, t.chromeBg));
  });

  test(`[${themeName}] --accent-ink は --accent-soft の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.accentInk, t.accentSoft) >= 4.5, contrastRatio(t.accentInk, t.accentSoft));
  });

  test(`[${themeName}] --on-accent は --accent-ink（主ボタンの塗り）の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.onAccent, t.accentInk) >= 4.5, contrastRatio(t.onAccent, t.accentInk));
  });

  test(`[${themeName}] --danger は --surface の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.danger, t.surface) >= 4.5, contrastRatio(t.danger, t.surface));
  });

  test(`[${themeName}] トースト（ok・warn・error）: 文字（--on-accent）が地の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.onAccent, t.ok) >= 4.5, `ok: ${contrastRatio(t.onAccent, t.ok)}`);
    assert.ok(contrastRatio(t.onAccent, t.warn) >= 4.5, `warn: ${contrastRatio(t.onAccent, t.warn)}`);
    assert.ok(contrastRatio(t.onAccent, t.danger) >= 4.5, `error: ${contrastRatio(t.onAccent, t.danger)}`);
  });

  test(`[${themeName}] トースト（info）: 文字（--paper）が地（--ink）の上で 4.5:1 以上`, () => {
    assert.ok(contrastRatio(t.paper, t.ink) >= 4.5, contrastRatio(t.paper, t.ink));
  });
}
