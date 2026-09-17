import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const core = read('app/prototype/prototype.css');
const student = read('app/prototype/student.css');
const widgets = read('app/_components/widgets.css');
const declarations = (text) => Object.fromEntries(
  [...text.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]),
);
function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing selector: ${selector}`);
  return declarations(css.slice(start + selector.length + 2, css.indexOf('}', start)));
}
function themes(css, selector, marker) {
  const light = rule(css, selector);
  const dark = [...css.matchAll(new RegExp(`${marker}[^}]+`, 'g'))];
  assert.equal(dark.length, 2, 'Explicit and system-dark palettes must both exist');
  return [light, ...dark.map(([block]) => ({ ...light, ...declarations(block) }))];
}
const appThemes = themes(core, '.p-root', '--p-bg:\\s*#1c1c1e;');
const widgetThemes = themes(widgets, ':root', '--scw-surface:\\s*#2c2c2e;');
function resolve(color, tokens) {
  return color.replace(/var\((--[\w-]+)\)/g, (_, token) => {
    assert.ok(tokens[token], `Undefined color token: ${token}`);
    return tokens[token];
  });
}
function parseColor(color) {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const [r, g, b] = hex[1].match(/../g).map((pair) => parseInt(pair, 16));
    return { r, g, b, a: 1 };
  }
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  assert.ok(rgba, `Unsupported color: ${color}`);
  return {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}
function composite(color, backdrop) {
  const foreground = parseColor(color);
  if (foreground.a === 1) return foreground;
  const background = parseColor(backdrop);
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}
function luminance(color, backdrop = '#ffffff') {
  const { r, g, b } = composite(color, backdrop);
  const rgb = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const states = [
  [student, '.s-asg-head:hover'],
  [student, '.s-asg-row.open .s-asg-head'],
  [student, '.s-cal-day:hover'],
  [student, '.s-msg:hover'],
  [student, '.s-due-row:hover'],
  [student, '.s-module-head:hover'],
  [student, '.s-lesson:hover'],
  [student, '.s-inbox-filters button.on'],
  [student, '.s-inbox-filters button:hover'],
  [core, '.p-diff button.on'],
  [widgets, '.scw-cite', widgetThemes],
];
for (const [css, selector, palettes = appThemes] of states) {
  for (const [index, palette] of palettes.entries()) {
    test(`${selector} has readable text in ${['light', 'dark', 'system dark'][index]} theme`, () => {
      const styles = rule(css, selector);
      const backdrop = palette['--p-surface'] || palette['--scw-surface'] || '#ffffff';
      const foreground = luminance(resolve(styles.color || 'var(--p-text)', palette), backdrop);
      const background = luminance(resolve(styles.background, palette), backdrop);
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      assert.ok(contrast >= 4.5, `Text contrast ${contrast.toFixed(2)}:1 is below WCAG AA 4.5:1`);
    });
  }
}

const examTag = rule(student, '.s-root .p-examtag');
for (const [index, palette] of appThemes.entries()) {
  test(`student exam tag has readable text in ${['light', 'dark', 'system dark'][index]} theme`, () => {
    assert.equal(examTag.background, 'var(--p-warning-tint)');
    assert.equal(examTag['border-color'], 'var(--p-warning-border)');
    assert.equal(examTag.color, 'var(--p-warning-text)');
    const backdrop = palette['--p-surface'];
    const foreground = luminance(resolve(examTag.color, palette), backdrop);
    const background = luminance(resolve(examTag.background, palette), backdrop);
    const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(contrast >= 4.5, `Text contrast ${contrast.toFixed(2)}:1 is below WCAG AA 4.5:1`);
  });
}