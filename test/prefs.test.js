'use strict';
// 環境設定の画面に出す項目が、アプリのどこかで実際に読まれているかを確かめるテスト。
//
// なぜ置いたか: 「保存」タブの「自動バックアップ」は、切り替えて保存しても何も起きなかった。
// settings.backup を読む処理がどこにも無く、項目（renderer.js の PREFS_CONFIG）だけがあった。
// いつ・何を・何世代残すかの定めも無かったため、実装せずに項目を外した。
// 同じように「効かない項目」を増やさないよう、項目ごとに読む処理があるかを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'app');
const sources = ['main.js', 'renderer.js', 'preload.js']
  .map(name => fs.readFileSync(path.join(APP_DIR, name), 'utf8'));
const renderer = sources[1];
const main = sources[0];

// renderer.js の PREFS_CONFIG に並んだ項目の key を取り出す
function prefsKeys() {
  const start = renderer.indexOf('const PREFS_CONFIG = {');
  assert.ok(start >= 0, 'renderer.js に PREFS_CONFIG が見つからない');
  const end = renderer.indexOf('\n};', start);
  const block = renderer.slice(start, end);
  return [...new Set([...block.matchAll(/key:\s*'(\w+)'/g)].map(m => m[1]))];
}

// settings.<key> の形で読んでいるか（設定画面そのものの settings[item.key] は数えない）
function isConsumed(key) {
  const re = new RegExp(`settings\\.${key}\\b`);
  return sources.some(src => re.test(src));
}

// 項目はあるが、まだ読む処理が無いもの（2026-09 の時点）。自動バックアップと同じく、
// 切り替えても何も起きない。実装したらここから外す（外し忘れは下のテストが知らせる）。
// captureDelay はキャプチャモーダルの遅延の初期値として読むようになったため外した。
// cursor（カーソルを含める）は実現できないため項目ごと外した（PREFS_CONFIG参照）。
const KNOWN_UNIMPLEMENTED = ['language', 'theme', 'defaultZoom'];

test('「自動バックアップ」の項目を設定画面に出さない（読む処理が無く、切り替えても何も起きなかった）', () => {
  assert.ok(!prefsKeys().includes('backup'));
});

test('「自動バックアップ」を既定の設定にも持たない', () => {
  const start = main.indexOf('const DEFAULT_SETTINGS = {');
  const block = main.slice(start, main.indexOf('\n};', start));
  assert.doesNotMatch(block, /^\s*backup\s*:/m);
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf8'));
  assert.ok(!('backup' in cfg));
});

test('設定画面の項目は、既知の未対応を除いてどれもアプリのどこかで読まれている', () => {
  const unconsumed = prefsKeys().filter(k => !isConsumed(k) && !KNOWN_UNIMPLEMENTED.includes(k));
  assert.deepEqual(unconsumed, [], `読む処理の無い項目: ${unconsumed.join(', ')}`);
});

test('既知の未対応の一覧が古くなっていない（実装したら KNOWN_UNIMPLEMENTED から外す）', () => {
  const nowConsumed = KNOWN_UNIMPLEMENTED.filter(isConsumed);
  assert.deepEqual(nowConsumed, []);
});
