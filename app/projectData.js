'use strict';
// .opn プロジェクトデータを、信用できる形に整える純粋関数（normalizeProject）。
// main.js（require）と renderer.js（index.html の <script>）の両方から読む。
//
// なぜ必要か: これまでの openProject / openProjectByPath は、検証する前に state.project を
// 書き換えてしまい、途中の step.annotations.forEach で例外が出るとエディタが壊れた状態のまま
// 残っていた（F17）。さらに imageDataUrl は中身を確かめずに <img src> へそのまま渡しており、
// 細工した .opn を開くと data: URL 経由でスクリプトが動く余地があった（S1）。
// この関数は「読み込んだ JSON → 安全な形の新しいオブジェクト」を1回で作り、
// 呼び出し側（renderer）は検証が終わってから state を一度に置き換える。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./fileName'));
  } else {
    root.OpesnaProjectData = factory(root.OpesnaFileName);
  }
})(typeof self !== 'undefined' ? self : this, function (fileNameModule) {
  // 図形注釈の種類。用語集の「四角形 / 楕円 / 矢印 / 吹き出し / テキスト / ハイライト / モザイク / 番号バッジ」に対応。
  const KNOWN_ANNOTATION_TYPES = [
    'rect', 'ellipse', 'arrow', 'callout', 'text', 'highlight', 'mosaic', 'badge',
  ];
  // data: URL のうち、画像として安全に表示できる形式だけを許す（S1 の根本対策）。
  const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/;
  const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  const DEFAULT_COLOR = '#c0392b';
  const DEFAULT_BADGE_COLOR = '#1f4e8c';
  const TITLE_MAX_CODEPOINTS = 2000;

  function genId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* 続けて他の方法を試す */ }
    try {
      return require('crypto').randomUUID();
    } catch (_) {
      // ブラウザで crypto.randomUUID が無い場合などの最終手段
      return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
  }

  function asString(v, fallback) {
    return typeof v === 'string' ? v : (fallback === undefined ? '' : fallback);
  }

  function asFiniteNumber(v, fallback) {
    const fb = fallback === undefined ? 0 : fallback;
    return typeof v === 'number' && Number.isFinite(v) ? v : fb;
  }

  function asColor(v, fallback) {
    return typeof v === 'string' && COLOR_RE.test(v) ? v : fallback;
  }

  function truncateCodePoints(str, max) {
    const chars = Array.from(str);
    return chars.length > max ? chars.slice(0, max).join('') : str;
  }

  /** 注釈1件を検証・正規化する。type が既知の種類でなければ null（呼び出し側で捨てる）。 */
  function normalizeAnnotation(ann) {
    if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return null;
    if (typeof ann.type !== 'string' || KNOWN_ANNOTATION_TYPES.indexOf(ann.type) === -1) return null;

    const out = {};
    Object.keys(ann).forEach((key) => {
      const v = ann[key];
      if (key === 'color') {
        out.color = asColor(v, DEFAULT_COLOR);
      } else if (key === 'badgeColor') {
        out.badgeColor = asColor(v, DEFAULT_BADGE_COLOR);
      } else if (typeof v === 'number') {
        out[key] = asFiniteNumber(v, 0);
      } else {
        out[key] = v;
      }
    });
    out.type = ann.type;
    return out;
  }

  /** ステップ1件を検証・正規化する。 */
  function normalizeStep(step, index) {
    const src = (step && typeof step === 'object' && !Array.isArray(step)) ? step : {};
    const id = (typeof src.id === 'string' && src.id !== '') ? src.id : genId();

    let title = asString(src.title, `ステップ ${index + 1}`);
    title = truncateCodePoints(title, TITLE_MAX_CODEPOINTS);

    const description = asString(src.description, '');

    const annotations = Array.isArray(src.annotations)
      ? src.annotations.map(normalizeAnnotation).filter(Boolean)
      : [];

    const imageDataUrl = (typeof src.imageDataUrl === 'string' && IMAGE_DATA_URL_RE.test(src.imageDataUrl))
      ? src.imageDataUrl
      : null;

    return {
      id,
      title,
      description,
      imageDataUrl,
      imageWidth:  asFiniteNumber(src.imageWidth, 0),
      imageHeight: asFiniteNumber(src.imageHeight, 0),
      annotations,
    };
  }

  /**
   * .opn から読み込んだ JSON を、安全な形の新しいプロジェクトオブジェクトにする。
   * data がオブジェクトでなければ null を返す（＝開けない。呼び出し側は state を変えないこと）。
   * opts.fileName: name が無いときの既定名を作るための、開いたファイルのファイル名。
   */
  function normalizeProject(data, opts) {
    const options = opts || {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const steps = Array.isArray(data.steps) ? data.steps.map(normalizeStep) : [];

    const fallbackName = options.fileName
      ? String(options.fileName).replace(/\.opn$/i, '')
      : '無題';
    const name = asString(data.name, '') || asString(data.title, '') || fallbackName;

    let category = null;
    if (typeof data.category === 'string' && data.category !== '') {
      const sanitized = fileNameModule.sanitizeFileName(data.category, '');
      category = sanitized || null;
    }

    const template = asString(data.template, 'simple');
    const id = (typeof data.id === 'string' && data.id !== '') ? data.id : genId();

    return {
      id,
      version: '1.0',
      name,
      category,
      template,
      steps: steps.length > 0 ? steps : [normalizeStep({}, 0)],
    };
  }

  return {
    normalizeProject,
    normalizeStep,
    normalizeAnnotation,
    genId,
    KNOWN_ANNOTATION_TYPES,
    IMAGE_DATA_URL_RE,
  };
});
