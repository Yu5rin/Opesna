'use strict';
// ファイル名の無害化（app/fileName.js）を固定するテスト。
// Windows では末尾のドット・空白、予約デバイス名（CON など）を含む名前で保存に失敗するため、
// それぞれの規則を個別に確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeFileName, ensureExt } = require('../app/fileName');

test('使えない文字を _ に置き換える', () => {
  assert.equal(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('制御文字を _ に置き換える', () => {
  assert.equal(sanitizeFileName('a\u0000b\u001fc'), 'a_b_c');
});

test('前後の空白を除く', () => {
  assert.equal(sanitizeFileName('  タイトル  '), 'タイトル');
});

test('末尾のドット・空白を除く（Windows が黙って落とすため）', () => {
  assert.equal(sanitizeFileName('タイトル. . '), 'タイトル');
  assert.equal(sanitizeFileName('タイトル...'), 'タイトル');
});

test('予約デバイス名は先頭に _ を付ける（大文字小文字を問わない）', () => {
  assert.equal(sanitizeFileName('CON'), '_CON');
  assert.equal(sanitizeFileName('con'), '_con');
  assert.equal(sanitizeFileName('Nul'), '_Nul');
  assert.equal(sanitizeFileName('COM1'), '_COM1');
  assert.equal(sanitizeFileName('lpt9'), '_lpt9');
});

test('予約デバイス名は拡張子付きでも対象になる', () => {
  assert.equal(sanitizeFileName('CON.txt'), '_CON.txt');
});

test('予約デバイス名に似ているが違う名前はそのまま', () => {
  assert.equal(sanitizeFileName('CONFIG'), 'CONFIG');
  assert.equal(sanitizeFileName('COM10'), 'COM10');
});

test('結果が空になるなら既定の fallback「無題」を返す', () => {
  assert.equal(sanitizeFileName(''), '無題');
  assert.equal(sanitizeFileName('   '), '無題');
  assert.equal(sanitizeFileName('...'), '無題');
});

test('結果が "." や ".." になるなら fallback を返す', () => {
  assert.equal(sanitizeFileName('.'), '無題');
  assert.equal(sanitizeFileName('..'), '無題');
  assert.equal(sanitizeFileName('...'), '無題');
});

test('fallback を指定できる（fallback 自体も同じ規則を通す）', () => {
  assert.equal(sanitizeFileName('', 'CON'), '_CON');
  assert.equal(sanitizeFileName('', '既定名'), '既定名');
});

test('120 コードポイントを超える部分は切り詰める', () => {
  const long = 'あ'.repeat(200);
  const result = sanitizeFileName(long);
  assert.equal(Array.from(result).length, 120);
  assert.equal(result, 'あ'.repeat(120));
});

test('絵文字（サロゲートペア）を途中で割らない', () => {
  // 😀 は UTF-16 で2コードユニットのサロゲートペア。119文字+😀 で120コードポイントちょうどにする。
  const long = 'あ'.repeat(119) + '😀' + 'い'.repeat(10);
  const result = sanitizeFileName(long);
  assert.equal(Array.from(result).length, 120);
  // サロゲートペアが途中で切れていれば不正な文字列になるが、Array.from の結果と一致するはず
  assert.equal(result, Array.from(long).slice(0, 120).join(''));
  assert.ok(result.includes('😀'));
});

test('切り詰めた結果の末尾がドット・空白ならさらに除く', () => {
  const long = 'あ'.repeat(119) + '. ';
  const result = sanitizeFileName(long);
  assert.ok(!/[.\s]$/.test(result));
});

test('ensureExt: 拡張子が無ければ付ける', () => {
  assert.equal(ensureExt('タイトル', 'pdf'), 'タイトル.pdf');
});

test('ensureExt: 拡張子が既にあれば重複させない（大文字小文字を問わない）', () => {
  assert.equal(ensureExt('タイトル.pdf', 'pdf'), 'タイトル.pdf');
  assert.equal(ensureExt('タイトル.PDF', 'pdf'), 'タイトル.PDF');
  assert.equal(ensureExt('タイトル.Pdf', 'PDF'), 'タイトル.Pdf');
});

test('ensureExt: 無害化も行う', () => {
  assert.equal(ensureExt('a/b:c', 'pdf'), 'a_b_c.pdf');
});

test('ensureExt: 空文字は既定の fallback（export）を使う', () => {
  assert.equal(ensureExt('', 'pdf'), 'export.pdf');
  assert.equal(ensureExt(null, 'pdf'), 'export.pdf');
});
