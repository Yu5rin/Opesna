'use strict';
// U1: renderer.js / index.html / recording-indicator.html が出す class 名が、すべて
// styles.css（または recording-indicator.html 自身の <style>）に定義されているかを確かめる。
//
// なぜ置いたか: クラス名を付けたのに styles.css 側に対応する定義が無く見た目が当たらない
// （例: 以前の <button class="toggle on"> や .selected 誤記）逆に styles.css にだけ残って
// どこからも使われていない定義（削除し忘れ）の両方に、後から気づけるようにする。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'app');
const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(APP_DIR, 'renderer.js'), 'utf8');
const recHtml = fs.readFileSync(path.join(APP_DIR, 'recording-indicator.html'), 'utf8');
const css = fs.readFileSync(path.join(APP_DIR, 'styles.css'), 'utf8');

// 動的に組み立てられ、静的な grep では拾えないクラス名（許可リスト）。
// 実際の組み立て箇所は renderer.js 内のコメントを参照。
const DYNAMIC_CLASSES = new Set([
  // showToast(): 'toast ' + resolvedType + (hasAction ? ' has-action' : '') + ' show'
  'ok', 'warn', 'error', 'info', 'has-action',
  // renderHome(): file-thumb${proj.thumb ? '' : ' file-thumb-color-' + colorIdx}
  'file-thumb', 'file-thumb-color-0', 'file-thumb-color-1', 'file-thumb-color-2', 'file-thumb-color-3',
  // showContextMenu(): 'context-menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '')
  'danger', 'disabled',
  // renderVersionTabExtras(): update-status update-status-${statusClass}
  'update-status-ok', 'update-status-error', 'update-status-muted',
]);

// アプリ自身の画面ではなく、エクスポートする成果物（PDF/HTML/Markdown プレビュー）の中身として
// 組み立てる HTML の class。この HTML は自己完結のインラインスタイルで見た目を決めており、
// アプリの styles.css とは無関係（buildExportHTML 等を参照）。
const EXPORT_DOCUMENT_CLASSES = new Set(['toc', 'step']);

// querySelector 専用の JS フックで、見た目は親要素側のセレクタ（.toggle input など）や
// JS の style.display 直接操作で決まり、このクラス自体に CSS ルールは無くてよいもの。
const JS_HOOK_ONLY_CLASSES = new Set([
  'toggle-input', // .toggle input が見た目を決める。querySelectorAll('.toggle-input') の的
  'export-row-for-pdf', 'export-row-for-html', 'export-row-for-markdown', 'export-row-for-png', // [class*="export-row-for-"] で表示/非表示を直接切り替える
]);

const ALLOWED_UNDEFINED = new Set([
  ...DYNAMIC_CLASSES,
  ...EXPORT_DOCUMENT_CLASSES,
  ...JS_HOOK_ONLY_CLASSES,
]);

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractUsedClasses() {
  const used = new Set();
  const dynamic = [];

  function add(str) {
    if (!str) return;
    if (str.includes('${')) { dynamic.push(str); return; }
    str.split(/\s+/).forEach(c => c && used.add(c));
  }

  for (const src of [html, recHtml]) {
    for (const m of src.matchAll(/class="([^"]*)"/g)) add(m[1]);
  }
  for (const m of renderer.matchAll(/class="([^"]*)"/g)) add(m[1]);
  for (const m of renderer.matchAll(/class='([^']*)'/g)) add(m[1]);
  for (const m of renderer.matchAll(/\.className\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    add(m[1].slice(1, -1));
  }
  // add/remove は引数すべてがクラス名。toggle は第1引数だけがクラス名で、第2引数は
  // 真偽条件式（'fit' 等の比較値を含み得る）なので拾わない。
  for (const m of renderer.matchAll(/classList\.(?:add|remove)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      add(s[1] ?? s[2] ?? s[3]);
    }
  }
  for (const m of renderer.matchAll(/classList\.toggle\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    add(m[1].slice(1, -1));
  }
  return used;
}

function extractDefinedClasses() {
  const defined = new Set();
  const cleanCss = stripComments(css);
  const blockRe = /([^{}]+)\{[^{}]*\}/g;
  let m;
  while ((m = blockRe.exec(cleanCss))) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    for (const cm of sel.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) defined.add(cm[1]);
  }
  const recRe = /([^{}]+)\{[^{}]*\}/g;
  while ((m = recRe.exec(recHtml))) {
    for (const cm of m[1].matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) defined.add(cm[1]);
  }
  return defined;
}

test('renderer.js / index.html / recording-indicator.html のクラスはすべて styles.css に定義されている', () => {
  const used = extractUsedClasses();
  const defined = extractDefinedClasses();
  const missing = [...used].filter(c => !defined.has(c) && !ALLOWED_UNDEFINED.has(c));
  assert.deepEqual(missing, [], `styles.css に定義の無いクラス: ${missing.join(', ')}`);
});

test('許可リストのクラス名は実際に使われている（掃除し忘れの検出）', () => {
  const used = extractUsedClasses();
  const unusedAllowed = [...ALLOWED_UNDEFINED].filter(c => !used.has(c) && !DYNAMIC_CLASSES.has(c));
  assert.deepEqual(unusedAllowed, [], `許可リストに残っているが使われていないクラス: ${unusedAllowed.join(', ')}`);
});
