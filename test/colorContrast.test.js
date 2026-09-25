'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cc = require('../app/colorContrast');

test('contrastRatio: 白と黒は最大 (21:1 に近い)', () => {
  const ratio = cc.contrastRatio('#ffffff', '#000000');
  assert.ok(ratio > 20);
});

test('contrastRatio: 同色は 1:1', () => {
  assert.equal(Math.round(cc.contrastRatio('#1f4e8c', '#1f4e8c') * 100) / 100, 1);
});

test('pickTextColor: 暗い背景には白、明るい背景には黒系を選ぶ', () => {
  assert.equal(cc.pickTextColor('#1e2a3a'), '#ffffff');
  assert.equal(cc.pickTextColor('#faf8f5'), '#18150f');
  assert.equal(cc.pickTextColor('#ffffff'), '#18150f');
  assert.equal(cc.pickTextColor('#000000'), '#ffffff');
});

test('pickTextColor: 選んだ文字色は背景に対し十分なコントラストを持つ', () => {
  const backgrounds = ['#1e2a3a', '#f0ad4e', '#27ae60', '#faf8f5', '#fffef7', '#ffffff'];
  backgrounds.forEach(bg => {
    const text = cc.pickTextColor(bg);
    const ratio = cc.contrastRatio(bg, text);
    assert.ok(ratio >= 3, `${bg} に対する ${text} のコントラストが低すぎる (${ratio})`);
  });
});

test('hexToRgb: 3桁・6桁・8桁（アルファは無視）を解釈する', () => {
  assert.deepEqual(cc.hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(cc.hexToRgb('#1f4e8c'), { r: 31, g: 78, b: 140 });
  assert.deepEqual(cc.hexToRgb('#1f4e8cff'), { r: 31, g: 78, b: 140 });
  assert.equal(cc.hexToRgb('not-a-color'), null);
});
