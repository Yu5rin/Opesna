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
  isDownloadSizeMismatch,
  buildWaiterArgs,
} = require('./updateLogic');

const ASSET_NAME = 'Opesna.exe';
const MARKER_NAME = 'opesna-update.ok';
const FAILED_MARKER_NAME = 'opesna-update.failed';
const DOWNLOAD_SUFFIX = '.download';
const OLD_SUFFIX = '.old';

const TOTAL_CHECK_TIMEOUT_MS = 20000; // 仕様書 U-07b: 全体20秒
const ATOM_TIMEOUT_MS = 8000;         // 仕様書 U-07b: Atom単体8秒
const RESPONSE_TIMEOUT_MS = 30000;    // 応答（ヘッダー）が来るまでの上限。実機で応答なしのまま
                                       // 止まった例があったため、本体の受信（10分）とは別に短く切る
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const CONNECTION_TEST_TIMEOUT_MS = 20000;
const MIN_DOWNLOAD_BYTES = 1024 * 1024; // 1MB 未満は中止（U-03）

// ─── 待ち役（PowerShell）のスクリプト本体 ─────────────────────────────────────────
//
// なぜアプリの中で rename しないか（実機のログで判明した経緯）:
//   配布物はポータブル exe（NSIS の自己展開）。起動すると本体を一時フォルダへ展開して
//   起動し、自分（展開役）は本体の終了を待ち続けるが、そのあいだ自分自身の exe ファイルを
//   削除・改名を許さない共有モードで開いたままにしている。そのためアプリが動いている間は
//   Opesna.exe の rename が必ず EBUSY で失敗する（参考にした Pane は .NET の単一ファイル exe で
//   実行中でも改名が許される作りだったため、同じ手順が移植時にそのまま通っていた）。
//   そこで入れ替えはアプリの中でやめ、アプリ本体と展開役の両方が終わったあとに、
//   分離した待ち役（この PowerShell スクリプト）が行う。
//
// パスなどはすべて -File の引数（app/updateLogic.js の buildWaiterArgs）として渡し、
// スクリプト自身には埋め込まない。実行時に fs.mkdtempSync() の中へ書き出して -File で使う
// （固定の -Command 文字列にすると、パスの引用が絡んで壊れやすいため）。
const WAITER_SCRIPT = `
param(
  [int]$MainPid = 0,
  [int]$ParentPid = 0,
  [string]$ExePath,
  [string]$DownloadPath,
  [string]$OldPath,
  [string]$MarkerOkPath,
  [string]$MarkerFailedPath,
  [string]$LogPath,
  [int]$RetryCount = 20,
  [int]$RetryIntervalMs = 500,
  [int]$WaitTimeoutSec = 60
)

function Write-OpesnaLog([string]$Level, [string]$Message) {
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    # 既存の update.log（Node 側が UTF-8・BOM無しで書いている）に揃えるため、
    # Add-Content ではなく .NET の File.AppendAllText を使う（BOM を足さないため）。
    $line = ('{0} [{1}] {2}' -f (Get-Date).ToString('o'), $Level, $Message) + "\`r\`n"
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($LogPath, $line, $enc)
  } catch {
    # ログが書けなくても入れ替え自体は続ける
  }
}

Write-OpesnaLog '情報' ('更新の待ち役を起動した(本体PID={0}, 展開役PID={1})' -f $MainPid, $ParentPid)

# 本体（Electron のメインプロセス）と展開役（NSIS の自己展開部分）の両方が終わるまで待つ。
# 一方または両方がすでに終わっていても Wait-Process は例外を投げるので黙って続行する。
$idsToWait = @($MainPid, $ParentPid) | Where-Object { $_ -gt 0 } | Select-Object -Unique
if ($idsToWait.Count -gt 0) {
  Wait-Process -Id $idsToWait -Timeout $WaitTimeoutSec -ErrorAction SilentlyContinue
}

$exeLeaf = Split-Path -Leaf $ExePath
$oldLeaf = Split-Path -Leaf $OldPath

$succeeded = $false
$lastErrorMessage = $null

for ($i = 0; $i -lt $RetryCount; $i++) {
  $movedExeToOld = $false
  try {
    # 前回の残骸（今回のループの中で作ったものではない .old）だけをここで消す。
    if (Test-Path -LiteralPath $OldPath) {
      Remove-Item -LiteralPath $OldPath -Force -ErrorAction Stop
    }
    Rename-Item -LiteralPath $ExePath -NewName $oldLeaf -Force -ErrorAction Stop
    $movedExeToOld = $true
    Rename-Item -LiteralPath $DownloadPath -NewName $exeLeaf -Force -ErrorAction Stop
    $succeeded = $true
    break
  } catch {
    $lastErrorMessage = $_.Exception.Message
    # このループの中で exe を .old へ動かした直後に失敗したなら、次の再試行の前に
    # 必ず元へ戻す（.old を「欠けた本体を直す唯一の材料」として残しておくため。
    # ここで戻さずに次の周回で .old を消してしまうと、本体そのものが消えたままになる）。
    if ($movedExeToOld -and -not (Test-Path -LiteralPath $ExePath) -and (Test-Path -LiteralPath $OldPath)) {
      try { Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop } catch { }
    }
    if ($i -lt ($RetryCount - 1)) {
      Start-Sleep -Milliseconds $RetryIntervalMs
    }
  }
}

if ($succeeded) {
  try { [System.IO.File]::WriteAllText($MarkerOkPath, '') } catch { }
  Write-OpesnaLog '情報' '更新の適用: 入れ替えが完了した'
  try { Start-Process -FilePath $ExePath } catch {
    Write-OpesnaLog 'エラー' ('更新: 新しい版の起動に失敗した: {0}' -f $_.Exception.Message)
  }
} else {
  $reason = if ($lastErrorMessage) { $lastErrorMessage } else { '不明なエラー' }
  # 保険: ここまでの再試行で元へ戻せていなければ、最後にもう一度だけ確かめる
  # （利用者が気づかないまま Opesna が消えた状態にしないため）。
  if (-not (Test-Path -LiteralPath $ExePath) -and (Test-Path -LiteralPath $OldPath)) {
    try {
      Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop
      Write-OpesnaLog '警告' '更新の適用に失敗したため、元の版へ戻した'
    } catch {
      Write-OpesnaLog 'エラー' ('更新の適用に失敗し、元の版へ戻すこともできなかった: {0}' -f $_.Exception.Message)
    }
  }
  try {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($MarkerFailedPath, ('入れ替えに失敗しました: {0}' -f $reason), $enc)
  } catch { }
  Write-OpesnaLog 'エラー' ('更新の適用に失敗した: {0}' -f $reason)
  try { Start-Process -FilePath $ExePath } catch {
    Write-OpesnaLog 'エラー' ('更新: 元の版の再起動に失敗した: {0}' -f $_.Exception.Message)
  }
}
`;

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
    return '予期しないエラーが発生しました。詳しくはログ（logs/update.log）を確認してください。';
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
      const waiterStarted = spawnWaiterAndRelaunch({ exeDir, exePath, downloadPath, oldPath });
      if (!waiterStarted) {
        safeUnlink(downloadPath);
        return { ok: false, reason: 'waiter-failed', message: '入れ替えの準備に失敗しました。詳しくはログ（logs/update.log）を確認してください。' };
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
   * @returns {boolean} 待ち役を起動できたか
   */
  function spawnWaiterAndRelaunch({ exeDir, exePath, downloadPath, oldPath }) {
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
    });

    logger.info(`更新: 再起動の待ち役を起動する(本体PID=${mainPid}, 展開役PID=${parentPid})`);
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
   * @returns {{applyFailure: null | {message: string, detail: string}}}
   *   前回の入れ替えに失敗した形跡（待ち役が書いた失敗の印）があれば applyFailure に入る。
   *   呼び出し側（main.js）はこれを見て、画面に手動での入れ替えを案内する。
   */
  function cleanupLeftovers() {
    if (!isPortableBuild()) return { applyFailure: null };
    const { exeDir, exeName } = getExePaths();
    if (!exeDir) return { applyFailure: null };

    const oldPath = path.join(exeDir, exeName + OLD_SUFFIX);
    const markerPath = path.join(exeDir, MARKER_NAME);
    const failedMarkerPath = path.join(exeDir, FAILED_MARKER_NAME);
    const downloadPath = path.join(exeDir, exeName + DOWNLOAD_SUFFIX);

    safeUnlink(downloadPath); // U-06 相当。中断されたダウンロードの残骸は常に消してよい

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

    if (action === 'none') return { applyFailure };
    if (action === 'keep') {
      logger.warn(`更新の後始末: 前回の入れ替えが完了しないまま終わった形跡がある。退避ファイルを残す: ${oldPath}`);
      return { applyFailure };
    }
    logger.info(`更新の後始末: 退避ファイルと完了の印を削除する: ${oldPath}`);
    safeUnlink(oldPath);
    safeUnlink(markerPath);
    return { applyFailure };
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
