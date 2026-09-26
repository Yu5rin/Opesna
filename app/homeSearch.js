'use strict';
// ホームのサイドバー「プロジェクトを探す」の絞り込み判定。
// 大文字小文字・全角半角を区別しない部分一致（design-brief.md「1. ホーム」）。
// 外の世界（DOM・ファイル）に触れない純粋関数なので、test/homeSearch.test.js から直接読んで確かめる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaHomeSearch = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 大文字小文字・全角半角を区別しない比較のため、文字列を正規化する。
   * 全角英数（Ａ-Ｚ・０-９）は NFKC で半角に、そのあと小文字化する。
   */
  function normalize(text) {
    return String(text == null ? '' : text)
      .normalize('NFKC')
      .toLowerCase();
  }

  /** name が query（トリムして空なら常に true）を部分一致で含むか。 */
  function matchesQuery(name, query) {
    const q = normalize(query).trim();
    if (!q) return true;
    return normalize(name).includes(q);
  }

  /** projects（{name}を持つ配列）を query で絞り込む。 */
  function filterProjectsByQuery(projects, query) {
    return (projects || []).filter(p => matchesQuery(p && p.name, query));
  }

  return { normalize, matchesQuery, filterProjectsByQuery };
});
