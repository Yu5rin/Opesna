'use strict';
// ショートカットの既定値と表記の処理（app/shortcuts.js）を固定するテスト。
// 以前は main.js と renderer.js が別々の既定値を持ち、食い違っていた。経緯は app/shortcuts.js の冒頭。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SHORTCUTS,
  withDefaults,
  comboFromKeyEvent,
  toAccelerator,
  labelWithShortcut,
} = require('../app/shortcuts');

const APP_DIR = path.join(__dirname, '..', 'app');
const read = name => fs.readFileSync(path.join(APP_DIR, name), 'utf8');

// 表記（'Ctrl+Shift+Z' など）から、そのキーを押したときの keydown に相当するものを作る
function keyEventFor(combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  return {
    ctrlKey:  parts.includes('Ctrl'),
    metaKey:  parts.includes('Meta'),
    altKey:   parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    // 英字は Shift なしなら小文字で届く
    key: key.length === 1 && !parts.includes('Shift') ? key.toLowerCase() : key,
  };
}

test('やり直しの既定値は Ctrl+Shift+Z（renderer.js の Ctrl+Y は起動時には使われておらず、押しても効かなかった）', () => {
  assert.equal(DEFAULT_SHORTCUTS.redo, 'Ctrl+Shift+Z');
});

test('キャプチャの既定値は Ctrl+Shift+S（起動時に実際に効き、設定画面にも出ていた main.js の値）', () => {
  assert.equal(DEFAULT_SHORTCUTS.capture, 'Ctrl+Shift+S');
});

test('既定値はどれも、押したときに作られる表記と一致する（Ctrl+Equal のように一致せず黙って効かない値を置かない）', () => {
  for (const [name, combo] of Object.entries(DEFAULT_SHORTCUTS)) {
    assert.equal(comboFromKeyEvent(keyEventFor(combo)), combo, `${name}: ${combo}`);
  }
});

test('既定値は書き換えられない（「デフォルトに戻す」はコピーを渡す）', () => {
  assert.ok(Object.isFrozen(DEFAULT_SHORTCUTS));
});

test('既定値どうしで同じキーを2つの操作に割り当てていない', () => {
  const seen = new Map();
  for (const [name, combo] of Object.entries(DEFAULT_SHORTCUTS)) {
    assert.ok(!seen.has(combo), `${combo} が ${seen.get(combo)} と ${name} で重なっている`);
    seen.set(combo, name);
  }
});

test('comboFromKeyEvent: 修飾キーは Ctrl → Meta → Alt → Shift の順で、英字は大文字にする', () => {
  assert.equal(comboFromKeyEvent({ ctrlKey: true, shiftKey: true, key: 'Z' }), 'Ctrl+Shift+Z');
  assert.equal(comboFromKeyEvent({ ctrlKey: true, key: 'y' }), 'Ctrl+Y');
  assert.equal(comboFromKeyEvent({ ctrlKey: true, altKey: true, metaKey: true, key: 'k' }), 'Ctrl+Meta+Alt+K');
  assert.equal(comboFromKeyEvent({ ctrlKey: true, key: 'Enter' }), 'Ctrl+Enter');
  assert.equal(comboFromKeyEvent({ key: 'Delete' }), 'Delete');
  // 修飾キーだけのときはキーを足さない
  assert.equal(comboFromKeyEvent({ ctrlKey: true, key: 'Control' }), 'Ctrl');
});

test('withDefaults: 保存された割り当てを優先し、足りない・空の値は既定値で補う', () => {
  const merged = withDefaults({ redo: 'Ctrl+Y', capture: '', undo: null });
  assert.equal(merged.redo, 'Ctrl+Y');
  assert.equal(merged.capture, DEFAULT_SHORTCUTS.capture);
  assert.equal(merged.undo, DEFAULT_SHORTCUTS.undo);
  assert.equal(merged.save, DEFAULT_SHORTCUTS.save);
});

test('withDefaults: 既定値に無いキーも捨てない・既定値の並び順を保つ', () => {
  const merged = withDefaults({ myAction: 'Ctrl+K', zoomReset: 'Ctrl+9' });
  assert.equal(merged.myAction, 'Ctrl+K');
  assert.deepEqual(Object.keys(merged).slice(0, Object.keys(DEFAULT_SHORTCUTS).length), Object.keys(DEFAULT_SHORTCUTS));
});

test('withDefaults: 読めなかった設定（null や undefined）でも既定値を返し、既定値そのものは変えない', () => {
  assert.deepEqual(withDefaults(null), { ...DEFAULT_SHORTCUTS });
  assert.deepEqual(withDefaults(undefined), { ...DEFAULT_SHORTCUTS });
  assert.notEqual(withDefaults({}), DEFAULT_SHORTCUTS);
});

test('toAccelerator: Ctrl を CmdOrCtrl にしてメニューのアクセラレータにする', () => {
  assert.equal(toAccelerator('Ctrl+Shift+Z'), 'CmdOrCtrl+Shift+Z');
  assert.equal(toAccelerator('Ctrl+='), 'CmdOrCtrl+=');
  assert.equal(toAccelerator('Ctrl+-'), 'CmdOrCtrl+-');
  assert.equal(toAccelerator('Delete'), 'Delete');
});

test('labelWithShortcut: ツールチップに割り当てを添える', () => {
  assert.equal(labelWithShortcut('やり直し', 'Ctrl+Shift+Z'), 'やり直し (Ctrl+Shift+Z)');
  assert.equal(labelWithShortcut('やり直し', ''), 'やり直し');
});

// 既定値が再び2か所以上に書かれないよう、ソースを見て確かめる
test('main.js と renderer.js は既定値を自分で持たず app/shortcuts.js を参照する', () => {
  const main = read('main.js');
  const renderer = read('renderer.js');
  assert.match(main, /require\('\.\/shortcuts'\)/);
  assert.match(renderer, /window\.OpesnaShortcuts/);
  for (const [name, src] of [['main.js', main], ['renderer.js', renderer]]) {
    assert.doesNotMatch(src, /DEFAULT_SHORTCUTS\s*=\s*\{/, `${name} に既定値の表が残っている`);
  }
});

test('index.html は renderer.js より先に shortcuts.js を読み込む', () => {
  const html = read('index.html');
  const a = html.indexOf('<script src="shortcuts.js">');
  const b = html.indexOf('<script src="renderer.js">');
  assert.ok(a >= 0 && b > a);
});

test('index.html のツールチップに書かれたキーが既定値と一致する（「やり直し (Ctrl+Y)」と食い違っていた）', () => {
  const html = read('index.html');
  const titles = {
    'btn-undo': DEFAULT_SHORTCUTS.undo,
    'btn-redo': DEFAULT_SHORTCUTS.redo,
    'btn-editor-save': DEFAULT_SHORTCUTS.save,
  };
  for (const [id, combo] of Object.entries(titles)) {
    const m = html.match(new RegExp(`id="${id}"[^>]*title="[^"(]*\\(([^)]*)\\)"`));
    assert.ok(m, `${id} の title が見つからない`);
    assert.equal(m[1], combo, id);
  }
});

test('config/shortcuts.json（開発時に読まれる設定）が既定値と一致する', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'shortcuts.json'), 'utf8'));
  assert.deepEqual(cfg, { ...DEFAULT_SHORTCUTS });
});
