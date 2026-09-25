'use strict';
// package.json と package-lock.json の食い違いを手元で気づけるようにするテスト。
//
// なぜ置いたか: v1.0.1 のタグで動いたリリースのワークフローが、Windows・macOS とも
// `npm ci` の段階で「Missing: uiohook-napi@1.5.5 from lock file」と失敗した。
// uiohook-napi を package.json に足したとき lock を作り直さずにコミットしたため、
// lock の根（packages[""]）に dependencies が無く、node_modules/uiohook-napi の項も無かった。
// `npm start` は手元の node_modules で動いてしまうので、タグを打つまで誰も気づけなかった。
// 直し方は `npm install` で lock を作り直すこと（lock を手で書かない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const lock = require(path.join(root, 'package-lock.json'));

const lockRoot = lock.packages[''];

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  test(`lock の根の ${field} が package.json と一致する（uiohook-napi が lock に無く npm ci が落ちた）`, () => {
    assert.deepEqual(lockRoot[field] || {}, pkg[field] || {});
  });

  for (const name of Object.keys(pkg[field] || {})) {
    test(`${field} の ${name} が lock の node_modules に解決されている`, () => {
      assert.ok(lock.packages[`node_modules/${name}`],
        `package-lock.json に node_modules/${name} がありません。npm install で lock を作り直してください`);
    });
  }
}

test('lock の版が package.json の版と一致する', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lockRoot.version, pkg.version);
});
