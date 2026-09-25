'use strict';
// 例外・エラーコードを、利用者向けの日本語メッセージに変換する処理。
// main.js（require）と renderer.js（index.html の <script>）の両方から読む。
//
// なぜ必要か: これまでは各所で err.message をそのまま showToast() に渡しており、
// 「Error invoking remote method 'save-project': Error: EACCES: permission denied, open 'C:\\...'」
// のような、英語・スタックトレース由来の文字列やファイルパスが利用者にそのまま見えていた。
// Electron の IPC を挟むとエラーがこのように二重にラップされるため、message 文字列から
// エラーコード（EACCES など）を正規表現で拾い出し、意味のある日本語文に置き換える。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaErrorMessages = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Node/Electron の一般的なエラーコード。IPC 経由だと message の中に埋もれて出てくるので、
  // 単語境界つきで拾う（例: "...EACCES: permission denied..."）。
  const KNOWN_CODES = [
    'EACCES', 'EPERM', 'EROFS',
    'ENOSPC',
    'EBUSY', 'ELOCKED',
    'ENOENT',
    'ENAMETOOLONG',
    'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN',
    'ERR_INTERNET_DISCONNECTED',
  ];
  const CODE_PATTERN = new RegExp('\\b(' + KNOWN_CODES.join('|') + ')\\b');

  /** err（Error / {code, message} / 文字列）から、含まれるエラーコードを取り出す。無ければ null。 */
  function extractErrorCode(err) {
    if (err && typeof err === 'object' && typeof err.code === 'string' && err.code !== '') {
      return err.code;
    }
    const message = messageOf(err);
    const m = CODE_PATTERN.exec(message);
    return m ? m[1] : null;
  }

  function messageOf(err) {
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    return '';
  }

  const NETWORK_CODES = new Set([
    'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN',
    'ERR_INTERNET_DISCONNECTED',
  ]);

  /**
   * err を、利用者向けの日本語メッセージに変換する。
   * action は「保存」「読み込み」「エクスポート」「削除」「フォルダの作成」等の動作名（省略時「処理」）。
   */
  function toUserMessage(err, action) {
    const act = action || '処理';
    const code = extractErrorCode(err);
    const message = messageOf(err);
    const name = err && typeof err.name === 'string' ? err.name : '';

    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      return `${act}に失敗しました。書き込みの権限がありません。保存先を変えるか、ファイルが読み取り専用になっていないか確かめてください。`;
    }
    if (code === 'ENOSPC') {
      return `${act}に失敗しました。ディスクの空き容量が足りません。`;
    }
    if (code === 'EBUSY' || code === 'ELOCKED' || /being used by another process/i.test(message)) {
      return `${act}に失敗しました。ほかのアプリがファイルを使用中です。OneDrive やウイルス対策ソフトの処理が終わってから、もう一度お試しください。`;
    }
    if (code === 'ENOENT') {
      return `${act}に失敗しました。ファイルまたはフォルダが見つかりません。移動・削除されていないか確かめてください。`;
    }
    if (code === 'ENAMETOOLONG') {
      return `${act}に失敗しました。ファイル名またはパスが長すぎます。`;
    }
    if (code && NETWORK_CODES.has(code)) {
      return `${act}に失敗しました。インターネットに接続できません。通信環境を確かめてください。`;
    }
    if (name === 'SyntaxError' || /JSON/.test(message)) {
      return `${act}に失敗しました。ファイルの内容が壊れているか、Opesna のプロジェクトではありません。`;
    }
    if (name === 'RangeError' || /Invalid string length/i.test(message)) {
      return `${act}に失敗しました。データが大きすぎて処理できません。画像の枚数や大きさを減らしてください。`;
    }
    return `${act}に失敗しました。予期しないエラーが発生しました。`;
  }

  return { toUserMessage, extractErrorCode };
});
