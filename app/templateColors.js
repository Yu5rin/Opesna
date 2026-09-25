'use strict';
// テンプレートの色・文字サイズを検証し、実際に描画する色（本文・説明・見出し帯・バッジの
// 文字色）を決める処理。renderer.js（index.html の <script>）と test/templates.test.js の
// 両方から読む。
//
// なぜ必要か: テンプレートの中には、背景色に対して本文・見出し・バッジの文字色が
// 白/黒どちらか固定になっていて読めないものがあった（U3）。textColor 等の明示指定が
// 無い場合は colorContrast.pickTextColor で自動選択する。exportGuard の検証も合わせて
// 通すことで、不正な色値がそのまま出力 HTML に入らないようにする（多層防御）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const guard = require('./exportGuard');
    const cc = require('./colorContrast');
    module.exports = factory(guard, cc);
  } else {
    root.OpesnaTemplateColors = factory(root.OpesnaExportGuard, root.OpesnaColorContrast);
  }
})(typeof self !== 'undefined' ? self : this, function (guard, cc) {
  function resolveTemplateColors(tmpl) {
    const t = tmpl || {};
    const headerColor = guard.sanitizeColor(t.headerColor, '#1f4e8c');
    const badgeColor  = guard.sanitizeColor(t.badgeColor, '#1f4e8c');
    const background  = guard.sanitizeColor(t.background, '#ffffff');
    const fontSize    = guard.sanitizeFontSize(t.fontSize, 13);
    const badgeShape  = guard.sanitizeBadgeShape(t.badgeShape, 'circle');
    const textColor       = guard.sanitizeColor(t.textColor, null)       || cc.pickTextColor(background);
    const mutedColor      = guard.sanitizeColor(t.mutedColor, null)      || textColor;
    const headerTextColor = guard.sanitizeColor(t.headerTextColor, null) || cc.pickTextColor(headerColor);
    const badgeTextColor  = cc.pickTextColor(badgeColor);
    return { headerColor, badgeColor, background, fontSize, badgeShape, textColor, mutedColor, headerTextColor, badgeTextColor };
  }

  return { resolveTemplateColors };
});
