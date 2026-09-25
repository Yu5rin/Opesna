'use strict';
// 色のコントラスト比の計算と、背景色に対する読みやすい文字色の自動選択を扱う処理。
// main.js からは使わず renderer.js（index.html の <script>）と test/*.test.js から読む。
//
// なぜ必要か: テンプレートの中には、背景色（business-dark の暗い青）に対して本文・見出し・
// バッジの文字色が白/黒どちらか固定になっていて読めないものがあった（U3）。テンプレートに
// textColor 等の明示指定が無い場合、WCAG のコントラスト比計算に基づいて黒系/白のどちらか
// 読みやすい方を自動で選ぶ。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaColorContrast = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /** #rgb / #rrggbb / #rrggbbaa 形式（先頭 # 任意）を {r,g,b} に変換。解釈できなければ null。 */
  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    else if (h.length === 8) h = h.slice(0, 6); // アルファは無視
    if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function channelLuminance(c) {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }

  /** WCAG の相対輝度（0〜1）。色を解釈できないときは 0（黒扱い）。 */
  function relativeLuminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
  }

  /** WCAG のコントラスト比（1〜21）。 */
  function contrastRatio(hexA, hexB) {
    const la = relativeLuminance(hexA);
    const lb = relativeLuminance(hexB);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const DARK_TEXT = '#18150f';
  const LIGHT_TEXT = '#ffffff';

  /**
   * 背景色に対し、黒系（#18150f）と白（#ffffff）のうちコントラスト比が高い方を返す
   * （どちらも 4.5:1 に届かない極端な背景色でも、より読みやすい方を返す）。
   */
  function pickTextColor(bg) {
    const cDark = contrastRatio(bg, DARK_TEXT);
    const cLight = contrastRatio(bg, LIGHT_TEXT);
    return cLight > cDark ? LIGHT_TEXT : DARK_TEXT;
  }

  return { hexToRgb, relativeLuminance, contrastRatio, pickTextColor, DARK_TEXT, LIGHT_TEXT };
});
