'use strict';
// ショートカットキーの既定値と、キー入力の表記を扱う処理。
// main.js（require）と renderer.js（index.html の <script>）の両方から読み、既定値はここだけに置く。
//
// なぜ1か所にまとめたか: 以前は main.js と renderer.js が別々に既定値を持ち、食い違っていた
// （main.js「キャプチャ Ctrl+Shift+S・やり直し Ctrl+Shift+Z」、renderer.js「Ctrl+Shift+C・Ctrl+Y」、
// ツールバーのツールチップは「やり直し (Ctrl+Y)」）。起動時の値は main.js の get-shortcuts が
// 返すものなので、実際に効いていたのは main.js の値で、renderer.js の値は「デフォルトに戻す」を
// 押したときだけ使われていた。そのため Ctrl+Y を押しても何も起きず、ツールチップだけが違う
// キーを案内していた。値は実際に効いていて、設定画面とメニューにも出ていた main.js の側を採る。
//
// キャプチャの既定値はさらに Ctrl+Shift+S → F9 へ変えた（E3）。「名前を付けて保存」の
// Ctrl+Shift+S と重なり、エディタでは押しても常にキャプチャが開いて保存できなかったため。
// 既存利用者の設定に古い既定値 Ctrl+Shift+S がそのまま残っている場合は、
// migrateOldCaptureDefault() で起動時に F9 へ移す（利用者が自分で別のキーに変えていれば触らない）。
//
// 外の世界（Electron・DOM・ファイル）に触れないので、test/shortcuts.test.js から直接読んで確かめる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaShortcuts = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // 表記は comboFromKeyEvent が作る形（Ctrl → Meta → Alt → Shift → キー）にそろえる。
  // 作れない表記を既定値にすると、押しても一致せず黙って効かない。
  // 実際、以前の main.js はズームを 'Ctrl+Equal'・'Ctrl+Minus' としていたが、押したときの表記は
  // 'Ctrl+=' と 'Ctrl+-' なので一致せず、メニューのアクセラレータが代わりに拾っていただけだった。
  const DEFAULT_SHORTCUTS = Object.freeze({
    capture:          'F9',
    save:             'Ctrl+S',
    open:             'Ctrl+O',
    newProject:       'Ctrl+N',
    undo:             'Ctrl+Z',
    redo:             'Ctrl+Shift+Z',
    export:           'Ctrl+E',
    exportRepeat:     'Ctrl+Shift+E',
    addStep:          'Ctrl+Enter',
    deleteAnnotation: 'Delete',
    selectTool:       'V',
    arrowTool:        'A',
    rectTool:         'R',
    ellipseTool:      'E',
    calloutTool:      'B',
    textTool:         'T',
    highlightTool:    'H',
    mosaicTool:       'M',
    badgeTool:        'N',
    trimTool:         'Ctrl+T',
    zoomIn:           'Ctrl+=',
    zoomOut:          'Ctrl+-',
    zoomReset:        'Ctrl+0',
  });

  /**
   * 保存されていた割り当てに既定値を補う。空の値・文字列でない値は既定値で埋める。
   * 既定値に無いキーも捨てずに残す（利用者が config/shortcuts.json に書いたものを消さない）。
   */
  function withDefaults(stored) {
    const result = Object.assign({}, DEFAULT_SHORTCUTS);
    if (stored && typeof stored === 'object') {
      for (const [key, value] of Object.entries(stored)) {
        if (typeof value === 'string' && value !== '') result[key] = value;
      }
    }
    return result;
  }

  /** keydown のイベント（ctrlKey・metaKey・altKey・shiftKey・key を持つもの）から表記を作る。 */
  function comboFromKeyEvent(e) {
    const parts = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.metaKey)  parts.push('Meta');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(k);
    }
    return parts.join('+');
  }

  /**
   * 表記を Electron のメニューのアクセラレータに直す。
   * macOS では Command で押せるよう Ctrl を CmdOrCtrl にする（それまでのメニューと同じ書き方）。
   */
  function toAccelerator(combo) {
    return combo.split('+').map(p => (p === 'Ctrl' ? 'CmdOrCtrl' : p)).join('+');
  }

  /**
   * ツールチップの文言（例: 「やり直し（Ctrl+Shift+Z）」）。割り当てが無ければ名前だけにする。
   * 括弧は用語集の表記（全角）に合わせる。
   */
  function labelWithShortcut(label, combo) {
    return combo ? `${label}（${combo}）` : label;
  }

  // 移行前の既定値（E3）。config/shortcuts.json にこの値がそのまま残っている利用者だけ、
  // 起動時に新しい既定値へ移す判断材料にする。
  const OLD_CAPTURE_DEFAULT = 'Ctrl+Shift+S';

  /**
   * 保存されていたキャプチャの割り当てが「移行前の既定値」のままなら、新しい既定値へ移す。
   * 利用者が自分で別のキーへ変えていた場合は触らない（値が違えばそのまま返す）。
   * stored（get-shortcuts が読んだ生の値）に対して呼び、変更が無ければ同じ参照を返す。
   */
  function migrateOldCaptureDefault(stored) {
    if (stored && typeof stored === 'object' && stored.capture === OLD_CAPTURE_DEFAULT) {
      return Object.assign({}, stored, { capture: DEFAULT_SHORTCUTS.capture });
    }
    return stored;
  }

  // 割り当ててはいけないキー（修飾キーだけ・Tab・Enter 単独）の判定（F14）。
  // Esc は「入力待ちの取り消し」に使うため、そもそも呼び出し側（renderer）で
  // このチェックより前に別扱いしている。
  const UNASSIGNABLE_BARE_KEYS = ['Tab', 'Enter', 'Escape'];

  /**
   * keydown イベント相当のもの（ctrlKey・metaKey・altKey・shiftKey・key を持つもの）が
   * ショートカットとして割り当ててよいキーかどうか。
   */
  function isAssignableKeyEvent(e) {
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return false; // 修飾キーだけ
    const hasModifier = !!(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);
    if (!hasModifier && UNASSIGNABLE_BARE_KEYS.includes(e.key)) return false;
    return true;
  }

  /**
   * shortcuts の中に combo と同じ割り当てが既に無いか調べる（F14 の重複検出）。
   * key 自身（編集中の操作）は比較から外す。見つかれば重なっている操作名（key）を返す。
   */
  function findConflictingKey(shortcuts, key, combo) {
    if (!combo) return null;
    for (const [k, v] of Object.entries(shortcuts || {})) {
      if (k !== key && v === combo) return k;
    }
    return null;
  }

  return {
    DEFAULT_SHORTCUTS,
    withDefaults,
    comboFromKeyEvent,
    toAccelerator,
    labelWithShortcut,
    OLD_CAPTURE_DEFAULT,
    migrateOldCaptureDefault,
    isAssignableKeyEvent,
    findConflictingKey,
  };
});
