'use strict';
// Markdown エクスポートで、題名・説明に含まれる記号がそのまま見出しや記法として
// 解釈されないようにする処理。renderer.js（index.html の <script>）と
// test/*.test.js から読む。
//
// なぜ必要か: ステップの題名・説明はプロジェクト内で自由入力のテキストであり、
// そのまま Markdown に書き出すと「# ステップ」のような行頭記号が見出しになったり、
// `<b>` のような文字列が HTML として解釈されたりする（S7）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaMarkdownEscape = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Markdown 上で無害な形にエスケープする。
   * HTML の特殊文字（& < >）は実体参照に、Markdown の記法に使われる記号
   * （[ ] ( ) # * _ `）はバックスラッシュを前置する。
   */
  function escapeMarkdown(str) {
    let s = String(str === null || str === undefined ? '' : str);
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/([\[\]()#*_`])/g, '\\$1');
    return s;
  }

  return { escapeMarkdown };
});
