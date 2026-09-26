'use strict';
// 段階1: 旧デザイントークン（--bg・--text-mid 等）が app/ に残っていないことを確かめる。
//
// なぜ置いたか: design-brief.md の配色トークンへ全面的に置き換える方針のため、旧名を
// 別名として残さない。後から書き足すコードが旧名を復活させたことに気づけるようにする。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'app');

const OLD_TOKENS = [
  'bg', 'surface2', 'border', 'border-strong', 'text', 'text-mid', 'text-light',
  'accent2', 'accent-light', 'red', 'green', 'orange', 'yellow',
  'shadow-sm', 'shadow-lg', 'sans', 'mono',
];

function listAppFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...listAppFiles(full));
    else if (/\.(js|css|html)$/.test(name)) out.push(full);
  }
  return out;
}

test('app/ に旧デザイントークン（--bg 等）を参照する var(--...) が残っていない', () => {
  const files = listAppFiles(APP_DIR);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const name of OLD_TOKENS) {
      // 新トークンの部分文字列（例: --border は --border-strong や --rule と別）と
      // 誤検出しないよう、var(--name) の完全一致だけを見る。
      const re = new RegExp(`var\\(--${name}\\)`);
      if (re.test(src)) {
        offenders.push(`${path.relative(APP_DIR, file)}: var(--${name})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `旧トークンへの参照が残っている:\n${offenders.join('\n')}`);
});
