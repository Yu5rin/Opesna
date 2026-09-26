'use strict';
// styles.css / recording-indicator.html の <style> で、閉じ括弧の欠落を検出するテスト。
//
// なぜ置いたか: 以前 styles.css の .input-dialog-field:focus に閉じ括弧が1つ抜けており、
// その後ろにある .pref-select（環境設定「キャプチャ」タブのセレクトの大きさを決める
// ルール）がCSSパーサに丸ごと読み飛ばされ、appearance:none だけが効いて小さく潰れて
// 見える不具合になっていた（見つかりにくく、見た目を画面写真で確かめて初めて気づけた）。
// 同じ種類の欠落が再発しても気づけるよう、コメント・文字列を除いた { と } の対応を
// 機械的に確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** CSS コメントと、' " で囲まれた文字列リテラルを取り除く。 */
function stripCommentsAndStrings(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const two = css.slice(i, i + 2);
    if (two === '/*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < css.length && css[i] !== quote) {
        if (css[i] === '\\') i++; // エスケープの次の1文字は読み飛ばす
        i++;
      }
      i++; // 閉じ引用符
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * { と } の対応を確かめる。深さが途中で負になる（余分な閉じ括弧がある）ことも、
 * 最後に0へ戻らない（閉じ忘れがある）ことも失敗として検出する。
 */
function assertBalanced(css, label) {
  const stripped = stripCommentsAndStrings(css);
  let depth = 0;
  let line = 1;
  for (const ch of stripped) {
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      assert.ok(depth >= 0, `${label}: ${line}行目付近で閉じ括弧が多すぎる（対応する開き括弧が無い）`);
    }
  }
  assert.equal(depth, 0, `${label}: 閉じ括弧が${depth}個足りない（どこかのルールが閉じられていない）`);
}

test('app/styles.css: { と } の数が一致し、途中で深さが負にならない', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'styles.css'), 'utf8');
  assertBalanced(css, 'app/styles.css');
});

test('app/theme.css: { と } の数が一致し、途中で深さが負にならない', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'theme.css'), 'utf8');
  assertBalanced(css, 'app/theme.css');
});

test('app/recording-indicator.html の <style>: { と } の数が一致し、途中で深さが負にならない', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'recording-indicator.html'), 'utf8');
  const start = html.indexOf('<style>');
  const end = html.indexOf('</style>');
  assert.ok(start >= 0 && end > start, '<style> ブロックが見つからない');
  const css = html.slice(start + '<style>'.length, end);
  assertBalanced(css, 'app/recording-indicator.html の <style>');
});
