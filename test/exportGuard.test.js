'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../app/exportGuard');

test('isValidImageDataUrl: 許可した画像形式の data URL は true', () => {
  assert.equal(guard.isValidImageDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(guard.isValidImageDataUrl('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(guard.isValidImageDataUrl('data:image/webp;base64,UklGRg=='), true);
});

test('isValidImageDataUrl: 不正な値・script混入・svgは false', () => {
  assert.equal(guard.isValidImageDataUrl(null), false);
  assert.equal(guard.isValidImageDataUrl(''), false);
  assert.equal(guard.isValidImageDataUrl('not a data url'), false);
  assert.equal(guard.isValidImageDataUrl('javascript:alert(1)'), false);
  assert.equal(guard.isValidImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), false);
  assert.equal(guard.isValidImageDataUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(guard.isValidImageDataUrl('data:image/png;base64,not base64!!'), false);
});

test('isValidPngDataUrl: PNG のみ許可', () => {
  assert.equal(guard.isValidPngDataUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(guard.isValidPngDataUrl('data:image/jpeg;base64,/9j/4AAQ'), false);
});

test('sanitizeColor: #rgb/#rrggbb/#rrggbbaa は通し、不正値は既定色', () => {
  assert.equal(guard.sanitizeColor('#fff', '#000000'), '#fff');
  assert.equal(guard.sanitizeColor('#1f4e8c', '#000000'), '#1f4e8c');
  assert.equal(guard.sanitizeColor('#1f4e8cff', '#000000'), '#1f4e8cff');
  assert.equal(guard.sanitizeColor('red', '#000000'), '#000000');
  assert.equal(guard.sanitizeColor('expression(alert(1))', '#000000'), '#000000');
  assert.equal(guard.sanitizeColor(undefined, '#000000'), '#000000');
});

test('sanitizeFontSize: 8〜48に収め、数値でなければ既定値', () => {
  assert.equal(guard.sanitizeFontSize(13, 13), 13);
  assert.equal(guard.sanitizeFontSize(2, 13), 8);
  assert.equal(guard.sanitizeFontSize(100, 13), 48);
  assert.equal(guard.sanitizeFontSize('abc', 13), 13);
  assert.equal(guard.sanitizeFontSize(null, 13), 13);
});

test('sanitizeBadgeShape: 既知の値のみ通す', () => {
  assert.equal(guard.sanitizeBadgeShape('circle', 'circle'), 'circle');
  assert.equal(guard.sanitizeBadgeShape('square', 'circle'), 'square');
  assert.equal(guard.sanitizeBadgeShape('<script>', 'circle'), 'circle');
});

test('CSP_META: img-src data: のみ許可しscriptを禁止する', () => {
  assert.match(guard.CSP_META, /default-src 'none'/);
  assert.match(guard.CSP_META, /img-src data:/);
});
