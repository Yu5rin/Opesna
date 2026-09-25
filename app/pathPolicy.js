'use strict';
// IPC が「開いてよい・書いてよい」と扱うパスかどうかを判定する純粋関数（main.js から使う）。
//
// なぜ必要か: 以前は save-project / open-project-by-path / show-item-in-folder が、
// renderer から渡された任意の文字列パスをそのまま使っていた（S2）。renderer 側は素の
// <script> で動いており、拡張機能や不具合で予期しない値が渡ってもここでは弾けない。
// 「許してよいパス」の判定だけをここに切り出し、main.js 側の各 IPC ハンドラーは
// その結果に従うだけにする。
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('path') : null);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaPathPolicy = api;
  }
})(typeof self !== 'undefined' ? self : this, function (pathModule) {
  const IS_WINDOWS = typeof process !== 'undefined' && process.platform === 'win32';

  /** 比較用に正規化する（絶対パス化。Windows では大文字小文字を無視する）。 */
  function normalize(p) {
    if (typeof p !== 'string' || p === '') return '';
    let r = pathModule.resolve(p);
    if (IS_WINDOWS) r = r.toLowerCase();
    return r;
  }

  /** target が dir 自身、または dir 配下かどうか。 */
  function isWithinDir(target, dir) {
    const t = normalize(target);
    const d = normalize(dir);
    if (!t || !d) return false;
    if (t === d) return true;
    const sep = pathModule.sep;
    return t.startsWith(d.endsWith(sep) ? d : d + sep);
  }

  /** target が、パスの一覧（配列）のどれかと一致するか。 */
  function isPathInList(target, list) {
    const t = normalize(target);
    if (!t || !Array.isArray(list)) return false;
    return list.some((p) => normalize(p) === t);
  }

  /**
   * save-project（上書き保存）で書き込んでよいか。
   * 許可: 今回のセッション中にダイアログ等で得た既知のパス（sessionPaths）、
   *       または PROJECTS_DIR 配下の .opn。
   */
  function canSaveProject(filePath, { projectsDir, sessionPaths } = {}) {
    if (!filePath) return false;
    if (isPathInList(filePath, sessionPaths)) return true;
    return isWithinDir(filePath, projectsDir);
  }

  /**
   * open-project-by-path で読み込んでよいか。
   * 拡張子が .opn で、かつ PROJECTS_DIR 配下・recent.json 掲載・sessionPaths のいずれか。
   */
  function canOpenProjectByPath(filePath, { projectsDir, recentPaths, sessionPaths } = {}) {
    if (!filePath || typeof filePath !== 'string') return false;
    if (pathModule.extname(filePath).toLowerCase() !== '.opn') return false;
    if (isWithinDir(filePath, projectsDir)) return true;
    if (isPathInList(filePath, recentPaths)) return true;
    if (isPathInList(filePath, sessionPaths)) return true;
    return false;
  }

  /**
   * show-item-in-folder で開いてよいか。
   * 許可: エクスポート・保存で main が返したパス（sessionPaths に登録済み）、
   *       PROJECTS_DIR 配下、recent.json 掲載、autosaveDir 配下。
   */
  function canShowInFolder(filePath, { projectsDir, recentPaths, sessionPaths, autosaveDir } = {}) {
    if (!filePath) return false;
    if (isPathInList(filePath, sessionPaths)) return true;
    if (isWithinDir(filePath, projectsDir)) return true;
    if (autosaveDir && isWithinDir(filePath, autosaveDir)) return true;
    if (isPathInList(filePath, recentPaths)) return true;
    return false;
  }

  return {
    normalize,
    isWithinDir,
    isPathInList,
    canSaveProject,
    canOpenProjectByPath,
    canShowInFolder,
  };
});
