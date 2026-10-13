'use strict';
// 保存場所（設定・ログ・プロジェクトなど）の置き方に関する処理。main.js から使う。
//
// なぜ切り出したか: 利用者が PC を引っ越すとき、exe と data フォルダをコピーするだけで
// 全部を持っていけるようにするため、設定（config）とログ（logs）も data の下へ移した。
// 以前の版は ROOT/config・ROOT/logs に置いていたので、起動時に一度だけ移す必要がある。
// 「どの組み合わせで何をするか」の判断と、最近開いたプロジェクトのパスの扱い
// （data の中は data からの相対で持つ）は外の世界に触れない形にしてテストする。
// ファイル操作を伴う移動は fs を引数で受け取る（本物の一時フォルダでテストできるように）。
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('path') : null);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaDataLayout = api;
  }
})(typeof self !== 'undefined' ? self : this, function (defaultPath) {

  // ─── 引っ越しの判断 ──────────────────────────────────────────────────────────

  /**
   * 以前の版の置き場所から移すかどうか。開発中は ROOT がリポジトリ直下で、そこの config/ は
   * リポジトリに入っている開発用の設定なので、利用者の設定と取り違えて動かさない。
   * ただし PORTABLE_EXECUTABLE_DIR を指定したときは別のフォルダを ROOT にしているので移す
   * （実機に近い形での動作確認のため）。
   */
  function shouldMigrate({ isPackaged, portableDir } = {}) {
    return !!isPackaged || !!portableDir;
  }

  /**
   * config と logs それぞれについて、何をするかを決める。
   *   config: 'none'（何もしない）/ 'move'（フォルダごと移す）/ 'keep-new'（新しい方を正とし、古い方には触らない）
   *   logs:   'none' / 'move' / 'merge'（ファイルごとに寄せる）
   * config は設定そのものなので、両方あるときに混ぜない（新しい版を使った後に古い版を起動した
   * ような場合、新しい方が正しい）。logs は自動更新の直後に古い版の待ち役が古い場所へ
   * 書き足すので、両方あるときは中身を寄せる。
   */
  function planMigration({ oldConfig, newConfig, oldLogs, newLogs }) {
    let config = 'none';
    if (oldConfig) config = newConfig ? 'keep-new' : 'move';
    let logs = 'none';
    if (oldLogs) logs = newLogs ? 'merge' : 'move';
    return { config, logs };
  }

  /** 古い logs のファイル名一覧と新しい方の一覧から、移すもの・寄せるものを分ける。 */
  function planLogMerge(oldNames, newNames) {
    const existing = new Set(newNames);
    const move = [];
    const merge = [];
    for (const name of oldNames) (existing.has(name) ? merge : move).push(name);
    return { move, merge };
  }

  // ─── 最近開いたプロジェクトのパス ────────────────────────────────────────────

  function splitSegments(p) {
    return String(p).split(/[\\/]+/).filter(s => s !== '');
  }

  function isAbsolutePath(p, pathApi) {
    // 別の PC（Windows）で保存された絶対パスを Linux 上でも絶対と見分けられるようにする
    return pathApi.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
  }

  /**
   * recent.json へ書く形にする。dataDir の中のものは dataDir からの相対（区切りは /）、
   * それ以外（利用者が別の場所に保存したもの）は絶対パスのまま。
   * 相対にするのは、exe の置き場所が変わっても（PC の引っ越し）同じ data を指せるようにするため。
   */
  function toStoredPath(absPath, dataDir, pathApi = defaultPath) {
    if (typeof absPath !== 'string' || absPath === '') return absPath;
    if (!isAbsolutePath(absPath, pathApi)) return absPath;
    const rel = pathApi.relative(dataDir, absPath);
    if (rel === '' || rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) {
      return absPath;
    }
    return splitSegments(rel).join('/');
  }

  /**
   * 以前の版が書いた絶対パスで、ファイルが無いものを「今の data/projects の下」につなぎ直す。
   * パスの途中に data/projects（区切りは \ も / も）があれば、その後ろを projectsDir に付ける。
   * つなぎ直せないとき・つないだ先も無いときは null。
   */
  function relinkAbsolutePath(absPath, projectsDir, exists, pathApi = defaultPath) {
    const m = /[\\/]data[\\/]projects[\\/](.+)$/.exec(String(absPath));
    if (!m) return null;
    const segs = splitSegments(m[1]);
    if (segs.length === 0 || segs.includes('..')) return null;
    const candidate = pathApi.join(projectsDir, ...segs);
    return exists(candidate) ? candidate : null;
  }

  /**
   * recent.json の1件を、今の環境で開ける絶対パスにする。
   *   相対 → dataDir に付ける
   *   絶対 → あればそのまま。無ければ data/projects の途中でつなぎ直す。つなげなければそのまま
   * 不正な値（文字列でない・.. を含む相対）は null。
   */
  function resolveStoredPath(stored, { dataDir, projectsDir, exists }, pathApi = defaultPath) {
    if (typeof stored !== 'string' || stored === '') return null;
    if (!isAbsolutePath(stored, pathApi)) {
      const segs = splitSegments(stored);
      if (segs.length === 0 || segs.includes('..')) return null;
      return pathApi.join(dataDir, ...segs);
    }
    if (exists(stored)) return stored;
    return relinkAbsolutePath(stored, projectsDir, exists, pathApi) || stored;
  }

  // ─── 以前の置き場所からの引っ越し（ファイル操作） ─────────────────────────────

  /** src を dst へ移す。rename で動かし、だめなら（他のプログラムがつかんでいる等）コピーして元を消す。 */
  function moveEntry(fs, src, dst) {
    try {
      fs.renameSync(src, dst);
      return { warning: null };
    } catch (_) { /* コピーで代える */ }
    try {
      fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false });
    } catch (err) {
      // 中途半端なコピーを残すと、次の起動で「両方ある」扱いになってしまう
      try { fs.rmSync(dst, { recursive: true, force: true }); } catch (_) { /* 無視 */ }
      throw err;
    }
    try {
      fs.rmSync(src, { recursive: true, force: true });
      return { warning: null };
    } catch (err) {
      return { warning: `コピーはできたが元を消せなかった: ${src}` };
    }
  }

  function readText(fs, file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
  }

  /**
   * ROOT/config・ROOT/logs を dataDir の下へ移す。起動時、フォルダを作る前に1回呼ぶ。
   * 移すものが無ければ存在確認だけで戻る。
   * 失敗しても例外は投げず、結果に積んで返す（失敗しても古いものは残るので失われない）。
   * @returns {{config:string, logs:string, errors:string[], warnings:string[]}}
   *   config: 'none' | 'moved' | 'kept-new' | 'failed'、logs: 'none' | 'moved' | 'merged' | 'failed'
   */
  function migrateLegacyLayout({ fs, path: pathApi = defaultPath, root: rootDir, dataDir }) {
    const result = { config: 'none', logs: 'none', errors: [], warnings: [] };
    const oldConfig = pathApi.join(rootDir, 'config');
    const newConfig = pathApi.join(dataDir, 'config');
    const oldLogs   = pathApi.join(rootDir, 'logs');
    const newLogs   = pathApi.join(dataDir, 'logs');
    const plan = planMigration({
      oldConfig: fs.existsSync(oldConfig),
      newConfig: fs.existsSync(newConfig),
      oldLogs:   fs.existsSync(oldLogs),
      newLogs:   fs.existsSync(newLogs),
    });
    if (plan.config === 'none' && plan.logs === 'none') return result;

    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      const msg = `data フォルダを作れなかった: ${err && err.message}`;
      result.errors.push(msg);
      if (plan.config !== 'none') result.config = plan.config === 'keep-new' ? 'kept-new' : 'failed';
      if (plan.logs !== 'none') result.logs = 'failed';
      return result;
    }

    if (plan.config === 'move') {
      try {
        const { warning } = moveEntry(fs, oldConfig, newConfig);
        if (warning) result.warnings.push(warning);
        result.config = 'moved';
      } catch (err) {
        result.config = 'failed';
        result.errors.push(`設定フォルダを移せなかった: ${err && err.message}`);
      }
    } else if (plan.config === 'keep-new') {
      result.config = 'kept-new';
      result.warnings.push(`data の設定と以前の設定の両方がある。data の設定を使い、以前の設定（${oldConfig}）には触らない`);
    }

    if (plan.logs === 'move') {
      try {
        const { warning } = moveEntry(fs, oldLogs, newLogs);
        if (warning) result.warnings.push(warning);
        result.logs = 'moved';
      } catch (err) {
        result.logs = 'failed';
        result.errors.push(`ログフォルダを移せなかった: ${err && err.message}`);
      }
    } else if (plan.logs === 'merge') {
      result.logs = 'merged';
      let oldNames = [];
      let newNames = [];
      try {
        oldNames = fs.readdirSync(oldLogs);
        newNames = fs.readdirSync(newLogs);
      } catch (err) {
        result.logs = 'failed';
        result.errors.push(`ログフォルダを読めなかった: ${err && err.message}`);
      }
      const { move, merge } = planLogMerge(oldNames, newNames);
      for (const name of move) {
        try {
          const { warning } = moveEntry(fs, pathApi.join(oldLogs, name), pathApi.join(newLogs, name));
          if (warning) result.warnings.push(warning);
        } catch (err) {
          result.logs = 'failed';
          result.errors.push(`ログ ${name} を移せなかった: ${err && err.message}`);
        }
      }
      for (const name of merge) {
        const from = pathApi.join(oldLogs, name);
        const to = pathApi.join(newLogs, name);
        try {
          if (fs.statSync(from).isDirectory()) continue; // ログはファイルだけ。想定外のものは触らない
          // 古い方の中身を新しい方の先頭へ足す
          fs.writeFileSync(to, readText(fs, from) + readText(fs, to), 'utf8');
          fs.unlinkSync(from);
        } catch (err) {
          result.logs = 'failed';
          result.errors.push(`ログ ${name} を寄せられなかった: ${err && err.message}`);
        }
      }
      // 空になったら消す（残っていれば rmdir は失敗するので、そのままにする）
      try { fs.rmdirSync(oldLogs); } catch (_) { /* 空でなければ残す */ }
    }
    return result;
  }

  return {
    shouldMigrate,
    planMigration,
    planLogMerge,
    toStoredPath,
    relinkAbsolutePath,
    resolveStoredPath,
    migrateLegacyLayout,
  };
});
