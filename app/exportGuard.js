'use strict';
// エクスポートで組み立てる HTML/PDF に埋め込む値の検証をまとめる処理。
// main.js（require）と renderer.js（index.html の <script>）の両方から読む。
//
// なぜ必要か: 細工された .opn プロジェクトの imageDataUrl や、テンプレートの色・文字サイズが
// そのまま HTML に入ると、読み込み時の検証（別担当）をすり抜けた場合に出力側でスクリプトが
// 動く余地が残る。読み込み側とは別に、出力を組み立てる側でも同じ値を検証する（多層防御）。
// 判定をここ1か所にまとめ、buildExportHTML 等はこの関数だけを通す。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaExportGuard = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // 許可する画像形式のみ。svg は script を含みうるため対象外。
  const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/;
  // PNG 限定（Markdown 画像書き出し用。main 側で受け取る dataUrl はこちらのみ許可）。
  const PNG_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  const BADGE_SHAPES = new Set(['circle', 'square']);

  /** HTML の img src として安全に使える data URL かどうか。 */
  function isValidImageDataUrl(src) {
    return typeof src === 'string' && IMAGE_DATA_URL_RE.test(src);
  }

  /** Markdown 画像書き出し用: PNG の data URL かどうか（main 側の受け取り検証に使う）。 */
  function isValidPngDataUrl(src) {
    return typeof src === 'string' && PNG_DATA_URL_RE.test(src);
  }

  /** テンプレートの色値を検証し、形式が不正なら既定色を返す。 */
  function sanitizeColor(value, fallback) {
    return (typeof value === 'string' && COLOR_RE.test(value)) ? value : fallback;
  }

  /** 文字サイズを数値として検証し、min〜max（既定 8〜48）に収める。不正なら既定値。 */
  function sanitizeFontSize(value, fallback, min, max) {
    const lo = min === undefined ? 8 : min;
    const hi = max === undefined ? 48 : max;
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  /** バッジの形は既知の値のみ受け付ける。 */
  function sanitizeBadgeShape(value, fallback) {
    return BADGE_SHAPES.has(value) ? value : (fallback || 'circle');
  }

  // 出力 HTML の <head> に置く CSP。画像は data: のみ許可し、スクリプトは全面禁止する。
  const CSP_META =
    '<meta http-equiv="Content-Security-Policy" ' +
    'content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">';

  return {
    isValidImageDataUrl,
    isValidPngDataUrl,
    sanitizeColor,
    sanitizeFontSize,
    sanitizeBadgeShape,
    CSP_META,
  };
});
