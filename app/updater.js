'use strict';
// 自動更新の通信・ファイル・プロセスまわり（main 側）。判断そのものは app/updateLogic.js に
// 寄せてあり、ここは「確認する」「取ってくる」「入れ替える」という手順だけを持つ。
//
// 方針は仕様書（scratchpad/wp8.md）のとおり:
//   ・Opesna は自分から外部へ通信しない。通信するのは「更新を確認」を押したときと、
//     設定「新しい版があるか自動で確認する」がオンのときの起動5秒後とその後1時間おきだけ
//   ・普段の確認は Atom フィードのみ（GitHub API の回数上限＝1時間60回・未認証とは別枠）。
//     新しい版が見つかったときだけ GitHub API を1回呼び、配布物（Opesna.exe）の
//     digest（SHA256）とダウンロードURLを取る。API が使えなくても、ダウンロードURLは
//     Atom のタグから規則で組み立てられる（そのときは SHA256 の照合を省く）
//   ・SHA256 はリリース本文（人が書き換える Markdown）からは読まない。GitHub がアセットごとに
//     持つ digest を読む（app/updateLogic.js の findExeAsset）

const { net, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const {
  isNewer,
  extractLatestTagFromAtom,
  buildDownloadUrl,
  buildReleasePageUrl,
  buildLatestReleasePageUrl,
  buildApiReleaseUrl,
  findExeAsset,
  decideLeftover,
  decideReadyLeftover,
  validateReadyMarker,
  isDownloadSizeMismatch,
  buildWaiterArgs,
} = require('./updateLogic');

const ASSET_NAME = 'Opesna.exe';
const MARKER_NAME = 'opesna-update.ok';
const FAILED_MARKER_NAME = 'opesna-update.failed';
// 準備済みの印（JSON {tag, sha256, size}）。.download がダウンロード・検証を終えた完全なものだと示す。
// 起動中に裏で用意しておき、閉じたときに待ち役が入れ替える（なぜ閉じたときか: 実行中は
// Opesna.exe を portable の展開役がつかんでいて、名前を替えられない＝EBUSY のため）。
const READY_MARKER_NAME = 'opesna-update.ready';
const DOWNLOAD_SUFFIX = '.download';
const OLD_SUFFIX = '.old';

const TOTAL_CHECK_TIMEOUT_MS = 20000; // 仕様書 U-07b: 全体20秒
const ATOM_TIMEOUT_MS = 8000;         // 仕様書 U-07b: Atom単体8秒
const RESPONSE_TIMEOUT_MS = 30000;    // 応答（ヘッダー）が来るまでの上限。実機で応答なしのまま
                                       // 止まった例があったため、本体の受信（10分）とは別に短く切る
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const CONNECTION_TEST_TIMEOUT_MS = 20000;
const MIN_DOWNLOAD_BYTES = 1024 * 1024; // 1MB 未満は中止（U-03）

// 待ち役（PowerShell）のスクリプト本体は app/updaterWaiterScript.js に分けてある
// （electron に触れないため、テストからそのまま require できるようにするため）。
const { WAITER_SCRIPT } = require('./updaterWaiterScript');

/**
 * @param {object} opts
 * @param {() => string} opts.getAppVersion 現在動いている Opesna のバージョン
 * @param {import('./logger').createLogger extends Function ? ReturnType<typeof import('./logger').createLogger> : any} opts.logger
 */
function createUpdater({ getAppVersion, logger }) {
  let activeAbortController = null;
  let downloadInProgress = false; // 二重実行の防止（U-04a 相当）

  // ─── ポータブル exe の位置 ───────────────────────────────────────────────────

  /** 開発中（npm start）は入れ替え対象の exe が無いので、常に false。 */
  function isPortableBuild() {
    return !!process.env.PORTABLE_EXECUTABLE_FILE;
  }

  function getExePaths() {
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || '';
    const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || (exePath ? path.dirname(exePath) : '');
    const exeName = exePath ? path.basename(exePath) : ASSET_NAME;
    return { exePath, exeDir, exeName };
  }

  // ─── User-Agent / fetch helper ───────────────────────────────────────────────

  function userAgent() {
    return `Opesna/${getAppVersion()}`;
  }

  // ─── U-01/U-02/U-07: 更新の確認（Atom フィード＋新しい版があるときだけ API） ─────

  /**
   * @param {object} settings 現在の設定（updateFeedUrl / updateFeedEtag / updateFeedLatestTag を使う）
   * @returns {Promise<{status:'latest'|'available'|'error', latestTag:string, downloadUrl:string,
   *   sha256:string, sizeBytes:number, releaseUrl:string, message:string, settingsPatch:object}>}
   */
  async function checkForUpdate(settings) {
    const currentVersion = getAppVersion();
    const feedUrl = (settings && settings.updateFeedUrl || '').trim();

    if (!feedUrl) {
      return errorResult(currentVersion, '更新の確認先が設定されていません（config/settings.json の updateFeedUrl）。');
    }
    if (!feedUrl.startsWith('https://')) {
      logger.warn(`更新の確認: httpsではないURLは使わない: ${feedUrl}`);
      return errorResult(currentVersion, '更新の確認先が https で始まっていないため中止しました。');
    }

    const totalController = new AbortController();
    const totalTimer = setTimeout(() => totalController.abort(), TOTAL_CHECK_TIMEOUT_MS);

    try {
      logger.info(`更新の確認: 問い合わせ先=${feedUrl}`);
      const knownETag = settings.updateFeedEtag || '';
      const knownTag = settings.updateFeedLatestTag || '';

      const headers = { 'User-Agent': userAgent(), Accept: 'application/atom+xml' };
      if (knownETag && knownTag) headers['If-None-Match'] = knownETag;

      const atomController = new AbortController();
      const atomTimer = setTimeout(() => atomController.abort(), Math.min(ATOM_TIMEOUT_MS, TOTAL_CHECK_TIMEOUT_MS));
      totalController.signal.addEventListener('abort', () => atomController.abort(), { once: true });

      let response;
      try {
        response = await net.fetch(feedUrl, { headers, signal: atomController.signal, redirect: 'follow' });
      } finally {
        clearTimeout(atomTimer);
      }

      let tag = null;
      const settingsPatch = {};

      if (response.status === 304 && knownTag) {
        logger.info(`更新の確認: Atomフィードは前回から変わっていない(304)。前回のタグを使う(${knownTag})`);
        tag = knownTag;
      } else if (response.ok) {
        const xml = await response.text();
        tag = extractLatestTagFromAtom(xml);
        const etag = response.headers.get('etag');
        if (tag && etag) {
          settingsPatch.updateFeedEtag = etag;
          settingsPatch.updateFeedLatestTag = tag;
        }
      } else {
        logger.warn(`更新の確認: Atomフィードの応答が異常(${response.status})`);
        return errorResult(currentVersion, `配布元への問い合わせに失敗しました（応答 ${response.status}）。`, settingsPatch);
      }

      if (!tag) {
        logger.warn('更新の確認: Atomフィードからタグを読み取れなかった');
        return errorResult(currentVersion, '配布元の応答からバージョンを読み取れませんでした。', settingsPatch);
      }

      const newer = isNewer(tag, currentVersion);
      if (newer === null) {
        logger.warn(`更新の確認: バージョン表記を読み取れなかった(現在=${currentVersion}, 配布元=${tag})`);
        return errorResult(currentVersion, 'バージョン表記を読み取れませんでした。', settingsPatch);
      }

      const releaseUrl = buildReleasePageUrl(feedUrl, tag) || buildLatestReleasePageUrl(feedUrl) || '';

      if (!newer) {
        logger.info(`更新の確認: 最新版だった(現在=${currentVersion}, 配布元=${tag})`);
        return {
          status: 'latest', currentVersion, latestTag: tag,
          downloadUrl: '', sha256: '', sizeBytes: 0, releaseUrl,
          message: 'お使いの Opesna は最新版です。', settingsPatch,
        };
      }

      // 新しい版があるときだけ GitHub API を呼び、SHA256（digest）とダウンロードURLを取る。
      // Atom は API の回数上限（1時間60回・未認証、IPアドレスごと）とは別枠のため、
      // 普段の確認はここまでで済ませ、API を呼ぶ頻度を「新しい版があったとき」だけに絞る
      // （/home/user/yu5rin/pane/docs/調査記録/修正-会社で更新できなかった原因.md と同じ考え方）。
      let downloadUrl = '';
      let sha256 = '';
      let sizeBytes = 0;
      const apiUrl = buildApiReleaseUrl(feedUrl, tag);
      if (apiUrl) {
        try {
          const apiController = new AbortController();
          const apiTimer = setTimeout(() => apiController.abort(), TOTAL_CHECK_TIMEOUT_MS);
          totalController.signal.addEventListener('abort', () => apiController.abort(), { once: true });
          let apiResponse;
          try {
            apiResponse = await net.fetch(apiUrl, {
              headers: { 'User-Agent': userAgent(), Accept: 'application/vnd.github+json' },
              signal: apiController.signal,
              redirect: 'follow',
            });
          } finally {
            clearTimeout(apiTimer);
          }
          if (apiResponse.ok) {
            const json = await apiResponse.json();
            const asset = findExeAsset(json, ASSET_NAME);
            if (asset) {
              downloadUrl = asset.url;
              sha256 = asset.sha256;
              sizeBytes = asset.size;
              if (!sha256) logger.warn('更新の確認: 配布元がSHA256(digest)を提供していない。照合を省いて続行する');
            } else {
              logger.warn(`更新の確認: リリース情報に ${ASSET_NAME} のアセットが見つからなかった`);
            }
          } else {
            logger.warn(`更新の確認: リリース情報の取得に失敗(応答 ${apiResponse.status})。Atomのタグからダウンロード先を組み立てて続行する`);
          }
        } catch (err) {
          logger.warn(`更新の確認: リリース情報を取得できなかった(${err && err.message})。Atomのタグからダウンロード先を組み立てて続行する`);
        }
      }
      if (!downloadUrl) {
        // API が使えなくても、ダウンロードURLは規則から組み立てられる（SHA256は分からず、照合を省く）。
        downloadUrl = buildDownloadUrl(feedUrl, tag, ASSET_NAME) || '';
      }

      logger.info(`更新の確認: 新しい版がある(現在=${currentVersion}, 配布元=${tag}, SHA256=${sha256 ? 'あり' : '(なし)'})`);
      return {
        status: 'available', currentVersion, latestTag: tag,
        downloadUrl, sha256, sizeBytes, releaseUrl,
        message: `新しい版 ${tag} があります。`, settingsPatch,
      };
    } catch (err) {
      if (totalController.signal.aborted) {
        logger.warn('更新の確認: 時間内に応答がなかった');
        return errorResult(currentVersion, '配布元から時間内に応答がありませんでした。ネットワークの状態を確認してください。');
      }
      logger.exception('更新の確認に失敗', err);
      return errorResult(currentVersion, `更新を確認できませんでした。${networkMessage(err)}`);
    } finally {
      clearTimeout(totalTimer);
    }
  }

  function errorResult(currentVersion, message, settingsPatch) {
    return {
      status: 'error', currentVersion, latestTag: '',
      downloadUrl: '', sha256: '', sizeBytes: 0, releaseUrl: '',
      message, settingsPatch: settingsPatch || {},
    };
  }

  function networkMessage(err) {
    const code = err && err.code;
    if (code === 'ERR_INTERNET_DISCONNECTED' || code === 'ERR_NAME_NOT_RESOLVED' || code === 'ERR_CONNECTION_REFUSED') {
      return 'インターネットに接続できません。通信環境を確かめてください。';
    }
    return '予期しないエラーが発生しました。詳しくはログ（data\\logs\\update.log）を確認してください。';
  }

  // ─── U-03/U-04: ダウンロードと入れ替え ─────────────────────────────────────────

  /**
   * @param {object} info checkForUpdate() の結果（downloadUrl / sha256 / latestTag を使う）
   * @param {(percent:number|null)=>void} onProgress
   * @returns {Promise<{ok:true, exePath:string} | {ok:false, reason:string, message:string}>}
   */
  async function downloadAndApply(info, onProgress) {
    // 二重実行の防止。実機ログで「1本目が応答なしのまま止まり、利用者がもう一度押して
    // 2本が同時に走った」ことが起きているため、進行中は新しく始めない。
    if (downloadInProgress) {
      logger.warn('更新の適用: ダウンロード中にもう一度呼ばれたため中止した');
      return { ok: false, reason: 'busy', message: 'ダウンロード中です。' };
    }
    if (!isPortableBuild()) {
      return { ok: false, reason: 'dev-build', message: '開発版のため自動更新はできません。' };
    }
    if (!info || !info.downloadUrl) {
      return { ok: false, reason: 'no-url', message: 'ダウンロード先が分かりませんでした。' };
    }
    if (!info.downloadUrl.startsWith('https://')) {
      logger.warn(`更新の適用: httpsではないURLは使わない: ${info.downloadUrl}`);
      return { ok: false, reason: 'insecure-url', message: 'ダウンロード先が https ではないため中止しました。' };
    }

    const { exePath, exeDir, exeName } = getExePaths();
    if (!exePath || !exeDir) {
      return { ok: false, reason: 'no-exe-path', message: 'Opesna が置かれている場所を特定できませんでした。' };
    }

    if (!canWriteToDir(exeDir)) {
      logger.warn(`更新の適用: ${exeDir} へ書き込めない`);
      return { ok: false, reason: 'no-write-permission', message: `${exeDir} に書き込めないため、自動では入れ替えられません。` };
    }

    const controller = new AbortController();
    activeAbortController = controller;
    downloadInProgress = true;

    const downloadPath = path.join(exeDir, exeName + DOWNLOAD_SUFFIX);
    const oldPath = path.join(exeDir, exeName + OLD_SUFFIX);

    try {
      // 準備済みの印が残っていると、これから上書きする .download と食い違うので先に消す
      safeUnlink(path.join(exeDir, READY_MARKER_NAME));
      logger.info(`更新のダウンロード開始: ${info.downloadUrl}`);
      await downloadFile(info.downloadUrl, downloadPath, onProgress, controller.signal);

      // SHA256 は checkForUpdate() が GitHub API のアセットの digest から取ってきたもの
      // （本文の Markdown からは読まない。仕様書 U-03）。空なら照合を省いて続行する。
      if (info.sha256) {
        const actual = await sha256OfFile(downloadPath);
        if (actual !== info.sha256) {
          logger.error(`更新の検証: SHA256が一致しない(期待=${info.sha256}, 実際=${actual})`);
          safeUnlink(downloadPath);
          return { ok: false, reason: 'hash-mismatch', message: 'ダウンロードしたファイルが壊れているか、配布元のものと一致しませんでした。' };
        }
        logger.info('更新の検証: SHA256が一致した');
      } else {
        logger.warn('更新の検証: 配布元がSHA256(digest)を提供していないため照合を省いて続行する');
      }

      // 入れ替え（rename）はここではやらない。Opesna.exe.download を置いたまま、
      // アプリの終了後に分離した待ち役（PowerShell）へ託す（EBUSY の詳しい経緯は
      // WAITER_SCRIPT の直前のコメントを参照）。
      const waiterStarted = spawnWaiter({ exeDir, exePath, downloadPath, oldPath, restart: true });
      if (!waiterStarted) {
        safeUnlink(downloadPath);
        return { ok: false, reason: 'waiter-failed', message: '入れ替えの準備に失敗しました。詳しくはログ（data\\logs\\update.log）を確認してください。' };
      }
      return { ok: true, exePath };
    } catch (err) {
      safeUnlink(downloadPath);
      if (controller.signal.aborted && !err.__timedOut) {
        logger.info('更新のダウンロード: キャンセルされた');
        return { ok: false, reason: 'cancelled', message: 'キャンセルしました。' };
      }
      logger.exception('更新の適用に失敗', err);
      return { ok: false, reason: 'failed', message: err.userMessage || `更新に失敗しました。${networkMessage(err)}` };
    } finally {
      activeAbortController = null;
      downloadInProgress = false;
    }
  }

  // ─── 起動中の自動準備と、閉じたときの入れ替え ──────────────────────────────────────

  /** 自動準備ができる環境か（portable 版で、exe のフォルダに書き込める）。開発版・書き込めないときは false。 */
  function canAutoPrepare() {
    if (!isPortableBuild()) return false;
    const { exePath, exeDir } = getExePaths();
    return !!(exePath && exeDir && canWriteToDir(exeDir));
  }

  function preparedPaths() {
    const { exePath, exeDir, exeName } = getExePaths();
    return {
      exePath, exeDir,
      downloadPath: path.join(exeDir, exeName + DOWNLOAD_SUFFIX),
      oldPath: path.join(exeDir, exeName + OLD_SUFFIX),
      readyPath: path.join(exeDir, READY_MARKER_NAME),
    };
  }

  /**
   * 裏で静かにダウンロードして、準備済みの印を書く。進み具合は出さない。
   * 手順は手動の downloadAndApply と同じ（サイズ・種類・SHA256 の確認 → fsync）で、
   * 違うのは待ち役を起動せず、印を書いて終わること。
   * SHA256 が分からない版は呼び出し側（shouldAutoPrepare）が弾くが、念のためここでも断る。
   * @returns {Promise<{ok:true, tag:string} | {ok:false, reason:string, message:string}>}
   */
  async function prepareUpdate(info) {
    if (downloadInProgress) {
      return { ok: false, reason: 'busy', message: 'ダウンロード中です。' };
    }
    if (!canAutoPrepare()) return { ok: false, reason: 'not-available', message: '自動では準備できない環境です。' };
    if (!info || !info.downloadUrl || !info.latestTag || !info.sha256) {
      return { ok: false, reason: 'no-info', message: 'ダウンロード先または SHA256 が分かりませんでした。' };
    }
    if (!info.downloadUrl.startsWith('https://')) {
      logger.warn(`更新の準備: httpsではないURLは使わない: ${info.downloadUrl}`);
      return { ok: false, reason: 'insecure-url', message: 'ダウンロード先が https ではないため中止しました。' };
    }

    const { downloadPath, readyPath } = preparedPaths();
    const controller = new AbortController();
    activeAbortController = controller;
    downloadInProgress = true;
    try {
      // 古い準備（もっと古い版の .download と印）は、新しい方を用意する前に消す。
      // 印だけが先に消えるので、途中で終了しても「印なし＝未完成」として次の起動で捨てられる。
      safeUnlink(readyPath);
      safeUnlink(downloadPath);

      logger.info(`更新の準備: 自動でダウンロードを始める ${info.latestTag}: ${info.downloadUrl}`);
      await downloadFile(info.downloadUrl, downloadPath, null, controller.signal);

      const actual = await sha256OfFile(downloadPath);
      if (actual !== info.sha256) {
        logger.error(`更新の準備: SHA256が一致しない(期待=${info.sha256}, 実際=${actual})`);
        safeUnlink(downloadPath);
        return { ok: false, reason: 'hash-mismatch', message: 'ダウンロードしたファイルが配布元のものと一致しませんでした。' };
      }
      const size = fs.statSync(downloadPath).size;
      writeReadyMarker(readyPath, { tag: info.latestTag, sha256: actual, size });
      logger.info(`更新の準備: 準備ができた ${info.latestTag} (${size}バイト)。Opesna を閉じたときに入れ替える`);
      return { ok: true, tag: info.latestTag };
    } catch (err) {
      safeUnlink(downloadPath);
      safeUnlink(readyPath);
      logger.exception('更新の準備に失敗', err);
      return { ok: false, reason: 'failed', message: err.userMessage || '自動ダウンロードに失敗しました。' };
    } finally {
      activeAbortController = null;
      downloadInProgress = false;
    }
  }

  /** 印を書いてディスクへ反映する。.download の fsync は downloadFile が済ませている。 */
  function writeReadyMarker(readyPath, marker) {
    const fd = fs.openSync(readyPath, 'w');
    try {
      fs.writeSync(fd, JSON.stringify({ tag: marker.tag, sha256: marker.sha256, size: marker.size }));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  function discardPrepared(why) {
    const { downloadPath, readyPath } = preparedPaths();
    logger.warn(`更新の準備: 準備済みの更新を破棄する（${why}）`);
    safeUnlink(downloadPath);
    safeUnlink(readyPath);
  }

  /** 印を読んで検証する（SHA256 以外）。壊れていれば null。破棄はしない。 */
  function readPreparedMarker() {
    const { downloadPath, readyPath } = preparedPaths();
    let text;
    let size;
    try {
      text = fs.readFileSync(readyPath, 'utf8');
      size = fs.statSync(downloadPath).size;
    } catch (_) {
      return null;
    }
    const v = validateReadyMarker(text, getAppVersion());
    if (!v.ok || v.marker.size !== size) return null;
    return v.marker;
  }

  /**
   * 準備済みの更新が本物か、SHA256 まで照合して確かめる（非同期。画面が出た後・今すぐ再起動で使う）。
   * 合わなければ両方消す。
   * @returns {Promise<{ok:true, marker:object} | {ok:false, hadMarker:boolean}>}
   */
  async function verifyPrepared() {
    if (!isPortableBuild()) return { ok: false, hadMarker: false };
    const { downloadPath, readyPath } = preparedPaths();
    const hadMarker = fs.existsSync(readyPath) || fs.existsSync(downloadPath);
    const marker = readPreparedMarker();
    if (!marker) {
      if (hadMarker) discardPrepared('印またはサイズが合わない');
      return { ok: false, hadMarker };
    }
    try {
      const actual = await sha256OfFile(downloadPath);
      if (actual !== marker.sha256) {
        logger.error(`更新の準備: 照合に失敗(期待=${marker.sha256}, 実際=${actual})`);
        discardPrepared('SHA256が印と一致しない');
        return { ok: false, hadMarker: true };
      }
    } catch (err) {
      logger.exception('更新の準備: 照合中にエラー', err);
      discardPrepared('照合できなかった');
      return { ok: false, hadMarker: true };
    }
    return { ok: true, marker };
  }

  /** 終了の直前に使う同期版の SHA256（will-quit は待てないため。1MB ずつ読む）。 */
  function sha256OfFileSync(filePath) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const n = fs.readSync(fd, buf, 0, buf.length, null);
        if (n <= 0) break;
        hash.update(buf.subarray(0, n));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  }

  /**
   * 「今すぐ再起動」/「更新する」で準備済みを使う。照合して、待ち役を再起動ありで起動する。
   * 準備済みでなければ { ok:false, reason:'not-prepared' }（呼び出し側が従来のダウンロードへ進む）。
   */
  async function applyPreparedAndRelaunch() {
    if (downloadInProgress) return { ok: false, reason: 'busy', message: 'ダウンロード中です。' };
    const v = await verifyPrepared();
    if (!v.ok) return { ok: false, reason: 'not-prepared', hadMarker: v.hadMarker, message: '' };
    const { exePath, exeDir, downloadPath, oldPath } = preparedPaths();
    if (!canWriteToDir(exeDir)) {
      return { ok: false, reason: 'no-write-permission', message: `${exeDir} に書き込めないため、自動では入れ替えられません。` };
    }
    logger.info(`更新: 準備済みの ${v.marker.tag} を使って入れ替える（再起動あり）`);
    if (!spawnWaiter({ exeDir, exePath, downloadPath, oldPath, restart: true })) {
      return { ok: false, reason: 'waiter-failed', message: '入れ替えの準備に失敗しました。詳しくはログ（data\\logs\\update.log）を確認してください。' };
    }
    return { ok: true, exePath, tag: v.marker.tag };
  }

  /**
   * Opesna を閉じるとき（will-quit）に呼ぶ。準備済みがあれば、待ち役を再起動なしで起動する。
   * 実行中は exe を替えられないので、閉じたこの瞬間に待ち役へ任せる。
   * 起動の直前にもう一度 SHA256 を印と照合し、合わなければ待ち役を起動せず両方消す。
   * 終了処理の途中で呼ばれるので、例外は投げず同期で終える。
   * @returns {boolean} 待ち役を起動したか
   */
  function spawnWaiterOnQuit() {
    try {
      if (!isPortableBuild()) return false;
      const { exePath, exeDir, downloadPath, oldPath } = preparedPaths();
      if (!fs.existsSync(downloadPath) && !fs.existsSync(path.join(exeDir, READY_MARKER_NAME))) return false;
      const marker = readPreparedMarker();
      if (!marker) {
        discardPrepared('閉じるときの確認で印またはサイズが合わない');
        return false;
      }
      const actual = sha256OfFileSync(downloadPath);
      if (actual !== marker.sha256) {
        logger.error(`更新: 閉じるときの照合に失敗(期待=${marker.sha256}, 実際=${actual})`);
        discardPrepared('閉じるときの照合でSHA256が一致しない');
        return false;
      }
      logger.info(`更新: Opesna を閉じるので、準備済みの ${marker.tag} に入れ替える（再起動なし）`);
      return spawnWaiter({ exeDir, exePath, downloadPath, oldPath, restart: false });
    } catch (err) {
      logger.exception('更新: 閉じるときの入れ替えの準備に失敗', err);
      return false;
    }
  }

  function cancelDownload() {
    if (activeAbortController) activeAbortController.abort();
  }

  async function downloadFile(url, destPath, onProgress, signal) {
    // 実機で「1本目のダウンロードは応答の行が出ないまま止まった」ことが起きているため、
    // 応答（ヘッダー）が来るまでは別枠で短く（30秒）打ち切る。本体の受信は従来どおり
    // 10分（DOWNLOAD_TIMEOUT_MS）で、応答が来たあとにタイマーを切り替える。
    const controller = new AbortController();
    let timedOutPhase = null; // 'response' | 'body'
    let timer = setTimeout(() => {
      timedOutPhase = 'response';
      controller.abort();
    }, RESPONSE_TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    let response;
    try {
      response = await net.fetch(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/octet-stream' },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(timer);
      if (timedOutPhase === 'response') {
        logger.warn('更新のダウンロード: 応答が無いまま30秒経った');
        const e = new Error('timeout-response');
        e.__timedOut = true;
        e.userMessage = '配布元から30秒以内に応答がありませんでした。ネットワークの状態を確認してください。';
        throw e;
      }
      if (controller.__timedOut || controller.signal.aborted) { const e = new Error('timeout'); e.__timedOut = true; throw e; }
      throw err;
    }
    clearTimeout(timer);
    // 応答（ヘッダー）が返ってきたので、ここから本体の受信は従来どおり10分の上限に切り替える。
    timer = setTimeout(() => {
      timedOutPhase = 'body';
      controller.__timedOut = true;
      controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);

    const finalUrl = response.url || url;
    const contentType = response.headers.get('content-type') || '(なし)';
    logger.info(`更新のダウンロード: 応答 ${response.status}, Content-Type=${contentType}, 転送先=${finalUrl}`);

    if (!response.ok) {
      clearTimeout(timer);
      throw new Error(`ダウンロードに失敗しました（応答 ${response.status}）`);
    }
    if (contentType.toLowerCase().includes('text/html')) {
      clearTimeout(timer);
      const err = new Error('配布物ではなくWebページが返りました');
      err.userMessage = '配布物ではなく Web ページが返ってきたため中止しました。ネットワークの経路で差し替えられている可能性があります。';
      throw err;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const body = response.body;
    const out = fs.createWriteStream(destPath);
    let received = 0;
    let lastPercent = -1;

    try {
      if (body && body.getReader) {
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          // out.write() の戻り値が false ＝ 内部バッファが詰まっている。次のチャンクを
          // 読む前に 'drain' を待たないと、書き込みが追いつかないままメモリに溜め続けてしまう（背圧）。
          const buf = Buffer.from(value);
          if (!out.write(buf)) {
            await new Promise((resolve) => out.once('drain', resolve));
          }
          if (contentLength > 0 && onProgress) {
            const percent = Math.min(99, Math.floor((received * 100) / contentLength));
            if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
          }
        }
      } else {
        // net.fetch の Response.body が使えない環境向けの保険（arrayBuffer 経由）
        const buf = Buffer.from(await response.arrayBuffer());
        received = buf.length;
        out.write(buf);
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
      clearTimeout(timer);
    }

    if (received < MIN_DOWNLOAD_BYTES) {
      safeUnlink(destPath);
      const err = new Error(`配布物が小さすぎます(${received}バイト)`);
      err.userMessage = 'ダウンロードした内容が小さすぎるため中止しました。配布元の応答が正しく届いていない可能性があります。';
      throw err;
    }

    // Content-Length が分かる場合、受信バイト数と食い違っていれば中断されたダウンロードとして
    // 扱う（SHA256 を API から取れず照合を省く経路では、これが唯一の完全性の確認になる）。
    if (isDownloadSizeMismatch(received, contentLength)) {
      logger.error(`更新のダウンロード: サイズが一致しない(期待=${contentLength}, 実際=${received})`);
      safeUnlink(destPath);
      const err = new Error(`ダウンロードのサイズが一致しません(期待=${contentLength}, 実際=${received})`);
      err.userMessage = 'ダウンロードが途中で切れました。もう一度お試しください。';
      throw err;
    }

    // 書き込み終了後、待ち役による rename（入れ替え）の前に確実にディスクへ反映する。
    // ここで fsync せずに入れ替え前後で電源が落ちると、中身の無い・壊れた
    // exe が残ってしまう可能性があるため。
    fsyncFile(destPath);

    if (onProgress) onProgress(100);
    logger.info(`更新のダウンロード完了: ${destPath} (${received}バイト)`);
  }

  /** ファイルの中身をディスクへ確実に反映させる（電源断対策）。失敗してもログのみで続行する。 */
  function fsyncFile(filePath) {
    let fd;
    try {
      fd = fs.openSync(filePath, 'r+');
      fs.fsyncSync(fd);
    } catch (err) {
      logger.warn(`更新のダウンロード: fsync に失敗した（続行する）: ${err && err.message}`);
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) { /* 閉じられなくても致命的ではない */ }
      }
    }
  }

  function sha256OfFile(filePath) {
    const crypto = require('crypto');
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  function canWriteToDir(dir) {
    try {
      const probe = path.join(dir, `.opesna-write-test-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      return true;
    } catch (_) {
      return false;
    }
  }

  function safeUnlink(filePath) {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) { /* 無視 */ }
  }

  // ─── U-04/U-04a: 入れ替えは待ち役（PowerShell）に託し、アプリはすみやかに終了する ─────

  /**
   * 待ち役の .ps1 を一時フォルダへ書き出し、起動してから呼び出し元（downloadAndApply）が
   * すみやかにアプリを終了させる想定。実際の rename・完了/失敗の印・再起動は
   * すべて待ち役（WAITER_SCRIPT）が、アプリ本体（process.pid）と展開役（process.ppid）の
   * 両方が終わるのを待ってから行う（EBUSY の経緯は WAITER_SCRIPT 直前のコメントを参照）。
   *
   * restart が false（閉じたときの入れ替え）のときは -NoRestart を付け、成功しても失敗しても
   * 何も起動させない。
   *
   * @returns {boolean} 待ち役を起動できたか
   */
  function spawnWaiter({ exeDir, exePath, downloadPath, oldPath, restart }) {
    const mainPid = process.pid;
    const parentPid = process.ppid;

    let scriptPath;
    try {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opesna-upd-'));
      scriptPath = path.join(tmpDir, 'opesna-updater-waiter.ps1');
      // Windows PowerShell 5.1 が日本語（ログの文言）を正しく読めるよう、BOM付きUTF-8で書く。
      fs.writeFileSync(scriptPath, '﻿' + WAITER_SCRIPT, 'utf8');
    } catch (err) {
      logger.exception('更新: 待ち役スクリプトの書き出しに失敗', err);
      return false;
    }

    const args = buildWaiterArgs({
      scriptPath,
      mainPid,
      parentPid,
      exePath,
      downloadPath,
      oldPath,
      markerOkPath: path.join(exeDir, MARKER_NAME),
      markerFailedPath: path.join(exeDir, FAILED_MARKER_NAME),
      logPath: logger.filePath,
      readyMarkerPath: path.join(exeDir, READY_MARKER_NAME),
      noRestart: !restart,
    });

    logger.info(`更新: 入れ替えの待ち役を起動する(本体PID=${mainPid}, 展開役PID=${parentPid}, 再起動=${restart ? 'あり' : 'なし'})`);
    try {
      const child = execFile('powershell.exe', args, { windowsHide: true, detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    } catch (err) {
      logger.exception('更新: 待ち役の起動に失敗', err);
      return false;
    }
  }

  // ─── 前回の更新の後始末 ────────────────────────────────────────────────────────

  /**
   * 起動時に1回呼ぶ。.old と完了/失敗の印、.download の残骸を後始末する。
   * ただし準備済み（.download と準備済みの印が両方あり、印の版が今より新しく、サイズが合う）は
   * 残して prepared に返す。SHA256 の照合は起動を遅らせないため、ここではしない
   * （画面が出た後に verifyPrepared() で行う）。
   * @param {{keepPrepared?: boolean}} [opts] keepPrepared が false（自動入れ替えをオフにしている）
   *   なら、準備済みも残さず消す。
   * @returns {{applyFailure: null | {message: string, detail: string}, prepared: null | {tag:string}}}
   *   前回の入れ替えに失敗した形跡（待ち役が書いた失敗の印）があれば applyFailure に入る。
   *   呼び出し側（main.js）はこれを見て、画面に手動での入れ替えを案内する。
   */
  function cleanupLeftovers(opts) {
    const keepPrepared = !opts || opts.keepPrepared !== false;
    if (!isPortableBuild()) return { applyFailure: null, prepared: null };
    const { exeDir, exeName } = getExePaths();
    if (!exeDir) return { applyFailure: null, prepared: null };

    const oldPath = path.join(exeDir, exeName + OLD_SUFFIX);
    const markerPath = path.join(exeDir, MARKER_NAME);
    const failedMarkerPath = path.join(exeDir, FAILED_MARKER_NAME);
    const downloadPath = path.join(exeDir, exeName + DOWNLOAD_SUFFIX);

    const readyPath = path.join(exeDir, READY_MARKER_NAME);

    // 入れ替えに失敗した形跡があるときは、準備済みも信用せず消す（手動で入れ替えてもらう）。
    const hasFailed = fs.existsSync(failedMarkerPath);
    let prepared = null;
    let readyText = '';
    let downloadSize = -1;
    const hasReady = fs.existsSync(readyPath);
    const hasDownload = fs.existsSync(downloadPath);
    try { if (hasReady) readyText = fs.readFileSync(readyPath, 'utf8'); } catch (_) { /* 読めない=壊れた印として捨てる */ }
    try { if (hasDownload) downloadSize = fs.statSync(downloadPath).size; } catch (_) { /* 同上 */ }
    const ready = decideReadyLeftover({
      hasMarker: hasReady, hasDownload, markerText: readyText, downloadSize,
      currentVersion: getAppVersion(),
    });
    if (ready.action === 'keep' && keepPrepared && !hasFailed) {
      prepared = { tag: ready.marker.tag };
      logger.info(`更新の後始末: 準備済みの更新 ${ready.marker.tag} を残す（SHA256は画面が出た後に照合する）`);
    } else {
      // U-06 相当。中断されたダウンロードの残骸・使えない準備は消してよい
      if (ready.action !== 'none') {
        logger.info(`更新の後始末: 準備済みの更新を使わず消す（${hasFailed ? '前回の入れ替えに失敗' : (!keepPrepared ? '自動入れ替えがオフ' : ready.reason)}）`);
      }
      safeUnlink(downloadPath);
      safeUnlink(readyPath);
    }

    let applyFailure = null;
    if (fs.existsSync(failedMarkerPath)) {
      let detail = '';
      try { detail = fs.readFileSync(failedMarkerPath, 'utf8').trim(); } catch (_) { /* 読めなくても続行 */ }
      logger.error(`更新の後始末: 前回の入れ替えに失敗した形跡がある: ${detail || '(詳細不明)'}`);
      safeUnlink(failedMarkerPath);
      applyFailure = {
        message: '更新の入れ替えに失敗しました。Opesna.exe を手動で入れ替えてください。',
        detail,
      };
    }

    let hasOld = false;
    let oldAgeMs;
    try {
      const stat = fs.statSync(oldPath);
      hasOld = true;
      oldAgeMs = Date.now() - stat.mtimeMs;
    } catch (_) { /* 無い */ }

    const hasMarker = fs.existsSync(markerPath);
    const action = decideLeftover({ hasOld, hasMarker, oldAgeMs });

    if (action === 'none') return { applyFailure, prepared };
    if (action === 'keep') {
      logger.warn(`更新の後始末: 前回の入れ替えが完了しないまま終わった形跡がある。退避ファイルを残す: ${oldPath}`);
      return { applyFailure, prepared };
    }
    logger.info(`更新の後始末: 退避ファイルと完了の印を削除する: ${oldPath}`);
    safeUnlink(oldPath);
    safeUnlink(markerPath);
    return { applyFailure, prepared };
  }

  // ─── U-08: 通信を確かめる ──────────────────────────────────────────────────────

  async function testConnection(settings, latestTag) {
    const feedUrl = (settings && settings.updateFeedUrl || '').trim();
    if (!feedUrl) {
      return { ok: false, message: '更新の確認先が設定されていません。' };
    }
    const targetUrl = latestTag ? buildDownloadUrl(feedUrl, latestTag, ASSET_NAME) : feedUrl;
    if (!targetUrl) {
      return { ok: false, message: '接続先の URL を組み立てられませんでした。' };
    }

    try {
      const proxyInfo = await describeProxy(targetUrl);
      logger.info(`更新の通信確認: ${proxyInfo}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS);
      let response;
      try {
        response = await net.fetch(targetUrl, {
          headers: { 'User-Agent': userAgent(), Accept: latestTag ? 'application/octet-stream' : 'application/atom+xml' },
          signal: controller.signal,
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timer);
      }

      const finalUrl = response.url || targetUrl;
      const contentType = response.headers.get('content-type') || '(なし)';

      let received = 0;
      const LIMIT = 64 * 1024;
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        while (received < LIMIT) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
        }
        try { reader.cancel(); } catch (_) { /* 無視 */ }
      }

      logger.info(
        `更新の通信確認: 応答 ${response.status}, 転送先=${finalUrl}, Content-Type=${contentType}, ` +
        `受信=${received}バイト(先頭のみ), ${proxyInfo}`,
      );

      if (!response.ok) {
        return { ok: false, message: `接続先から ${response.status} が返りました。ネットワークの経路で止められている可能性があります。` };
      }
      if (contentType.toLowerCase().includes('text/html') && latestTag) {
        return { ok: false, message: '配布物ではなく Web ページが返りました。ネットワークの経路で差し替えられている可能性があります。' };
      }
      return {
        ok: true,
        message: `接続先まで届きました（${Math.round(received / 1024)}KB を受け取って確認を終えました。応答 ${response.status}）。`,
      };
    } catch (err) {
      logger.exception('更新の通信確認に失敗', err);
      return { ok: false, message: `接続できませんでした。${networkMessage(err)}` };
    }
  }

  async function describeProxy(url) {
    try {
      const ses = session.defaultSession;
      if (!ses || !ses.resolveProxy) return '通信: プロキシ情報を調べられなかった';
      const proxy = await ses.resolveProxy(url);
      if (!proxy || proxy.trim() === 'DIRECT') return '通信: プロキシを経由しない';
      return `通信: プロキシを経由する(${proxy})`;
    } catch (_) {
      return '通信: プロキシ情報を調べられなかった';
    }
  }

  // ─── U-05: リリースページを開く ────────────────────────────────────────────────

  function openReleasePage(url) {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/')) {
      logger.warn(`更新: 許可されていないURLは開かない: ${url}`);
      return false;
    }
    shell.openExternal(url);
    return true;
  }

  return {
    isPortableBuild,
    checkForUpdate,
    downloadAndApply,
    canAutoPrepare,
    prepareUpdate,
    verifyPrepared,
    applyPreparedAndRelaunch,
    spawnWaiterOnQuit,
    cancelDownload,
    cleanupLeftovers,
    testConnection,
    openReleasePage,
  };
}

module.exports = { createUpdater };
