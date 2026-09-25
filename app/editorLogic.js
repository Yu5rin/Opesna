'use strict';
// エディタ（キャンバス・注釈・ステップ一覧）の判断ロジックのうち、
// 外の世界（Electron・DOM・ファイル・時刻）に触れない部分をここへ切り出す。
// renderer.js（index.html の <script>）から読む。app/shortcuts.js と同じ UMD 形式。
//
// なぜ切り出したか: これらは node:test から直接検証したい純粋な計算
// （画面に合わせる倍率、元に戻す用スナップショットの複製範囲、バッジ番号の採番、
// 画像形式の選択、右クリックメニューの位置調整）で、DOM や canvas が無い環境でも
// 同じ結果になるべきもの。renderCanvas 等の描画処理そのものはここには置かない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaEditorLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 「画面に合わせる」倍率を計算する。キャンバス領域の内寸に収まる最大の倍率で、
   * 上限は maxZoom（既定 1.0 = 小さい画像は拡大しない）。
   * 画像や領域の寸法が不明・0以下のときは maxZoom を返す。
   */
  function computeFitZoom(imgW, imgH, availW, availH, maxZoom) {
    const max = typeof maxZoom === 'number' ? maxZoom : 1.0;
    if (!imgW || !imgH || imgW <= 0 || imgH <= 0) return max;
    if (!availW || !availH || availW <= 0 || availH <= 0) return max;
    const fit = Math.min(availW / imgW, availH / imgH);
    return Math.min(max, fit);
  }

  /**
   * 元に戻す用のスナップショットを作る浅いコピー。
   * F4: JSON.parse(JSON.stringify(steps)) は base64 画像 (imageDataUrl) まで
   * 丸ごと複製しメモリを食う。文字列は不変なので参照共有で十分 ── ステップと
   * 注釈のオブジェクト・配列だけを新しく作ればよい。
   */
  function cloneStepsShallow(steps) {
    return (steps || []).map(step => ({
      ...step,
      annotations: (step.annotations || []).map(ann => {
        const copy = { ...ann };
        // 配列プロパティ (points 等、将来の拡張含む) は参照共有すると
        // 復元後の操作が元のスナップショットまで書き換えてしまうのでコピーする
        for (const key of Object.keys(copy)) {
          if (Array.isArray(copy[key])) copy[key] = copy[key].slice();
        }
        return copy;
      }),
    }));
  }

  /** ステップ内の番号バッジの最大値+1 を返す（無ければ1）。 */
  function nextBadgeNumber(annotations) {
    let max = 0;
    for (const ann of annotations || []) {
      if (ann.type === 'badge' && typeof ann.badgeNumber === 'number' && ann.badgeNumber > max) {
        max = ann.badgeNumber;
      }
    }
    return max + 1;
  }

  /**
   * ステップ内の番号バッジを、現在の番号順に 1 から振り直した新しい配列を返す
   * （非破壊。バッジ以外の注釈はそのまま）。
   */
  function renumberBadges(annotations) {
    const list = annotations || [];
    const badges = list
      .map((ann, idx) => ({ ann, idx }))
      .filter(x => x.ann.type === 'badge')
      .sort((a, b) => (a.ann.badgeNumber || 0) - (b.ann.badgeNumber || 0));

    const renumbered = new Map();
    badges.forEach((x, i) => renumbered.set(x.idx, i + 1));

    return list.map((ann, idx) => {
      if (ann.type !== 'badge') return ann;
      return { ...ann, badgeNumber: renumbered.get(idx) };
    });
  }

  /** data URL の画像形式を判定する（jpeg か、それ以外は png 扱い）。 */
  function imageFormatFromDataUrl(dataUrl) {
    if (typeof dataUrl === 'string' && /^data:image\/jpe?g/i.test(dataUrl)) return 'jpeg';
    return 'png';
  }

  /**
   * 画像を書き出す際の mime とオプションを、元の形式に合わせて選ぶ。
   * JPEG は容量が肥大しないよう品質 0.92 の JPEG のまま、それ以外は PNG。
   */
  function exportFormatFor(dataUrl) {
    if (imageFormatFromDataUrl(dataUrl) === 'jpeg') {
      return { mime: 'image/jpeg', quality: 0.92 };
    }
    return { mime: 'image/png', quality: undefined };
  }

  /**
   * 右クリックメニューの表示位置を、ウィンドウからはみ出さないように調整する。
   * はみ出す側だけ、メニューの右端/下端が余白ぶん内側に収まるようずらす。
   */
  function computeMenuPosition(x, y, menuW, menuH, viewportW, viewportH, margin) {
    const m = typeof margin === 'number' ? margin : 4;
    let left = x;
    let top = y;
    if (left + menuW > viewportW - m) left = Math.max(m, viewportW - menuW - m);
    if (top + menuH > viewportH - m) top = Math.max(m, viewportH - menuH - m);
    return { left, top };
  }

  return {
    computeFitZoom,
    cloneStepsShallow,
    nextBadgeNumber,
    renumberBadges,
    imageFormatFromDataUrl,
    exportFormatFor,
    computeMenuPosition,
  };
});
