'use strict';
// app/updateLogic.js（外の世界に触れない判断だけ）のテスト。
// 参考にした Pane（/home/user/yu5rin/pane）の Pane.Tests/UpdateCheckLogicTests.cs で
// 実際に起きた誤り（"v" の付け忘れ・文字列比較での桁の誤判定）と同じ種類の入力を確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../app/updateLogic');

// ─── parseVersion / compareVersions / isNewer ─────────────────────────────────

test('parseVersion: 先頭の v の有無を吸収する', () => {
  assert.deepEqual(parseVersion('v1.0.4'), { major: 1, minor: 0, patch: 4, build: 0 });
  assert.deepEqual(parseVersion('1.0.4'),  { major: 1, minor: 0, patch: 4, build: 0 });
  assert.deepEqual(parseVersion('V1.0.4'), { major: 1, minor: 0, patch: 4, build: 0 });
});

test('parseVersion: +hash / -beta を切り落とす', () => {
  assert.deepEqual(parseVersion('v1.2.3+abcdef'), { major: 1, minor: 2, patch: 3, build: 0 });
  assert.deepEqual(parseVersion('v1.2.3-beta'),   { major: 1, minor: 2, patch: 3, build: 0 });
});

test('parseVersion: 桁数の違いを 0 で補う', () => {
  assert.deepEqual(parseVersion('1.0.1'),   { major: 1, minor: 0, patch: 1, build: 0 });
  assert.deepEqual(parseVersion('1.0.1.0'), { major: 1, minor: 0, patch: 1, build: 0 });
});

test('parseVersion: 全角の「ｖ」は読めない（先頭の全角ｖは落とさない）', () => {
  assert.equal(parseVersion('ｖ1.0.0'), null);
});

test('parseVersion: 空・非文字列・数字で始まらないものは読めない', () => {
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion('release-candidate'), null);
});

test('compareVersions: 1.0.10 は 1.0.9 より新しい（文字列比較なら逆になる典型例）', () => {
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(isNewer('1.0.10', '1.0.9') === true);
});

test('isNewer: どちらかが読めなければ null（判断できない）', () => {
  assert.equal(isNewer('not-a-version', '1.0.0'), null);
  assert.equal(isNewer('1.0.0', 'not-a-version'), null);
});

test('isNewer: 同じ版は新しいとしない', () => {
  assert.equal(isNewer('v1.0.2', '1.0.2'), false);
});

test('isSameVersion: v の有無だけの違いは同じ扱い', () => {
  assert.equal(isSameVersion('v1.0.2', '1.0.2'), true);
  assert.equal(isSameVersion('v1.0.2', '1.0.3'), false);
});

// ─── extractLatestTagFromAtom ─────────────────────────────────────────────────

function atomWith(entries) {
  const items = entries
    .map((tag) => `<entry><link href="https://github.com/Yu5rin/Opesna/releases/tag/${tag}"/></entry>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">${items}</feed>`;
}

test('extractLatestTagFromAtom: 並び順どおり（新しい順）でも最大の版を選ぶ', () => {
  const xml = atomWith(['v1.0.9', 'v1.0.10', 'v1.0.8']);
  assert.equal(extractLatestTagFromAtom(xml), 'v1.0.10');
});

test('extractLatestTagFromAtom: 並びが逆転していても最大の版を選ぶ（並び順に頼らない）', () => {
  const xml = atomWith(['v1.0.1', 'v1.0.2', 'v1.0.10']); // 古い順に並んでいる想定
  assert.equal(extractLatestTagFromAtom(xml), 'v1.0.10');
});

test('extractLatestTagFromAtom: 読めないタグ（下書き名・全角ｖ）は無視する', () => {
  const xml = atomWith(['nightly-build', 'ｖ9.9.9', 'v1.2.0']);
  assert.equal(extractLatestTagFromAtom(xml), 'v1.2.0');
});

test('extractLatestTagFromAtom: 壊れた xml は null（例外を投げない）', () => {
  assert.equal(extractLatestTagFromAtom('<feed><entry><link href="'), null);
  assert.equal(extractLatestTagFromAtom(''), null);
  assert.equal(extractLatestTagFromAtom(null), null);
});

test('extractLatestTagFromAtom: entry が無ければ null', () => {
  assert.equal(extractLatestTagFromAtom('<feed></feed>'), null);
});

// ─── URL の組み立て ────────────────────────────────────────────────────────────

const FEED = 'https://github.com/Yu5rin/Opesna/releases.atom';

test('buildDownloadUrl: 規則どおりに組み立てる', () => {
  assert.equal(
    buildDownloadUrl(FEED, 'v1.2.3', 'Opesna.exe'),
    'https://github.com/Yu5rin/Opesna/releases/download/v1.2.3/Opesna.exe',
  );
});

test('buildDownloadUrl: assetName 省略時は既定で Opesna.exe', () => {
  assert.equal(
    buildDownloadUrl(FEED, 'v1.2.3'),
    'https://github.com/Yu5rin/Opesna/releases/download/v1.2.3/Opesna.exe',
  );
});

test('buildDownloadUrl: .atom で終わらない URL からは組み立てられない', () => {
  assert.equal(buildDownloadUrl('https://example.com/releases', 'v1.0.0'), null);
});

test('buildShaUrl: .sha256 を付けたファイル名になる', () => {
  assert.equal(
    buildShaUrl(FEED, 'v1.2.3'),
    'https://github.com/Yu5rin/Opesna/releases/download/v1.2.3/Opesna.exe.sha256',
  );
});

test('buildReleasePageUrl / buildLatestReleasePageUrl', () => {
  assert.equal(
    buildReleasePageUrl(FEED, 'v1.2.3'),
    'https://github.com/Yu5rin/Opesna/releases/tag/v1.2.3',
  );
  assert.equal(
    buildLatestReleasePageUrl(FEED),
    'https://github.com/Yu5rin/Opesna/releases/latest',
  );
});

// ─── 後始末（decideLeftover） ──────────────────────────────────────────────────

test('decideLeftover: 退避が無ければ none', () => {
  assert.equal(decideLeftover({ hasOld: false, hasMarker: false }), 'none');
});

test('decideLeftover: 完了の印があれば delete', () => {
  assert.equal(decideLeftover({ hasOld: true, hasMarker: true }), 'delete');
});

test('decideLeftover: 印が無く新しければ keep（警告して残す）', () => {
  assert.equal(decideLeftover({ hasOld: true, hasMarker: false, oldAgeMs: 60 * 1000 }), 'keep');
});

test('decideLeftover: 印が無く24時間以上経っていれば delete（実際には終わっていた古い残骸）', () => {
  const justOver = 24 * 60 * 60 * 1000 + 1000;
  assert.equal(decideLeftover({ hasOld: true, hasMarker: false, oldAgeMs: justOver }), 'delete');
});

test('decideLeftover: 印が無く経過時間が読めなければ keep（安全側）', () => {
  assert.equal(decideLeftover({ hasOld: true, hasMarker: false }), 'keep');
});

// ─── 起動時の帯（shouldShowPending） ───────────────────────────────────────────

test('shouldShowPending: 控えが無ければ出さない', () => {
  assert.equal(shouldShowPending({ pendingTag: null, currentVersion: '1.0.0' }), false);
});

test('shouldShowPending: 控えた版が今の版以下なら出さない（更新済み）', () => {
  assert.equal(
    shouldShowPending({ pendingTag: 'v1.0.0', dismissedTag: null, currentVersion: '1.0.0' }),
    false,
  );
  assert.equal(
    shouldShowPending({ pendingTag: 'v0.9.0', dismissedTag: null, currentVersion: '1.0.0' }),
    false,
  );
});

test('shouldShowPending: 閉じた版と同じなら出さない', () => {
  assert.equal(
    shouldShowPending({ pendingTag: 'v1.2.0', dismissedTag: 'v1.2.0', currentVersion: '1.0.0' }),
    false,
  );
});

test('shouldShowPending: それ以外は出す', () => {
  assert.equal(
    shouldShowPending({ pendingTag: 'v1.2.0', dismissedTag: 'v1.1.0', currentVersion: '1.0.0' }),
    true,
  );
  assert.equal(
    shouldShowPending({ pendingTag: 'v1.2.0', dismissedTag: null, currentVersion: '1.0.0' }),
    true,
  );
});

// ─── buildApiReleaseUrl ────────────────────────────────────────────────────────

test('buildApiReleaseUrl: releases.atom の URL から API の URL を組み立てる', () => {
  assert.equal(
    buildApiReleaseUrl(FEED, 'v1.2.3'),
    'https://api.github.com/repos/Yu5rin/Opesna/releases/tags/v1.2.3',
  );
});

test('buildApiReleaseUrl: github.com 以外や、組み立てられない形なら null', () => {
  assert.equal(buildApiReleaseUrl('https://example.com/Yu5rin/Opesna/releases.atom', 'v1.0.0'), null);
  assert.equal(buildApiReleaseUrl('not a url', 'v1.0.0'), null);
  assert.equal(buildApiReleaseUrl(FEED, ''), null);
  assert.equal(buildApiReleaseUrl(FEED, null), null);
});

// ─── findExeAsset ──────────────────────────────────────────────────────────────

test('findExeAsset: digest から sha256 を取り出す', () => {
  const hex = 'a'.repeat(64);
  const json = {
    assets: [
      { name: 'Opesna.exe', browser_download_url: 'https://…/Opesna.exe', digest: `sha256:${hex}`, size: 12345 },
    ],
  };
  assert.deepEqual(findExeAsset(json, 'Opesna.exe'), {
    url: 'https://…/Opesna.exe', sha256: hex, size: 12345,
  });
});

test('findExeAsset: digest が無い・形式が違う場合は sha256 を空にして続行する', () => {
  const noDigest = { assets: [{ name: 'Opesna.exe', browser_download_url: 'https://…/Opesna.exe', size: 100 }] };
  assert.deepEqual(findExeAsset(noDigest, 'Opesna.exe'), { url: 'https://…/Opesna.exe', sha256: '', size: 100 });

  const badDigest = { assets: [{ name: 'Opesna.exe', browser_download_url: 'https://…/Opesna.exe', digest: 'md5:abc', size: 100 }] };
  assert.deepEqual(findExeAsset(badDigest, 'Opesna.exe'), { url: 'https://…/Opesna.exe', sha256: '', size: 100 });
});

test('findExeAsset: 一致するアセットが無い・assets が無い場合は null', () => {
  assert.equal(findExeAsset({ assets: [{ name: 'other.zip', browser_download_url: 'https://…' }] }, 'Opesna.exe'), null);
  assert.equal(findExeAsset({}, 'Opesna.exe'), null);
  assert.equal(findExeAsset(null, 'Opesna.exe'), null);
});

test('findExeAsset: browser_download_url が無いアセットは選ばない', () => {
  assert.equal(findExeAsset({ assets: [{ name: 'Opesna.exe', digest: 'sha256:' + 'a'.repeat(64) }] }, 'Opesna.exe'), null);
});

// ─── PowerShell の引用 ─────────────────────────────────────────────────────────

test('quotePowerShellSingle: 単一引用符を二重化する', () => {
  assert.equal(quotePowerShellSingle("C:\\Users\\O'Brien\\Opesna.exe"), "C:\\Users\\O''Brien\\Opesna.exe");
  assert.equal(quotePowerShellSingle("it's"), "it''s");
  assert.equal(quotePowerShellSingle(''), '');
  assert.equal(quotePowerShellSingle(null), '');
});

// ─── ダウンロードのサイズ照合 ───────────────────────────────────────────────────
// SHA256 を API から取れず照合を省く経路（配布元が digest を返さない）では、
// Content-Length との一致確認がダウンロードの完全性を確かめる唯一の手段になる。

test('isDownloadSizeMismatch: 受信バイト数が Content-Length と一致すれば false', () => {
  assert.equal(isDownloadSizeMismatch(12345, 12345), false);
  assert.equal(isDownloadSizeMismatch(0, 0), false); // Content-Length 自体が 0 なら判定しない
});

test('isDownloadSizeMismatch: 途中で切れて受信バイト数が足りなければ true', () => {
  assert.equal(isDownloadSizeMismatch(1000, 12345), true);
});

test('isDownloadSizeMismatch: 受信バイト数が Content-Length を超えていても true（想定外の状態）', () => {
  assert.equal(isDownloadSizeMismatch(20000, 12345), true);
});

test('isDownloadSizeMismatch: Content-Length が無い・0以下・数値でないときは判定できないので false', () => {
  assert.equal(isDownloadSizeMismatch(12345, 0), false);
  assert.equal(isDownloadSizeMismatch(12345, -1), false);
  assert.equal(isDownloadSizeMismatch(12345, undefined), false);
  assert.equal(isDownloadSizeMismatch(12345, NaN), false);
  assert.equal(isDownloadSizeMismatch(12345, '12345'), false);
});
