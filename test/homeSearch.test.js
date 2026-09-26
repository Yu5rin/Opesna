'use strict';
// ホームの「プロジェクトを探す」絞り込み（app/homeSearch.js）のテスト。

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesQuery, filterProjectsByQuery } = require('../app/homeSearch.js');

test('matchesQuery: 空の検索語は常に一致する', () => {
  assert.equal(matchesQuery('経費精算の申請手順', ''), true);
  assert.equal(matchesQuery('経費精算の申請手順', '   '), true);
});

test('matchesQuery: 部分一致する', () => {
  assert.equal(matchesQuery('経費精算の申請手順', '申請'), true);
  assert.equal(matchesQuery('経費精算の申請手順', '存在しない語'), false);
});

test('matchesQuery: 大文字小文字を区別しない', () => {
  assert.equal(matchesQuery('Expense Report', 'expense'), true);
  assert.equal(matchesQuery('expense report', 'EXPENSE'), true);
});

test('matchesQuery: 全角半角を区別しない', () => {
  assert.equal(matchesQuery('ＰＲ手順', 'PR'), true);
  assert.equal(matchesQuery('PR手順', 'ＰＲ'), true);
  assert.equal(matchesQuery('経費123手順', '１２３'), true);
});

test('matchesQuery: 名前がなくても例外を投げない', () => {
  assert.equal(matchesQuery(undefined, 'a'), false);
  assert.equal(matchesQuery(null, ''), true);
});

test('filterProjectsByQuery: 名前で絞り込む', () => {
  const projects = [{ name: '経費精算の申請手順' }, { name: '勤怠システムの打刻修正' }];
  assert.deepEqual(filterProjectsByQuery(projects, '経費'), [projects[0]]);
  assert.deepEqual(filterProjectsByQuery(projects, ''), projects);
  assert.deepEqual(filterProjectsByQuery(projects, '一致しない'), []);
});
