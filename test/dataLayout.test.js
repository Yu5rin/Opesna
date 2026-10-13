'use strict';
// 保存場所の置き方（app/dataLayout.js）と、ログの置き場所（app/logger.js）のテスト。
// 引っ越しの判断は表で、ファイル操作は本物の一時フォルダで確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../app/dataLayout');
const { createLogger } = require('../app/logger');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opesna-layout-')); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }

test('shouldMigrate: 開発中（未パッケージで PORTABLE_EXECUTABLE_DIR も無い）は移さない', () => {
  assert.equal(L.shouldMigrate({ isPackaged: false }), false);
  assert.equal(L.shouldMigrate({ isPackaged: true }), true);
  assert.equal(L.shouldMigrate({ isPackaged: false, portableDir: 'C:\\x' }), true);
});

test('planMigration: 組み合わせごとの判断', () => {
  const t = (o, n, ol, nl) => L.planMigration({ oldConfig: o, newConfig: n, oldLogs: ol, newLogs: nl });
  assert.deepEqual(t(false, false, false, false), { config: 'none', logs: 'none' });
  assert.deepEqual(t(false, true, false, true), { config: 'none', logs: 'none' });
  assert.deepEqual(t(true, false, true, false), { config: 'move', logs: 'move' });
  assert.deepEqual(t(true, true, true, true), { config: 'keep-new', logs: 'merge' });
  assert.deepEqual(t(true, false, false, true), { config: 'move', logs: 'none' });
});

test('planLogMerge: 新しい方に無いものは移し、同名は寄せる', () => {
  assert.deepEqual(L.planLogMerge(['update.log', 'error.log'], ['update.log']),
    { move: ['error.log'], merge: ['update.log'] });
});

test('toStoredPath: data の中は相対（/ 区切り）、外は絶対のまま', () => {
  const data = path.join(path.sep, 'a', 'data');
  assert.equal(L.toStoredPath(path.join(data, 'projects', '仕事', 'x.opn'), data), 'projects/仕事/x.opn');
  const outside = path.join(path.sep, 'b', 'other', 'x.opn');
  assert.equal(L.toStoredPath(outside, data), outside);
  // 名前が似ているだけの別フォルダ（data2）は中とみなさない
  const near = path.join(path.sep, 'a', 'data2', 'x.opn');
  assert.equal(L.toStoredPath(near, data), near);
});

test('toStoredPath: Windows のパスでも data の中は相対にする', () => {
  const w = path.win32;
  assert.equal(L.toStoredPath('C:\\Apps\\Opesna\\data\\projects\\個人\\y.opn', 'C:\\Apps\\Opesna\\data', w), 'projects/個人/y.opn');
  assert.equal(L.toStoredPath('D:\\自分で保存\\y.opn', 'C:\\Apps\\Opesna\\data', w), 'D:\\自分で保存\\y.opn');
});

test('resolveStoredPath: 相対は今の data に付ける。不正な値は null', () => {
  const ctx = { dataDir: '/n/data', projectsDir: '/n/data/projects', exists: () => false };
  assert.equal(L.resolveStoredPath('projects/仕事/x.opn', ctx), path.join('/n/data', 'projects', '仕事', 'x.opn'));
  assert.equal(L.resolveStoredPath('../evil.opn', ctx), null);
  assert.equal(L.resolveStoredPath('', ctx), null);
  assert.equal(L.resolveStoredPath(42, ctx), null);
});

test('resolveStoredPath: 絶対パスはあればそのまま、無ければ data/projects でつなぎ直す', () => {
  const projects = '/n/data/projects';
  const present = new Set([path.join(projects, '仕事', 'x.opn'), '/other/keep.opn']);
  const ctx = { dataDir: '/n/data', projectsDir: projects, exists: p => present.has(p) };
  // あればそのまま
  assert.equal(L.resolveStoredPath('/other/keep.opn', ctx), '/other/keep.opn');
  // Windows の絶対パス（区切りは \）を、別の PC でつなぎ直す
  assert.equal(L.resolveStoredPath('C:\\Old\\Opesna\\data\\projects\\仕事\\x.opn', ctx), path.join(projects, '仕事', 'x.opn'));
  // 区切りが / でも同じ
  assert.equal(L.resolveStoredPath('/old/place/data/projects/仕事/x.opn', ctx), path.join(projects, '仕事', 'x.opn'));
  // つなぎ先にも無ければそのまま（後段で存在しないものとして落ちる）
  assert.equal(L.resolveStoredPath('C:\\Old\\data\\projects\\無い.opn', ctx), 'C:\\Old\\data\\projects\\無い.opn');
  // data/projects を含まない絶対パスで無いものもそのまま
  assert.equal(L.resolveStoredPath('E:\\外\\z.opn', ctx), 'E:\\外\\z.opn');
});

test('migrateLegacyLayout: 何も無ければ何もしない（data も作らない）', () => {
  const root = tmp();
  const r = L.migrateLegacyLayout({ fs, root, dataDir: path.join(root, 'data') });
  assert.deepEqual(r, { config: 'none', logs: 'none', errors: [], warnings: [] });
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
});

test('migrateLegacyLayout: config と logs をフォルダごと移す', () => {
  const root = tmp(); const data = path.join(root, 'data');
  write(path.join(root, 'config', 'settings.json'), '{"a":1}');
  write(path.join(root, 'logs', 'update.log'), 'old\n');
  write(path.join(data, 'projects', 'p.opn'), '{}');
  const r = L.migrateLegacyLayout({ fs, root, dataDir: data });
  assert.equal(r.config, 'moved'); assert.equal(r.logs, 'moved');
  assert.equal(fs.readFileSync(path.join(data, 'config', 'settings.json'), 'utf8'), '{"a":1}');
  assert.equal(fs.readFileSync(path.join(data, 'logs', 'update.log'), 'utf8'), 'old\n');
  assert.equal(fs.existsSync(path.join(root, 'config')), false);
  assert.equal(fs.existsSync(path.join(root, 'logs')), false);
  assert.equal(fs.existsSync(path.join(data, 'projects', 'p.opn')), true);
  // 2回目は何もしない
  assert.equal(L.migrateLegacyLayout({ fs, root, dataDir: data }).config, 'none');
});

test('migrateLegacyLayout: config が両方あれば data 側を正とし、古い方には触らない', () => {
  const root = tmp(); const data = path.join(root, 'data');
  write(path.join(root, 'config', 'settings.json'), 'OLD');
  write(path.join(data, 'config', 'settings.json'), 'NEW');
  const r = L.migrateLegacyLayout({ fs, root, dataDir: data });
  assert.equal(r.config, 'kept-new');
  assert.equal(r.warnings.length, 1);
  assert.equal(fs.readFileSync(path.join(data, 'config', 'settings.json'), 'utf8'), 'NEW');
  assert.equal(fs.readFileSync(path.join(root, 'config', 'settings.json'), 'utf8'), 'OLD');
});

test('migrateLegacyLayout: logs が両方あれば、無いものは移し、同名は古い中身を先頭へ足して古い方を消す', () => {
  const root = tmp(); const data = path.join(root, 'data');
  write(path.join(root, 'logs', 'update.log'), '古い行\n');
  write(path.join(root, 'logs', 'error.log'), 'エラー\n');
  write(path.join(data, 'logs', 'update.log'), '新しい行\n');
  const r = L.migrateLegacyLayout({ fs, root, dataDir: data });
  assert.equal(r.logs, 'merged');
  assert.equal(fs.readFileSync(path.join(data, 'logs', 'update.log'), 'utf8'), '古い行\n新しい行\n');
  assert.equal(fs.readFileSync(path.join(data, 'logs', 'error.log'), 'utf8'), 'エラー\n');
  assert.equal(fs.existsSync(path.join(root, 'logs')), false, '空になった古い logs は消える');
});

test('migrateLegacyLayout: rename が失敗したらコピーで代え、元を消す', () => {
  const root = tmp(); const data = path.join(root, 'data');
  write(path.join(root, 'config', 'recent.json'), '[]');
  const failingRename = Object.assign({}, fs, { renameSync() { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } });
  const r = L.migrateLegacyLayout({ fs: failingRename, root, dataDir: data });
  assert.equal(r.config, 'moved');
  assert.equal(fs.readFileSync(path.join(data, 'config', 'recent.json'), 'utf8'), '[]');
  assert.equal(fs.existsSync(path.join(root, 'config')), false);
});

test('migrateLegacyLayout: 移せなければ failed を返し、古いものは残す（例外は投げない）', () => {
  const root = tmp(); const data = path.join(root, 'data');
  write(path.join(root, 'config', 'recent.json'), '[]');
  const broken = Object.assign({}, fs, {
    renameSync() { throw new Error('busy'); },
    cpSync() { throw new Error('denied'); },
  });
  const r = L.migrateLegacyLayout({ fs: broken, root, dataDir: data });
  assert.equal(r.config, 'failed');
  assert.equal(r.errors.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'config', 'recent.json')), true);
  assert.equal(fs.existsSync(path.join(data, 'config')), false, '中途半端なコピーを残さない');
});

test('createLogger: ログは data フォルダの下の logs/ に書く', () => {
  const data = tmp();
  const log = createLogger(data, 'error.log');
  assert.equal(log.filePath, path.join(data, 'logs', 'error.log'));
  log.info('こんにちは');
  assert.match(fs.readFileSync(path.join(data, 'logs', 'error.log'), 'utf8'), /\[情報\] こんにちは/);
  assert.equal(createLogger(data).filePath, path.join(data, 'logs', 'update.log'));
});

test('createLogger: 関数で渡すと、書くたびにその時点の data フォルダを使う', () => {
  const a = tmp(); const b = tmp();
  let current = a;
  const log = createLogger(() => current);
  log.info('A');
  current = b;
  log.info('B');
  assert.equal(log.filePath, path.join(b, 'logs', 'update.log'));
  assert.match(fs.readFileSync(path.join(a, 'logs', 'update.log'), 'utf8'), /A/);
  assert.match(fs.readFileSync(path.join(b, 'logs', 'update.log'), 'utf8'), /B/);
});
