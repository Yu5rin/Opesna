'use strict';
// 段階1: app/ の HTML・JS の利用者に見える文字列に絵文字が無いことを確かめる。
//
// なぜ置いたか: design-brief.md「絵文字を使わない」の方針。アイコン・記号はすべて
// SVG（線幅1.75、16px）に置き換える。Unicode の Extended_Pictographic を検査するが、
// コメント行と、絵文字ではない記号的な文字（©・矢印など）は除く。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'app');
const TARGET_FILES = ['index.html', 'renderer.js', 'recording-indicator.html', 'recording-indicator.js', 'main.js'];

// Extended_Pictographic ではあるが絵文字としては使っていない記号（著作権表示・矢印・
// キーボードの記号など）。用語集・ショートカット表記等で使うため許可する。
const ALLOWED = new Set([
  '©', // © 著作権表示
  '®', // ® 商標
  '™', // ™ 商標
  '←', '↑', '→', '↓', // ← ↑ → ↓
  '↔', '↕', '↖', '↗', '↘', '↙', // ↔ ↕ ↖ ↗ ↘ ↙
  '↩', '↪', // ↩ ↪（元に戻す・やり直し）
  '▶', // ▶（塗りつぶしの矢印頭など、記号としての三角）
]);

const PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/gu;

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--');
}

for (const name of TARGET_FILES) {
  const file = path.join(APP_DIR, name);
  if (!fs.existsSync(file)) continue;
  test(`app/${name} の利用者に見える文字列に絵文字が無い`, () => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const offenders = [];
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      const matches = line.match(PICTOGRAPHIC_RE);
      if (!matches) return;
      const real = matches.filter(ch => !ALLOWED.has(ch));
      if (real.length) offenders.push(`${i + 1}行目: ${JSON.stringify(real)} ${line.trim().slice(0, 80)}`);
    });
    assert.deepEqual(offenders, [], `絵文字が残っている:\n${offenders.join('\n')}`);
  });
}
