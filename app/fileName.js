'use strict';
// ファイル名の無害化（sanitizeFileName）と拡張子付与（ensureExt）を扱う処理。
// main.js（require）と renderer.js（index.html の <script>）の両方から読む。
//
// なぜ1か所にまとめたか: 以前は main.js の ensureExt() が「Windows で使えない文字を置き換える」
// だけで、末尾のドット・空白や予約デバイス名（CON, NUL など）、長すぎる名前には対応していなかった。
// これらは Windows では保存自体に失敗する原因になるため、保存・エクスポート・削除など
// 「利用者が付けた名前でファイルを作る」すべての場面で同じ規則を通す必要があり、共有モジュールにした。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaFileName = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Windows で使えない文字（\ / : * ? " < > |）と制御文字（U+0000〜U+001F）。
  const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
  // 末尾のドット・空白（Windows は保存時にこれらを黙って落とすので、こちらでも明示的に除く）。
  const TRAILING_DOTS_SPACES = /[.\s]+$/;
  // 予約デバイス名（拡張子を除いた先頭部分がこれに一致すると Windows では作成できない）。
  const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  // 絵文字（サロゲートペア）を途中で割らないよう、文字単位でなくコードポイント単位で数える上限。
  const MAX_CODEPOINTS = 120;

  /** fallback へのフォールバックを含まない、無害化の本体処理。 */
  function sanitizeCore(name) {
    let s = typeof name === 'string' ? name : '';
    s = s.replace(FORBIDDEN_CHARS, '_');
    s = s.trim();
    s = s.replace(TRAILING_DOTS_SPACES, '');

    // 予約デバイス名は先頭に _ を付けて回避する（"CON.txt" のように拡張子付きでも対象）。
    const dotIndex = s.indexOf('.');
    const base = dotIndex === -1 ? s : s.slice(0, dotIndex);
    if (base !== '' && RESERVED_NAME.test(base)) {
      s = '_' + s;
    }

    const codePoints = Array.from(s);
    if (codePoints.length > MAX_CODEPOINTS) {
      s = codePoints.slice(0, MAX_CODEPOINTS).join('');
    }
    // 切り詰めた結果、末尾がまたドット・空白になることがあるので再度除く。
    s = s.replace(TRAILING_DOTS_SPACES, '');
    return s;
  }

  /**
   * 利用者が入力した文字列を、Windows でも安全なファイル名にする。
   * 結果が空、または "." / ".." になる場合は fallback を（同じ規則を通してから）返す。
   */
  function sanitizeFileName(name, fallback) {
    const fb = fallback === undefined ? '無題' : fallback;
    const result = sanitizeCore(name);
    if (result === '' || result === '.' || result === '..') {
      return sanitizeCore(fb);
    }
    return result;
  }

  /** sanitizeFileName を通したうえで、拡張子（大文字小文字を問わない）が無ければ付ける。 */
  function ensureExt(name, ext) {
    const sanitized = sanitizeFileName(name, 'export');
    const cleanExt = String(ext || '').replace(/^\./, '');
    if (cleanExt === '') return sanitized;
    const suffix = '.' + cleanExt.toLowerCase();
    return sanitized.toLowerCase().endsWith(suffix) ? sanitized : sanitized + '.' + cleanExt;
  }

  return { sanitizeFileName, ensureExt };
});
