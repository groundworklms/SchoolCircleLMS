import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Regression for the "Student view" marker (.p-studentview). It used to be a
// fixed box floating over the bottom-centre of the learner shell, which covered
// content (a lesson list lost its last rows) and clipped the two bottom-right
// floating actions -- the "Ask" tutor chat (.s-chat-fab) and the "Report an
// issue" QA widget (.scw-fab.issue).
//
// The fix stops it floating at all: it is now a bar in .p-root's column flow,
// placed above the shell, so it reserves its own height and the shell (.s-root,
// flex:1) shrinks beneath it. A bar that bounds the content instead of covering
// it cannot overlap anything -- and because it sits at the top, it is nowhere
// near the bottom-right corner the FABs and tutor panel are pinned to, so the
// old per-FAB lift hacks are gone.
//
// As before: parse the actual CSS rather than re-typing constants, then check
// facts about the rules, not pixels.

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const preview = read('app/prototype/instructor-preview.css');
const student = read('app/prototype/student.css');
const widgets = read('app/_components/widgets.css');
const prototypeJs = read('app/prototype/Prototype.js');

const declarations = (text) => Object.fromEntries(
  [...text.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]),
);
function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing selector: ${selector}`);
  return declarations(css.slice(start + selector.length + 2, css.indexOf('}', start)));
}
function maybeRule(css, selector) {
  return css.includes(`${selector} {`);
}

const marker = rule(preview, '.p-studentview');

test('the marker sits in normal flow, so it reserves space instead of floating over content', () => {
  // A floating box is what covered the lesson list and clipped the tutor panel.
  assert.notEqual(marker.position, 'fixed');
  assert.notEqual(marker.position, 'absolute');
  // No bottom offset that would drop it into the bottom-right FAB corner.
  assert.equal(marker.bottom, undefined);
  // flex:none in .p-root's column keeps it from stealing the shell's height.
  assert.equal(marker.flex, 'none');
});

test('the marker anchors at the top of the shell, away from the bottom-right actions', () => {
  // A bottom border separates it from the shell beneath; it renders before the
  // shell in the column (Prototype.js) so the scroll region starts below it.
  assert.match(marker['border-bottom'] || '', /var\(--p-border\)/);
  const bannerIndex = prototypeJs.indexOf('p-studentview');
  const shellIndex = prototypeJs.indexOf('<StudentShell');
  assert.ok(bannerIndex >= 0 && shellIndex >= 0);
  assert.ok(bannerIndex < shellIndex, 'the marker must render before the shell so it reserves space above it');
});

test('the marker reads as information, not an error: neutral tokens, no accent red', () => {
  const accentText = [marker.background, marker['border-left'], marker['border-bottom'], marker.color]
    .filter(Boolean)
    .join(' ');
  assert.doesNotMatch(accentText, /--p-accent/, 'the red accent tokens read as an alert on a full-width bar');
  // A neutral surface and a quiet slate rule, both existing --p-* tokens.
  assert.match(marker.background || '', /var\(--p-surface-2\)/);
  assert.match(marker['border-left'] || '', /var\(--p-seq-600\)/);
});

test('the bottom-right actions are left untouched: no lift hacks, base offsets intact', () => {
  // With the marker at the top, nothing has to move the FABs or pad the shell.
  assert.equal(maybeRule(preview, '.p-root:has(> .p-studentview) .s-chat-fab'), false);
  assert.equal(maybeRule(preview, 'body:has(.p-studentview) .scw-fab.issue'), false);
  assert.equal(maybeRule(preview, '.p-root:has(> .p-studentview) .s-main'), false);
  // And the FABs the redesign no longer disturbs still carry their own offsets.
  assert.equal(rule(student, '.s-chat-fab').bottom, '1.6rem');
  assert.equal(rule(widgets, '.scw-fab.issue').bottom, '5.4rem');
});

test('the marker no longer duplicates the rail\'s "View as instructor" control', () => {
  // The rail already offers the switch-back button; the banner just explains.
  const bannerBlock = prototypeJs.slice(
    prototypeJs.indexOf('p-studentview'),
    prototypeJs.indexOf('<StudentShell'),
  );
  assert.doesNotMatch(bannerBlock, /<button/, 'the banner should not carry a second back-to-instructor button');
});
