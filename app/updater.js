'use strict';
// 自動更新の通信・ファイル・プロセスまわり（main 側）。判断そのものは app/updateLogic.js に
// 寄せてあり、ここは「確認する」「取ってくる」「入れ替える」という手順だけを持つ。
//
// 方針は仕様書（scratchpad/wp8.md）のとおり:
//   ・Opesna は自分から外部へ通信しない。通信するのは「更新を確認」を押したときと、
//     設定「起動時に新しい版があるか確認する」がオンのときの起動5秒後だけ
//   ・普段の確認は Atom フィードのみ（GitHub API の回数上限＝1時間60回・未認証とは別枠）。
//     新しい版が見つかったときだけ GitHub API を1回呼び、配布物（Opesna.exe）の
//     digest（SHA256）とダウンロードURLを取る。API が使えなくても、ダウンロードURLは
//     Atom のタグから規則で組み立てられる（そのときは SHA256 の照合を省く）
//   ・SHA256 はリリース本文（人が書き換える Markdown）からは読まない。GitHub がアセットごとに
//     持つ digest を読む（app/updateLogic.js の findExeAsset）

const { net, session, shell } = require('electron');
const fs = require('fs');
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
  quotePowerShellSingle,
} = require('./updateLogic');

const ASSET_NAME = 'Opesna.exe';
const MARKER_NAME = 'opesna-update.ok';
const DOWNLOAD_SUFFIX = '.download';
const OLD_SUFFIX = '.old';

const TOTAL_CHECK_TIMEOUT_MS = 20000; // 仕様書 U-07b: 全体20秒
const ATOM_TIMEOUT_MS = 8000;         // 仕様書 U-07b: Atom単体8秒
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const CONNECTION_TEST_TIMEOUT_MS = 20000;
const MIN_DOWNLOAD_BYTES = 1024 * 1024; // 1MB 未満は中止（U-03）

/**
 * @param {object} opts
 * @param {() => string} opts.getAppVersion 現在動いている Opesna のバージョン
 * @param {import('./logger').createLogger extends Function ? ReturnType<typeof import('./logger').createLogger> : any} opts.logger
 */
function createUpdater({ getAppVersion, logger }) {
  let activeAbortController = null;

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
    return '予期しないエラーが発生しました。詳しくはログ（logs/update.log）を確認してください。';
  }

  // ─── U-03/U-04: ダウンロードと入れ替え ─────────────────────────────────────────

  /**
   * @param {object} info checkForUpdate() の結果（downloadUrl / sha256 / latestTag を使う）
   * @param {(percent:number|null)=>void} onProgress
   * @returns {Promise<{ok:true, exePath:string} | {ok:false, reason:string, message:string}>}
   */
  async function downloadAndApply(info, onProgress) {
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

    const downloadPath = path.join(exeDir, exeName + DOWNLOAD_SUFFIX);
    const oldPath = path.join(exeDir, exeName + OLD_SUFFIX);

    try {
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

      applyUpdateFiles({ exePath, downloadPath, oldPath });
      writeMarker(exeDir);
      logger.info('更新の適用: 入れ替えが完了した');

      spawnWaiterAndRelaunch(exePath);
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
    }
  }

  function cancelDownload() {
    if (activeAbortController) activeAbortController.abort();
  }

  async function downloadFile(url, destPath, onProgress, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); controller.__timedOut = true; }, DOWNLOAD_TIMEOUT_MS);
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
      if (controller.__timedOut) { const e = new Error('timeout'); e.__timedOut = true; throw e; }
      throw err;
    }

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
          out.write(Buffer.from(value));
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
    if (onProgress) onProgress(100);
    logger.info(`更新のダウンロード完了: ${destPath} (${received}バイト)`);
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

  /**
   * 実行中の exe を .old へ退避してから、ダウンロード済みのファイルを本来の名前へ置く。
   * 失敗したら必ず元へ戻す（Pane の ApplyUpdate と同じ考え方）。
   */
  function applyUpdateFiles({ exePath, downloadPath, oldPath }) {
    safeUnlink(oldPath); // 前回の残骸を先に片付ける
    let moved = false;
    try {
      fs.renameSync(exePath, oldPath);
      moved = true;
      fs.renameSync(downloadPath, exePath);
    } catch (err) {
      if (moved) {
        try { fs.renameSync(oldPath, exePath); } catch (_) { /* これ以上は手が無い */ }
      }
      throw err;
    }
  }

  function writeMarker(exeDir) {
    try {
      fs.writeFileSync(path.join(exeDir, MARKER_NAME), '');
    } catch (err) {
      logger.warn(`更新: 完了の印を書けなかった: ${err && err.message}`);
    }
  }

  function safeUnlink(filePath) {
    try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) { /* 無視 */ }
  }

  // ─── U-04a: 再起動の重なりを避ける ─────────────────────────────────────────────

  /**
   * 分離した待ち役（PowerShell）を起動してから、呼び出し元がすみやかに自分を終了させる想定。
   * 本体（process.pid）と展開役（process.ppid）の両方の終了を待ってから新しい exe を起動する。
   */
  function spawnWaiterAndRelaunch(exePath) {
    const mainPid = process.pid;
    const parentPid = process.ppid;
    const quotedExe = quotePowerShellSingle(exePath);
    const script =
      `Wait-Process -Id ${mainPid},${parentPid} -Timeout 60 -ErrorAction SilentlyContinue; ` +
      `Start-Process -FilePath '${quotedExe}'`;

    logger.info(`更新: 再起動の待ち役を起動する(本体PID=${mainPid}, 展開役PID=${parentPid})`);
    try {
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
        { windowsHide: true, detached: true, stdio: 'ignore' },
      );
      child.unref();
    } catch (err) {
      logger.exception('更新: 待ち役の起動に失敗', err);
    }
  }

  // ─── 前回の更新の後始末 ────────────────────────────────────────────────────────

  /** 起動時に1回呼ぶ。.old と完了の印、.download の残骸を後始末する。 */
  function cleanupLeftovers() {
    if (!isPortableBuild()) return;
    const { exeDir, exeName } = getExePaths();
    if (!exeDir) return;

    const oldPath = path.join(exeDir, exeName + OLD_SUFFIX);
    const markerPath = path.join(exeDir, MARKER_NAME);
    const downloadPath = path.join(exeDir, exeName + DOWNLOAD_SUFFIX);

    safeUnlink(downloadPath); // U-06 相当。中断されたダウンロードの残骸は常に消してよい

    let hasOld = false;
    let oldAgeMs;
    try {
      const stat = fs.statSync(oldPath);
      hasOld = true;
      oldAgeMs = Date.now() - stat.mtimeMs;
    } catch (_) { /* 無い */ }

    const hasMarker = fs.existsSync(markerPath);
    const action = decideLeftover({ hasOld, hasMarker, oldAgeMs });

    if (action === 'none') return;
    if (action === 'keep') {
      logger.warn(`更新の後始末: 前回の入れ替えが完了しないまま終わった形跡がある。退避ファイルを残す: ${oldPath}`);
      return;
    }
    logger.info(`更新の後始末: 退避ファイルと完了の印を削除する: ${oldPath}`);
    safeUnlink(oldPath);
    safeUnlink(markerPath);
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
    cancelDownload,
    cleanupLeftovers,
    testConnection,
    openReleasePage,
  };
}

module.exports = { createUpdater };
