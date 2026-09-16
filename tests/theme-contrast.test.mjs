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
function luminance(color) {
  assert.match(color, /^#[0-9a-f]{6}$/i);
  const rgb = color.slice(1).match(/../g).map((pair) => {
    const value = parseInt(pair, 16) / 255;
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
      const foreground = luminance(resolve(styles.color || 'var(--p-text)', palette));
      const background = luminance(resolve(styles.background, palette));
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      assert.ok(contrast >= 4.5, `Text contrast ${contrast.toFixed(2)}:1 is below WCAG AA 4.5:1`);
    });
  }
}