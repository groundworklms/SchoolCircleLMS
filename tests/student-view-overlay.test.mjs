import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Regression for the "Student view" bar (.p-studentview) covering the two
// bottom-right floating actions -- the "Ask" tutor chat (.s-chat-fab) and the
// "Report an issue" QA widget (.scw-fab.issue), the button testers are told
// to file bugs with (docs/gameday/WINPLAN.md). Measured on the live app,
// dark theme, viewport 773x392:
//
//   banner    left 57   right 717   top 303   bottom 376
//   chat fab  left 667  right 749   top 323   bottom 368   <- overlapped
//   issue fab left 703  right 754   top 260   bottom 311   <- overlapped
//
// Same pattern as theme-contrast.test.mjs: parse the actual CSS rather than
// re-typing constants, then check a measurable geometric fact.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const preview = read('app/prototype/instructor-preview.css');
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

// The app scales its whole UI off `font-size: calc(15px * var(--scale, 1))`
// (.s-root), and the measured rectangles above were taken at scale 1 -- so
// 1rem is 15px for the purpose of checking them.
const ROOT_PX = 15;
const rem = (value) => parseFloat(value) * ROOT_PX;

// A bottom offset is either a plain "1.6rem" or, once the student-view fix
// adds a lift, "calc(1.6rem + 8rem)". Sum whatever rem terms calc() joins.
function bottomOffsetPx(value) {
  const calc = value.match(/^calc\(([^)]+)\)$/);
  const terms = calc ? calc[1].split('+') : [value];
  return terms.reduce((sum, term) => sum + rem(term), 0);
}

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// ---- parse the rules involved ----
const banner = rule(preview, '.p-studentview');
const mainClearance = rule(preview, '.p-root:has(> .p-studentview) .s-main');
const chatFabBase = rule(student, '.s-chat-fab');
const issueFabBase = rule(widgets, '.scw-fab.issue');
const chatFabLifted = rule(preview, '.p-root:has(> .p-studentview) .s-chat-fab');
const issueFabLifted = rule(preview, 'body:has(.p-studentview) .scw-fab.issue');

test('the bar and both FABs each keep their base bottom offset unchanged elsewhere', () => {
  assert.equal(banner.bottom, '1.1rem');
  assert.equal(chatFabBase.bottom, '1.6rem');
  assert.equal(issueFabBase.bottom, '5.4rem');
});

test('both FABs are lifted by the same amount while the student-view bar is up', () => {
  const chatLift = bottomOffsetPx(chatFabLifted.bottom) - bottomOffsetPx(chatFabBase.bottom);
  const issueLift = bottomOffsetPx(issueFabLifted.bottom) - bottomOffsetPx(issueFabBase.bottom);
  assert.ok(chatLift > 0, 'chat FAB must move up while the bar is showing');
  assert.equal(chatLift, issueLift, 'a mismatched lift would close (or invert) the gap the two FABs keep from each other');
});

test('the FAB lift matches the clearance already budgeted for .s-main, so the two numbers cannot drift apart', () => {
  const chatLift = bottomOffsetPx(chatFabLifted.bottom) - bottomOffsetPx(chatFabBase.bottom);
  assert.equal(chatLift, rem(mainClearance['padding-bottom']));
});

// ---- reproduce the measured bug, then prove the fix clears it ----
// Rectangles as measured on the live app, dark theme, viewport 773x392.
const measured = {
  banner: { left: 57, right: 717, top: 303, bottom: 376 },
  chatFab: { left: 667, right: 749, top: 323, bottom: 368 },
  issueFab: { left: 703, right: 754, top: 260, bottom: 311 },
};

test('sanity: the measured rectangles reproduce the reported overlap before the fix', () => {
  assert.ok(overlaps(measured.banner, measured.chatFab), 'fixture no longer matches the reported bug (chat FAB)');
  assert.ok(overlaps(measured.banner, measured.issueFab), 'fixture no longer matches the reported bug (issue FAB)');
});

// Only the bottom offset changes -- shift each measured rectangle up by the
// same px amount the CSS now applies, keeping its measured size and horizontal
// position (the fix does not touch either).
function liftedRect(rect, liftPx) {
  return { left: rect.left, right: rect.right, top: rect.top - liftPx, bottom: rect.bottom - liftPx };
}

test('after the fix, neither FAB overlaps the student-view bar at the reported viewport', () => {
  const chatLiftPx = bottomOffsetPx(chatFabLifted.bottom) - bottomOffsetPx(chatFabBase.bottom);
  const issueLiftPx = bottomOffsetPx(issueFabLifted.bottom) - bottomOffsetPx(issueFabBase.bottom);

  const chatFab = liftedRect(measured.chatFab, chatLiftPx);
  const issueFab = liftedRect(measured.issueFab, issueLiftPx);

  assert.ok(!overlaps(measured.banner, chatFab), 'chat FAB still overlaps the bar');
  assert.ok(!overlaps(measured.banner, issueFab), 'issue FAB still overlaps the bar');
  assert.ok(chatFab.top >= 0 && issueFab.top >= 0, 'lifted FABs must stay on screen at this viewport height');
});

test('after the fix, the two FABs still keep clear of each other', () => {
  const chatLiftPx = bottomOffsetPx(chatFabLifted.bottom) - bottomOffsetPx(chatFabBase.bottom);
  const issueLiftPx = bottomOffsetPx(issueFabLifted.bottom) - bottomOffsetPx(issueFabBase.bottom);

  const chatFab = liftedRect(measured.chatFab, chatLiftPx);
  const issueFab = liftedRect(measured.issueFab, issueLiftPx);

  assert.ok(!overlaps(chatFab, issueFab));
});

test('the bar reserves scroll-content space at least as tall as its own worst-case footprint', () => {
  // Not a full layout re-derivation -- just guards against the clearance
  // shrinking below the bar's own bottom offset, which would put the two
  // numbers at odds with each other.
  assert.ok(rem(mainClearance['padding-bottom']) > rem(banner.bottom));
});
