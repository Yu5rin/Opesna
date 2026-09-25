'use strict';
// フォルダ・プロジェクトの管理（app/projectFolderLogic.js）の判断ロジックを固定するテスト。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateFolderName,
  collisionSafeName,
  replacePathPrefix,
} = require('../app/projectFolderLogic');

test('フォルダ名: 空文字は拒否する', () => {
  assert.deepEqual(validateFolderName(''), { ok: false });
  assert.deepEqual(validateFolderName('   '), { ok: false });
});

test('フォルダ名: "." ".." は拒否する', () => {
  assert.deepEqual(validateFolderName('.'), { ok: false });
  assert.deepEqual(validateFolderName('..'), { ok: false });
});

test('フォルダ名: 前後の空白は除いて使う', () => {
  assert.deepEqual(validateFolderName('  資料  '), { ok: true, name: '資料' });
});

test('フォルダ名: 使えない文字は無害化して使う', () => {
  assert.deepEqual(validateFolderName('資料/2024'), { ok: true, name: '資料_2024' });
});

test('フォルダ名: 予約デバイス名は安全な名前に置き換える', () => {
  const result = validateFolderName('CON');
  assert.equal(result.ok, true);
  assert.notEqual(result.name, 'CON');
});

test('衝突回避の名前づけ: 重ならなければそのまま', () => {
  assert.equal(collisionSafeName('手順書.opn', ['他.opn']), '手順書.opn');
});

test('衝突回避の名前づけ: 重なれば (2) を付ける', () => {
  assert.equal(collisionSafeName('手順書.opn', ['手順書.opn']), '手順書 (2).opn');
});

test('衝突回避の名前づけ: (2) も重なっていれば (3) にする', () => {
  assert.equal(
    collisionSafeName('手順書.opn', ['手順書.opn', '手順書 (2).opn']),
    '手順書 (3).opn'
  );
});

test('衝突回避の名前づけ: 拡張子の無い名前でも動く', () => {
  assert.equal(collisionSafeName('資料', ['資料']), '資料 (2)');
});

test('パスの付け替え: 対象パス自身を置き換える', () => {
  assert.equal(
    replacePathPrefix('C:\\data\\projects\\仕事', 'C:\\data\\projects\\仕事', 'C:\\data\\projects\\業務'),
    'C:\\data\\projects\\業務'
  );
});

test('パスの付け替え: 配下のパスを置き換える', () => {
  assert.equal(
    replacePathPrefix(
      'C:\\data\\projects\\仕事\\手順書.opn',
      'C:\\data\\projects\\仕事',
      'C:\\data\\projects\\業務'
    ),
    'C:\\data\\projects\\業務\\手順書.opn'
  );
});

test('パスの付け替え: 対象外のパスはそのまま', () => {
  assert.equal(
    replacePathPrefix('C:\\data\\projects\\個人\\a.opn', 'C:\\data\\projects\\仕事', 'C:\\data\\projects\\業務'),
    'C:\\data\\projects\\個人\\a.opn'
  );
});
