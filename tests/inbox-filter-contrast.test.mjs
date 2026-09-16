import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const themeCss = fs.readFileSync(new URL('../app/prototype/prototype.css', import.meta.url), 'utf8');
const studentCss = fs.readFileSync(new URL('../app/prototype/student.css', import.meta.url), 'utf8');

function declarations(block) {
  return Object.fromEntries([...block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
}

function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing rule: ${selector}`);
  return declarations(css.slice(start + selector.length + 2, css.indexOf('}', start)));
}

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const rgb = hex.slice(1).match(/../g).map((pair) => {
    const channel = parseInt(pair, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function resolve(value, theme) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, token) => {
    assert.ok(theme[token], `Missing token: ${token}`);
    return theme[token];
  });
}

const light = rule(themeCss, '.p-root');
const darkBlocks = [...themeCss.matchAll(/--p-bg:\s*#1c1c1e;[^}]+/g)];
assert.equal(darkBlocks.length, 2, 'Check explicit and system dark themes');
const themes = {
  light,
  dark: { ...light, ...declarations(darkBlocks[0][0]) },
  'system dark': { ...light, ...declarations(darkBlocks[1][0]) },
};

for (const [name, theme] of Object.entries(themes)) {
  for (const selected of [false, true]) {
    test(`${name}: ${selected ? 'selected' : 'unselected'} inbox filter meets WCAG AA text contrast`, () => {
      const button = {
        ...rule(studentCss, '.s-inbox-filters button'),
        ...(selected ? rule(studentCss, '.s-inbox-filters button.on') : {}),
      };
      const background = button.background === 'none'
        ? rule(studentCss, '.s-inbox-filters').background
        : button.background;
      const foregroundL = luminance(resolve(button.color, theme));
      const backgroundL = luminance(resolve(background, theme));
      const ratio = (Math.max(foregroundL, backgroundL) + 0.05) / (Math.min(foregroundL, backgroundL) + 0.05);
      assert.ok(ratio >= 4.5, `Contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
    });
  }
}