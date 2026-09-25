'use strict';
// Electron の防御設定（S3）と、開発者向けの表示を隠す設定（S6）を固定するテスト。
// ソースを読んで確かめる形（Electron を起動しない）。実際の起動確認は wp6.md の手順で別途行う。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', 'app');
const read = name => fs.readFileSync(path.join(APP_DIR, name), 'utf8');

test('index.html の CSP は script-src・object-src・base-uri・form-action を絞っている', () => {
  const html = read('index.html');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'CSP の meta タグが見つからない');
  const csp = m[1];
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-src 'self' data: blob:/); // エクスポートプレビューの iframe（srcdoc）用
});

test('index.html に inline の <script> や on〜属性が残っていない（script-src を締めたため）', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/);
  assert.doesNotMatch(html, /\son[a-z]+="/i);
});

test('recording-indicator.html の CSP も script-src \'self\' で、inline script を持たない', () => {
  const html = read('recording-indicator.html');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m);
  assert.match(m[1], /script-src 'self'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/);
  assert.match(html, /<script src="recording-indicator\.js"><\/script>/);
});

test('main.js: すべての BrowserWindow で setWindowOpenHandler と will-navigate のガードを設定している', () => {
  const main = read('main.js');
  assert.match(main, /function hardenWindow/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  // mainWindow・PDF 出力用の隠しウィンドウ・記録インジケーターの3つ
  const windowOpens = main.match(/new BrowserWindow\(/g) || [];
  const hardenCalls = (main.match(/hardenWindow\(/g) || []).length
    + (main.match(/win\.webContents\.on\('will-navigate'/g) || []).length;
  assert.equal(windowOpens.length, 3, 'BrowserWindow の生成箇所が想定と違う（変えたら本テストも見直す）');
  assert.ok(hardenCalls >= 3, 'will-navigate のガードが足りていない可能性がある');
});

test('main.js: preload.js が contextBridge と ipcRenderer しか使っていないので、全ウィンドウで sandbox: true にしている', () => {
  const preload = read('preload.js');
  assert.doesNotMatch(preload, /require\(['"](?!electron)/, 'preload.js が electron 以外を require している場合、sandbox は true にできない');
  const main = read('main.js');
  assert.doesNotMatch(main, /sandbox:\s*false/, 'sandbox: false が残っている（preload.js は sandbox 対応済み）');
});

test('main.js: パッケージ版では「開発者ツール」メニューを出さない', () => {
  const main = read('main.js');
  assert.match(main, /app\.isPackaged \? \[\] : \[/);
  assert.match(main, /toggleDevTools/);
});

test('main.js: 予期しない例外は app/logger.js 経由で ROOT/logs/error.log に記録する', () => {
  const main = read('main.js');
  assert.match(main, /createLogger\(ROOT, 'error\.log'\)/);
  assert.doesNotMatch(main, /appendFileSync\(path\.join\(ROOT, 'error\.log'\)/, '直書きの appendFileSync が残っている');
});

test('app/logger.js: createLogger はログファイル名を差し替えられる（error.log と update.log の両方に使うため）', () => {
  const logger = read('logger.js');
  assert.match(logger, /function createLogger\(root, fileName\s*=\s*'update\.log'\)/);
});
