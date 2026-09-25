'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeMarkdown } = require('../app/markdownEscape');

test('escapeMarkdown: HTML特殊文字は実体参照になる', () => {
  assert.equal(escapeMarkdown('<b>太字</b> & "引用"'), '&lt;b&gt;太字&lt;/b&gt; &amp; "引用"');
});

test('escapeMarkdown: 見出し記号(#)はバックスラッシュでエスケープされる', () => {
  assert.equal(escapeMarkdown('# 見出しのつもり'), '\\# 見出しのつもり');
});

test('escapeMarkdown: リンク・強調に使う記号もエスケープされる', () => {
  assert.equal(escapeMarkdown('[リンク](http://example.com)'), '\\[リンク\\]\\(http://example.com\\)');
  assert.equal(escapeMarkdown('*強調* _斜体_ `コード`'), '\\*強調\\* \\_斜体\\_ \\`コード\\`');
});

test('escapeMarkdown: 通常の日本語テキストはそのまま', () => {
  assert.equal(escapeMarkdown('ボタンをクリックします'), 'ボタンをクリックします');
});

test('escapeMarkdown: null/undefined は空文字を返す', () => {
  assert.equal(escapeMarkdown(null), '');
  assert.equal(escapeMarkdown(undefined), '');
});
