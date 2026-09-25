'use strict';
// Markdown エクスポートで画像を置く「<ファイル名>_images」フォルダの名前を決める処理。
// main.js（保存時にこの名前でフォルダを実際に作り、Markdown 中の {{IMAGES_DIR}} を
// 置き換える）と renderer.js（エクスポートのプレビューで同じ名前を先に表示する）の
// 両方が同じ規則で計算する必要がある。
//
// なぜ共有モジュールにしたか: 以前はこの計算式が main.js の export-markdown 内にしか
// 無く、renderer.js 側のプレビューは置き換え前のトークン {{IMAGES_DIR}} をそのまま
// 表示していた（実際に保存した Markdown と見た目が食い違っていた）。同じ計算を
// 2か所に書くとずれる（main 側だけ規則を直して renderer 側が古いままになる等）ため、
// 1つの関数にまとめた。
(function (root, factory) {
  const fileNameModule = typeof module === 'object' && module.exports
    ? require('./fileName')
    : root.OpesnaFileName;
  const api = factory(fileNameModule);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaExportImagesDir = api;
  }
})(typeof self !== 'undefined' ? self : this, function (fileNameModule) {
  const sanitizeFileName = fileNameModule.sanitizeFileName;

  /**
   * 保存ファイル名（"手順書.md" のように拡張子が付いていても、"手順書" のように
   * 付いていなくてもよい）から、画像フォルダの名前を作る。
   * main.js の export-markdown ハンドラは、実際に保存されたパスの basename に対して
   * これと同じ手順（拡張子を外す → 無害化 → "_images" を付ける）を行う。
   */
  function imagesDirName(fileName) {
    const withoutExt = String(fileName || '').replace(/\.(md|markdown)$/i, '');
    return sanitizeFileName(withoutExt, 'export') + '_images';
  }

  return { imagesDirName };
});
