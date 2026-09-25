'use strict';
// hidden 属性が styles.css の display 指定に負けない規則があるかを確かめるテスト。
//
// なぜ必要か: #update-banner は hidden 属性で隠していたが、.update-banner に
// display:flex が指定されていたため（詳細度は属性セレクタと同じでも、CSS の
// 後勝ちルールで class 側が勝つ）、hidden を付けても常に表示され、更新の帯が
// エディタのメインツールバーを覆い隠していた。styles.css に
// `[hidden] { display: none !important; }` を置いて、hidden 属性が常に
// 最優先で効くようにした。この規則が消えると同じ不具合が再発するため、
// 存在することをここで確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'app', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

test('styles.css に [hidden] を !important で display:none にする規則がある', () => {
  const rule = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/;
  assert.ok(
    rule.test(css),
    'styles.css に "[hidden] { display: none !important; }" が見つからない。' +
      'これが無いと、hidden 属性を付けた要素も class の display 指定で表示されてしまう'
  );
});
