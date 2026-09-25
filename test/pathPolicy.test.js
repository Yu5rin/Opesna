'use strict';
// IPC が受け付けてよいパスかどうかの判定（app/pathPolicy.js）を確かめるテスト。
//
// なぜ置いたか: 以前は save-project / open-project-by-path / show-item-in-folder が、
// renderer から渡された任意の文字列パスをそのまま使っており、PROJECTS_DIR の外のファイルでも
// 上書き・読み込み・エクスプローラー表示ができてしまった（S2）。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  isWithinDir,
  isPathInList,
  canSaveProject,
  canOpenProjectByPath,
  canShowInFolder,
} = require('../app/pathPolicy');

const PROJECTS_DIR = path.join('/data', 'projects');
const AUTOSAVE_DIR = path.join('/data', 'autosave');

test('isWithinDir: 配下のパスは true、外は false、パス区切りの取り違えを起こさない', () => {
  assert.equal(isWithinDir(path.join(PROJECTS_DIR, 'a.opn'), PROJECTS_DIR), true);
  assert.equal(isWithinDir(path.join(PROJECTS_DIR, '仕事', 'a.opn'), PROJECTS_DIR), true);
  assert.equal(isWithinDir(PROJECTS_DIR, PROJECTS_DIR), true);
  // "/data/projects-evil" は "/data/projects" で始まる文字列だが配下ではない
  assert.equal(isWithinDir('/data/projects-evil/a.opn', PROJECTS_DIR), false);
  assert.equal(isWithinDir('/etc/passwd', PROJECTS_DIR), false);
});

test('canSaveProject: PROJECTS_DIR 配下、またはセッション内で得たパスのみ許可', () => {
  assert.equal(canSaveProject(path.join(PROJECTS_DIR, 'a.opn'), { projectsDir: PROJECTS_DIR }), true);
  assert.equal(canSaveProject('/etc/passwd', { projectsDir: PROJECTS_DIR }), false);
  assert.equal(
    canSaveProject('/home/user/other/a.opn', {
      projectsDir: PROJECTS_DIR,
      sessionPaths: ['/home/user/other/a.opn'],
    }),
    true,
  );
  assert.equal(canSaveProject(null, { projectsDir: PROJECTS_DIR }), false);
  assert.equal(canSaveProject('', { projectsDir: PROJECTS_DIR }), false);
});

test('canOpenProjectByPath: 拡張子 .opn 必須。PROJECTS_DIR 配下・recent・session のいずれかで許可', () => {
  assert.equal(
    canOpenProjectByPath(path.join(PROJECTS_DIR, 'a.opn'), { projectsDir: PROJECTS_DIR }),
    true,
  );
  // 拡張子違い
  assert.equal(
    canOpenProjectByPath(path.join(PROJECTS_DIR, 'a.txt'), { projectsDir: PROJECTS_DIR }),
    false,
  );
  // PROJECTS_DIR 外でも recent.json 掲載なら許可
  assert.equal(
    canOpenProjectByPath('/home/user/other/a.opn', {
      projectsDir: PROJECTS_DIR,
      recentPaths: ['/home/user/other/a.opn'],
    }),
    true,
  );
  assert.equal(
    canOpenProjectByPath('/home/user/other/a.opn', { projectsDir: PROJECTS_DIR, recentPaths: [] }),
    false,
  );
});

test('canShowInFolder: セッションのパス・PROJECTS_DIR 配下・autosave 配下・recent のいずれかで許可', () => {
  assert.equal(
    canShowInFolder(path.join(AUTOSAVE_DIR, 'p1.opn'), {
      projectsDir: PROJECTS_DIR,
      autosaveDir: AUTOSAVE_DIR,
    }),
    true,
  );
  assert.equal(
    canShowInFolder('/tmp/random.pdf', {
      projectsDir: PROJECTS_DIR,
      autosaveDir: AUTOSAVE_DIR,
      sessionPaths: ['/tmp/random.pdf'], // export-pdf が返したパス
    }),
    true,
  );
  assert.equal(
    canShowInFolder('/tmp/random.pdf', { projectsDir: PROJECTS_DIR, autosaveDir: AUTOSAVE_DIR }),
    false,
  );
});

test('isPathInList: 一覧に無いものは false', () => {
  assert.equal(isPathInList('/a/b.opn', ['/a/c.opn']), false);
  assert.equal(isPathInList('/a/b.opn', ['/a/b.opn']), true);
  assert.equal(isPathInList('/a/b.opn', null), false);
});
