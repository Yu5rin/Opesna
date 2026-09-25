'use strict';
// templates/*.json 全件のコントラストを確かめる（U3）。
// 本文・説明・見出し帯・バッジの文字色は、背景に対し WCAG のコントラスト比 4.5:1 以上を保つこと。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contrastRatio } = require('../app/colorContrast');
const { resolveTemplateColors } = require('../app/templateColors');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplates() {
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')));
}

test('templates/*.json が存在し、1件以上読み込める', () => {
  const templates = loadTemplates();
  assert.ok(templates.length > 0);
});

test('全テンプレート: 本文・見出しの文字色が背景に対し 4.5:1 以上', () => {
  loadTemplates().forEach(tmpl => {
    const t = resolveTemplateColors(tmpl);
    const bodyRatio = contrastRatio(t.background, t.textColor);
    assert.ok(bodyRatio >= 4.5, `${tmpl.id}: 本文のコントラストが低い (${bodyRatio.toFixed(2)})`);
  });
});

test('全テンプレート: 説明文（muted）の文字色が背景に対し 4.5:1 以上', () => {
  loadTemplates().forEach(tmpl => {
    const t = resolveTemplateColors(tmpl);
    const mutedRatio = contrastRatio(t.background, t.mutedColor);
    assert.ok(mutedRatio >= 4.5, `${tmpl.id}: 説明文のコントラストが低い (${mutedRatio.toFixed(2)})`);
  });
});

test('全テンプレート: 見出し帯（header）の文字色がheaderColorに対し 4.5:1 以上', () => {
  loadTemplates().forEach(tmpl => {
    const t = resolveTemplateColors(tmpl);
    const headerRatio = contrastRatio(t.headerColor, t.headerTextColor);
    assert.ok(headerRatio >= 4.5, `${tmpl.id}: 見出し帯のコントラストが低い (${headerRatio.toFixed(2)})`);
  });
});

test('全テンプレート: バッジの文字色がbadgeColorに対し 4.5:1 以上', () => {
  loadTemplates().forEach(tmpl => {
    const t = resolveTemplateColors(tmpl);
    const badgeRatio = contrastRatio(t.badgeColor, t.badgeTextColor);
    assert.ok(badgeRatio >= 4.5, `${tmpl.id}: バッジのコントラストが低い (${badgeRatio.toFixed(2)})`);
  });
});

test('business-dark: JSON と内蔵テンプレート(renderer.js の BUILTIN_TEMPLATES)の background が一致する', () => {
  const jsonTmpl = loadTemplates().find(t => t.id === 'business-dark');
  assert.ok(jsonTmpl, 'business-dark.json が見つからない');

  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer.js'), 'utf8');
  const m = /id:\s*'business-dark'[\s\S]*?background:\s*'(#[0-9a-fA-F]+)'/.exec(rendererSrc);
  assert.ok(m, 'renderer.js の BUILTIN_TEMPLATES に business-dark が見つからない');
  assert.equal(m[1], jsonTmpl.background, 'JSON（正）と内蔵テンプレートの background が食い違っている');
});

test('business-dark: 「暗い背景に明るい文字」として textColor/mutedColor が明示されている', () => {
  const jsonTmpl = loadTemplates().find(t => t.id === 'business-dark');
  assert.ok(typeof jsonTmpl.textColor === 'string' && jsonTmpl.textColor !== '');
  assert.ok(typeof jsonTmpl.mutedColor === 'string' && jsonTmpl.mutedColor !== '');
});
