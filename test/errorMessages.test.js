'use strict';
// エラーを利用者向けの日本語文にする処理（app/errorMessages.js）を固定するテスト。
// Electron の IPC を経由すると、エラーコードが message 文字列の中に埋もれて出てくるため
// （例: "Error invoking remote method 'save-project': Error: EACCES: permission denied, ..."）、
// 実際にそういう形の文字列からもコードを拾えることを確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { toUserMessage, extractErrorCode } = require('../app/errorMessages');

const IPC_EACCES =
  "Error invoking remote method 'save-project': Error: EACCES: permission denied, open 'C:\\\\Users\\\\a\\\\project.opn'";

test('extractErrorCode: {code} オブジェクトから直接取れる', () => {
  assert.equal(extractErrorCode({ code: 'ENOENT', message: 'not found' }), 'ENOENT');
});

test('extractErrorCode: IPC でラップされた message 文字列からも拾える', () => {
  assert.equal(extractErrorCode(new Error(IPC_EACCES)), 'EACCES');
  assert.equal(extractErrorCode(IPC_EACCES), 'EACCES');
});

test('extractErrorCode: コードが無ければ null', () => {
  assert.equal(extractErrorCode(new Error('よくわからないエラー')), null);
  assert.equal(extractErrorCode(undefined), null);
});

test('権限系（EACCES/EPERM/EROFS）', () => {
  for (const code of ['EACCES', 'EPERM', 'EROFS']) {
    assert.equal(
      toUserMessage({ code }, '保存'),
      '保存に失敗しました。書き込みの権限がありません。保存先を変えるか、ファイルが読み取り専用になっていないか確かめてください。',
    );
  }
});

test('IPC 形式の文字列でも権限エラーと判定できる', () => {
  assert.equal(
    toUserMessage(new Error(IPC_EACCES), '保存'),
    '保存に失敗しました。書き込みの権限がありません。保存先を変えるか、ファイルが読み取り専用になっていないか確かめてください。',
  );
});

test('ENOSPC: 空き容量不足', () => {
  assert.equal(
    toUserMessage({ code: 'ENOSPC' }, 'エクスポート'),
    'エクスポートに失敗しました。ディスクの空き容量が足りません。',
  );
});

test('EBUSY / ELOCKED / "being used by another process": 使用中', () => {
  assert.equal(
    toUserMessage({ code: 'EBUSY' }, '保存'),
    '保存に失敗しました。ほかのアプリがファイルを使用中です。OneDrive やウイルス対策ソフトの処理が終わってから、もう一度お試しください。',
  );
  assert.equal(
    toUserMessage({ code: 'ELOCKED' }, '保存'),
    '保存に失敗しました。ほかのアプリがファイルを使用中です。OneDrive やウイルス対策ソフトの処理が終わってから、もう一度お試しください。',
  );
  assert.equal(
    toUserMessage(new Error("EBUSY: resource busy or locked, the file is being used by another process"), '保存'),
    '保存に失敗しました。ほかのアプリがファイルを使用中です。OneDrive やウイルス対策ソフトの処理が終わってから、もう一度お試しください。',
  );
});

test('ENOENT: 見つからない', () => {
  assert.equal(
    toUserMessage({ code: 'ENOENT' }, '読み込み'),
    '読み込みに失敗しました。ファイルまたはフォルダが見つかりません。移動・削除されていないか確かめてください。',
  );
});

test('ENAMETOOLONG: 名前が長すぎる', () => {
  assert.equal(
    toUserMessage({ code: 'ENAMETOOLONG' }, '保存'),
    '保存に失敗しました。ファイル名またはパスが長すぎます。',
  );
});

test('通信系のコードはすべて同じ文言になる', () => {
  const codes = [
    'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET',
    'EAI_AGAIN', 'ERR_INTERNET_DISCONNECTED',
  ];
  for (const code of codes) {
    assert.equal(
      toUserMessage({ code }, '読み込み'),
      '読み込みに失敗しました。インターネットに接続できません。通信環境を確かめてください。',
    );
  }
});

test('JSON の構文エラー: プロジェクトファイルが壊れている', () => {
  let jsonErr;
  try {
    JSON.parse('{ 壊れた json');
  } catch (e) {
    jsonErr = e;
  }
  assert.equal(
    toUserMessage(jsonErr, '読み込み'),
    '読み込みに失敗しました。ファイルの内容が壊れているか、Opesna のプロジェクトではありません。',
  );
});

test('RangeError / "Invalid string length": データが大きすぎる', () => {
  assert.equal(
    toUserMessage(new RangeError('too big'), '保存'),
    '保存に失敗しました。データが大きすぎて処理できません。画像の枚数や大きさを減らしてください。',
  );
  assert.equal(
    toUserMessage(new Error('Invalid string length'), '保存'),
    '保存に失敗しました。データが大きすぎて処理できません。画像の枚数や大きさを減らしてください。',
  );
});

test('分類できないエラーは「予期しないエラー」', () => {
  assert.equal(
    toUserMessage(new Error('謎のエラー'), '削除'),
    '削除に失敗しました。予期しないエラーが発生しました。',
  );
});

test('action を省略すると「処理」になる', () => {
  assert.equal(
    toUserMessage(new Error('謎のエラー')),
    '処理に失敗しました。予期しないエラーが発生しました。',
  );
});

test('文字列だけの err も扱える', () => {
  assert.equal(
    toUserMessage('EACCES: permission denied', '保存'),
    '保存に失敗しました。書き込みの権限がありません。保存先を変えるか、ファイルが読み取り専用になっていないか確かめてください。',
  );
});
