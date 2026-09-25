'use strict';
// フォルダ・プロジェクトの管理（F5・E2・E11）で使う、外の世界（fs・ダイアログ）に
// 触れない判断ロジックだけを集めたモジュール。main.js の各 IPC ハンドラーはここの
// 関数の結果に従うだけにし、実際の判断（名前が使えるか・衝突時にどう名付けるか・
// 移動やリネームでパスをどう書き換えるか）はここでテストする。
(function (root, factory) {
  const fileName = typeof require === 'function' ? require('./fileName') : root.OpesnaFileName;
  const api = factory(fileName);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaProjectFolderLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function (fileName) {
  const { sanitizeFileName } = fileName;

  /**
   * フォルダ名として使えるかどうかを判定する（F5）。
   * "." ".." や空文字は拒否する。それ以外は sanitizeFileName に通した名前を使う
   * （Windows で使えない文字・予約デバイス名などは、拒否ではなく安全な名前へ置き換える）。
   * @returns {{ok:true,name:string}|{ok:false}}
   */
  function validateFolderName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed === '.' || trimmed === '..') return { ok: false };
    const safe = sanitizeFileName(trimmed, '');
    if (!safe || safe === '.' || safe === '..') return { ok: false };
    return { ok: true, name: safe };
  }

  /**
   * baseName が existingNames と重ならないよう、"<名前> (2).拡張子" のように
   * 番号を付けて衝突を避けた名前を返す（E2: フォルダ移動時の同名衝突）。
   * baseName 自体が重なっていなければそのまま返す。
   */
  function collisionSafeName(baseName, existingNames) {
    const set = new Set(existingNames || []);
    if (!set.has(baseName)) return baseName;
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    let i = 2;
    let candidate = `${stem} (${i})${ext}`;
    while (set.has(candidate)) {
      i += 1;
      candidate = `${stem} (${i})${ext}`;
    }
    return candidate;
  }

  /**
   * filePath が oldPrefix 自身、または oldPrefix 配下のパスなら、先頭を newPrefix に
   * 置き換えたパスを返す。それ以外はそのまま返す（フォルダ名変更で recent.json・
   * 開いているプロジェクトの filePath を書き換えるときに使う）。
   */
  function replacePathPrefix(filePath, oldPrefix, newPrefix) {
    if (typeof filePath !== 'string' || typeof oldPrefix !== 'string') return filePath;
    if (filePath === oldPrefix) return newPrefix;
    if (filePath.startsWith(oldPrefix + '/') || filePath.startsWith(oldPrefix + '\\')) {
      return newPrefix + filePath.slice(oldPrefix.length);
    }
    return filePath;
  }

  return { validateFolderName, collisionSafeName, replacePathPrefix };
});
