'use strict';
// Markdown エクスポートの画像フォルダ名（app/exportImagesDir.js）を固定するテスト。
// main.js（保存時にフォルダを作る）と renderer.js（プレビュー表示）が同じ名前を
// 計算できることが目的なので、ここでは関数の入出力だけを確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { imagesDirName } = require('../app/exportImagesDir');

test('拡張子 .md を外してから "_images" を付ける', () => {
  assert.equal(imagesDirName('手順書.md'), '手順書_images');
});

test('拡張子 .markdown も外す（大文字小文字を問わない）', () => {
  assert.equal(imagesDirName('手順書.MARKDOWN'), '手順書_images');
});

test('拡張子が無くてもそのまま使う', () => {
  assert.equal(imagesDirName('手順書'), '手順書_images');
});

test('使えない文字は無害化される（app/fileName.js と同じ規則）', () => {
  assert.equal(imagesDirName('a/b:c.md'), 'a_b_c_images');
});

test('空文字は既定の fallback（export）を使う', () => {
  assert.equal(imagesDirName(''), 'export_images');
  assert.equal(imagesDirName(undefined), 'export_images');
});

test('main.js の export-markdown ハンドラと同じ関数を使っている', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/exportImagesDir'\)/);
  assert.match(main, /imagesDirName\(path\.basename\(filePath\)\)/);
});

test('renderer.js のプレビューも同じ関数を使っている', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
  assert.match(renderer, /window\.OpesnaExportImagesDir\.imagesDirName\(/);
});
