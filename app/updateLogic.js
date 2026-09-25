'use strict';
// 自動更新のうち、外の世界（通信・ファイル・時刻）に一切触れない判断だけを集めたもの。
// main.js 側（app/updater.js）はここの戻り値を見て通信・ファイル操作を行うだけにし、
// 「新しい版かどうか」「後始末してよいか」のような判断はすべてここを通す。
//
// なぜ分けるか: 参考にした Pane（/home/user/yu5rin/pane）の UpdateCheckLogic.cs で、
//   ・タグの "v" を落とし忘れてバージョンを読み取れず、確認が必ず失敗した
//   ・文字列比較だと "1.0.10" が "1.0.9" より古く見える
// という誤りが実際に起きている。判断部分を外の世界から切り離しておけば、値を渡して
// 戻り値を見るだけで test/updateLogic.test.js から確かめられる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaUpdateLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * バージョン表記を、比較できる4つ組にする。読めなければ null。
   *
   * 吸収するもの:
   *   ・先頭の半角 "v"/"V"（Git タグの慣習。"v1.0.4" → 1.0.4）
   *   ・"+<hash>" / "-beta" のような追記
   *   ・桁数の違い（"1.0.1" と "1.0.1.0" を同じものとして扱う。足りない桁は 0 で補う）
   *
   * 読めないもの:
   *   ・全角の "ｖ1.0.0" のようなタグ（先頭の全角ｖは落とさない。数字始まりでないため
   *     以降の正規表現に一致せず null になる。並び順に頼らず読めるものだけを見るのと同じ考え方）
   */
  function parseVersion(text) {
    if (typeof text !== 'string') return null;
    let s = text.trim();
    if (!s) return null;
    if (s[0] === 'v' || s[0] === 'V') s = s.slice(1);

    const plus = s.indexOf('+');
    if (plus >= 0) s = s.slice(0, plus);
    const hyphen = s.indexOf('-');
    if (hyphen >= 0) s = s.slice(0, hyphen);

    if (!/^\d+(\.\d+)*$/.test(s)) return null;

    const parts = s.split('.').map((n) => parseInt(n, 10));
    while (parts.length < 4) parts.push(0);
    if (parts.length > 4) return null; // 桁数が多すぎるものは読めないものとして扱う

    return { major: parts[0], minor: parts[1], patch: parts[2], build: parts[3] };
  }

  /** parseVersion() の戻り値どうしを比較する。a<b なら負、等しければ 0、a>b なら正。 */
  function compareVersionObjects(a, b) {
    const keys = ['major', 'minor', 'patch', 'build'];
    for (const key of keys) {
      if (a[key] !== b[key]) return a[key] - b[key];
    }
    return 0;
  }

  /** バージョン表記どうしを比較する。どちらかが読めなければ null。 */
  function compareVersions(aText, bText) {
    const a = parseVersion(aText);
    const b = parseVersion(bText);
    if (!a || !b) return null;
    return compareVersionObjects(a, b);
  }

  /** latestText は currentText より新しいか。どちらかが読めなければ null（=判断できない）。 */
  function isNewer(latestText, currentText) {
    const cmp = compareVersions(latestText, currentText);
    if (cmp === null) return null;
    return cmp > 0;
  }

  /** 2つのタグ表記が同じバージョンを指すか（"v1.0.2" と "1.0.2" は同じ扱い）。 */
  function isSameVersion(aText, bText) {
    const cmp = compareVersions(aText, bText);
    return cmp === 0;
  }

  /**
   * Atom フィードの xml から、いちばん新しいリリースのタグ名を取り出す。読めなければ null。
   *
   * 並び順に頼らず、読み取れたタグのうちバージョンとして最大のものを選ぶ。フィードは
   * 普通は新しい順に並ぶが、それに依存すると並びが変わったときに古い版を「最新」と
   * 判断してしまう。バージョンとして読めないタグ（下書き用の名前・全角ｖ等）は無視する。
   * タグ名はリリースページの URL（entry の link の href）の末尾に出る。
   */
  function extractLatestTagFromAtom(xml) {
    if (typeof xml !== 'string' || !xml) return null;
    try {
      const entryRe = /<entry\b[\s\S]*?<\/entry>/g;
      const linkRe = /<link\b[^>]*\bhref="([^"]*)"[^>]*\/?>/;

      let bestTag = null;
      let bestVersion = null;
      let entryMatch;
      while ((entryMatch = entryRe.exec(xml)) !== null) {
        const linkMatch = linkRe.exec(entryMatch[0]);
        if (!linkMatch) continue;
        const href = linkMatch[1];
        if (!href) continue;

        let tag;
        try {
          tag = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() || '');
        } catch (_) {
          continue; // 壊れた %エンコードは無視する
        }
        if (!tag) continue;

        const version = parseVersion(tag);
        if (!version) continue;
        if (bestVersion && compareVersionObjects(version, bestVersion) <= 0) continue;

        bestVersion = version;
        bestTag = tag;
      }
      return bestTag;
    } catch (_) {
      // 壊れた xml が返ってきても、呼び出し元は次の起動でまた試せる。ここでは黙って諦める。
      return null;
    }
  }

  /** releases.atom の URL から releases のベース URL を取り出す。形が違えば null。 */
  function releasesBaseUrl(feedUrl) {
    if (typeof feedUrl !== 'string' || !feedUrl.endsWith('.atom')) return null;
    return feedUrl.slice(0, -'.atom'.length);
  }

  /** 配布物（既定 Opesna.exe）のダウンロード URL を組み立てる。組み立てられなければ null。 */
  function buildDownloadUrl(feedUrl, tag, assetName) {
    const base = releasesBaseUrl(feedUrl);
    if (!base || !tag) return null;
    const name = assetName || 'Opesna.exe';
    return `${base}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  }

  /** SHA256 テキストファイル（配布物名 + ".sha256"）の URL を組み立てる。 */
  function buildShaUrl(feedUrl, tag, assetName) {
    const name = (assetName || 'Opesna.exe') + '.sha256';
    return buildDownloadUrl(feedUrl, tag, name);
  }

  /** あるタグのリリースページの URL を組み立てる。 */
  function buildReleasePageUrl(feedUrl, tag) {
    const base = releasesBaseUrl(feedUrl);
    if (!base || !tag) return null;
    return `${base}/tag/${encodeURIComponent(tag)}`;
  }

  /** 「いちばん新しいリリース」のページの URL を組み立てる（タグが分からないときの案内先）。 */
  function buildLatestReleasePageUrl(feedUrl) {
    const base = releasesBaseUrl(feedUrl);
    if (!base) return null;
    return `${base}/latest`;
  }

  /**
   * 前回の更新で退避した .old と、完了の印（opesna-update.ok）から、次回起動時に
   * とるべき行動を決める（Pane の UpdateLeftoverPolicy と同じ考え方）。
   *
   *   ・退避ファイルが無い                       → 'none'（何もしない）
   *   ・印がある                                  → 'delete'（両方消してよい）
   *   ・印は無いが 24 時間以上経っている           → 'delete'（実際には終わっていた古い残骸）
   *   ・印は無く、24 時間経っていない（読めない含む）→ 'keep'（消さずに残す。警告を出す）
   *
   * 迷ったら消さない側に倒す: 印を書く前に電源断・強制終了が起きると、.old は
   * 「欠けた本体を直す唯一の材料」になりうるため。
   */
  function decideLeftover({ hasOld, hasMarker, oldAgeMs } = {}) {
    if (!hasOld) return 'none';
    if (hasMarker) return 'delete';
    const STALE_MS = 24 * 60 * 60 * 1000;
    if (typeof oldAgeMs === 'number' && oldAgeMs >= STALE_MS) return 'delete';
    return 'keep';
  }

  /**
   * 起動時の帯（「新しい版 vX.Y.Z が利用できます」）を出してよいか。
   *
   *   ・控えた版（pendingTag）が無い                        → 出さない
   *   ・控えた版が今の版以下（すでに更新済み等）              → 出さない
   *   ・利用者がその版を［×］で閉じていた（dismissedTag と同じ）→ 出さない
   *   ・それ以外                                            → 出す
   */
  function shouldShowPending({ pendingTag, dismissedTag, currentVersion } = {}) {
    if (!pendingTag) return false;
    if (isNewer(pendingTag, currentVersion) !== true) return false;
    if (dismissedTag && isSameVersion(dismissedTag, pendingTag)) return false;
    return true;
  }

  /**
   * releases.atom の URL から、GitHub API の「あるタグのリリース情報」の URL を組み立てる。
   * https://github.com/{owner}/{repo}/releases.atom
   *   → https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}
   * github.com 以外の配布元や、owner/repo を取り出せない形なら null（呼び出し側は API を使わない）。
   */
  function buildApiReleaseUrl(feedUrl, tag) {
    if (typeof feedUrl !== 'string' || !tag) return null;
    let url;
    try {
      url = new URL(feedUrl);
    } catch (_) {
      return null;
    }
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const owner = parts[0];
    const repo = parts[1];
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`;
  }

  /**
   * GitHub API の releases/tags/{tag} が返す JSON から、入れ替えに使う exe アセットを選ぶ。
   * 見つからなければ null。digest（"sha256:<hex>"）が無い・形式が違う場合は sha256 を
   * 空文字にする（呼び出し側は「照合を省いて続行」の扱いにする。SHA256 を本文の Markdown
   * から読まないのは、本文は人が書き換えるものだから。仕様書 U-03 の注記と同じ判断）。
   */
  function findExeAsset(releaseJson, assetName) {
    const name = assetName || 'Opesna.exe';
    if (!releaseJson || !Array.isArray(releaseJson.assets)) return null;
    const asset = releaseJson.assets.find((a) => a && a.name === name);
    if (!asset) return null;
    const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '';
    if (!url) return null;

    let sha256 = '';
    if (typeof asset.digest === 'string') {
      const m = /^sha256:([0-9a-fA-F]{64})$/.exec(asset.digest.trim());
      if (m) sha256 = m[1].toLowerCase();
    }
    const size = typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : 0;
    return { url, sha256, size };
  }

  /** PowerShell の単一引用符文字列に埋め込むために、中の ' を '' へ二重化する。 */
  function quotePowerShellSingle(text) {
    return String(text == null ? '' : text).replace(/'/g, "''");
  }

  /**
   * ダウンロードが途中で切れていないかの判定（U-03 の追加チェック）。
   * Content-Length が分かる場合だけ、受け取ったバイト数と比べる。
   * Content-Length が無い・0以下（サーバーが返さない等）のときは判定できないので false（一致とみなす）。
   * SHA256 を API から取れず照合を省く経路では、これがダウンロードの完全性を確かめる唯一の手段になる。
   */
  function isDownloadSizeMismatch(receivedBytes, contentLength) {
    if (typeof contentLength !== 'number' || !Number.isFinite(contentLength) || contentLength <= 0) {
      return false;
    }
    return receivedBytes !== contentLength;
  }

  return {
    parseVersion,
    compareVersions,
    isNewer,
    isSameVersion,
    extractLatestTagFromAtom,
    buildDownloadUrl,
    buildShaUrl,
    buildReleasePageUrl,
    buildLatestReleasePageUrl,
    decideLeftover,
    shouldShowPending,
    buildApiReleaseUrl,
    findExeAsset,
    quotePowerShellSingle,
    isDownloadSizeMismatch,
  };
});
