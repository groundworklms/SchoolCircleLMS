/* The walkthrough script has two properties worth more than its prose:
 *
 *   1. every step points at an address the router actually serves, and
 *   2. the whole run fits inside the seven minutes we are given.
 *
 * Both fail silently otherwise -- a step aimed at a dead screen shows a
 * /not-found in front of the judges, and a script that runs long is only
 * discovered on stage. So they are asserted here rather than rehearsed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { href, parse } from '../app/prototype/routes.js';
import { NOT_FOUND_HREF } from '../app/prototype/routes.js';
import {
  ACTS,
  BUDGET_SECONDS,
  COURSE_TOKEN,
  STEPS,
  actIndexOf,
  actOf,
  budgetSeconds,
  formatClock,
  fullLocation,
  needsCourse,
  resolveLocation,
  startOffsetSeconds,
} from '../app/prototype/walkthrough-steps.js';

/* A LearningRecord id shaped like the real ones, for the course steps. */
const DEMO_COURSE = 'clx8s7d9k0000abcd1234efgh';

test('every step resolves to an address the router serves', () => {
  for (const step of STEPS) {
    const location = resolveLocation(step, DEMO_COURSE);
    assert.ok(location, `${step.id}: did not resolve`);
    const address = href(location);
    assert.notEqual(address, NOT_FOUND_HREF, `${step.id}: href is /not-found (${JSON.stringify(location)})`);
    assert.ok(address.startsWith('/prototype'), `${step.id}: unexpected path ${address}`);
  }
});

test('every step round-trips through parse, so the address means what it says', () => {
  for (const step of STEPS) {
    const location = resolveLocation(step, DEMO_COURSE);
    const reparsed = parse(href(location));
    assert.equal(reparsed.role, location.role, `${step.id}: role changed`);
    assert.equal(reparsed.area, location.area, `${step.id}: area changed`);
    if (location.courseId) {
      assert.equal(reparsed.courseId, location.courseId, `${step.id}: courseId changed`);
    }
    if (location.view) {
      assert.equal(reparsed.view, location.view, `${step.id}: view changed`);
    }
  }
});

/* Anti-vacuity: the address check above must be capable of failing. If this
   passes, a genuinely bad step would have been caught. */
test('the address check rejects a step aimed at a screen that does not exist', () => {
  const bogus = { id: 'bogus', location: { role: 'instructor', area: 'library', view: 'nonsense' } };
  const address = href(resolveLocation(bogus, DEMO_COURSE));
  assert.equal(address, NOT_FOUND_HREF, 'expected an invalid view to resolve to /not-found');
});

test('a course step without a resolved course refuses to navigate', () => {
  const courseStep = STEPS.find(needsCourse);
  assert.ok(courseStep, 'expected at least one step to need a course');
  assert.equal(resolveLocation(courseStep, null), null);
  assert.equal(resolveLocation(courseStep, ''), null);
});

test('the scripted run fits inside the budget', () => {
  const total = budgetSeconds();
  assert.ok(
    total < BUDGET_SECONDS,
    `script runs ${formatClock(total)}, budget is ${formatClock(BUDGET_SECONDS)}`,
  );
  /* Leave real slack for narration, not a one-second squeeze. */
  assert.ok(
    total <= BUDGET_SECONDS - 15,
    `script runs ${formatClock(total)}, needs at least 15s of slack under ${formatClock(BUDGET_SECONDS)}`,
  );
});

test('every act is covered, in order, with no interleaving', () => {
  const seen = STEPS.map((step) => actIndexOf(step));
  assert.ok(seen.every((index) => index >= 0), 'a step names an act that does not exist');

  /* Non-decreasing: the story never jumps back to an earlier act. */
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1], `step ${STEPS[i].id} goes back to an earlier act`);
  }

  const covered = new Set(seen);
  assert.equal(covered.size, ACTS.length, 'not every act has a step');
});

test("each step's role matches the act it belongs to", () => {
  for (const step of STEPS) {
    const act = actOf(step);
    assert.ok(act, `${step.id}: no act`);
    assert.equal(
      step.location.role,
      act.role,
      `${step.id}: is in the ${act.label} act (${act.role}) but navigates as ${step.location.role}`,
    );
  }
});

test('step ids are unique and every step has copy and a target', () => {
  const ids = new Set();
  for (const step of STEPS) {
    assert.ok(!ids.has(step.id), `duplicate step id ${step.id}`);
    ids.add(step.id);
    assert.ok(step.title?.trim(), `${step.id}: no title`);
    assert.ok(step.body?.trim(), `${step.id}: no body`);
    assert.ok(step.target?.trim(), `${step.id}: no target selector`);
    assert.ok(Number.isFinite(step.seconds) && step.seconds > 0, `${step.id}: bad seconds`);
  }
});

test('the four acts cover both roles and end on the instructor', () => {
  const roles = ACTS.map((act) => act.role);
  assert.ok(roles.includes('instructor'), 'no instructor act');
  assert.ok(roles.includes('student'), 'no student act');
  /* The close is what a judge remembers: the instructor seeing the evidence. */
  assert.equal(ACTS.at(-1).role, 'instructor');
  assert.equal(STEPS.at(-1).act, ACTS.at(-1).id);
});

test('fullLocation names every field the router reads', () => {
  const filled = fullLocation({ role: 'instructor', area: 'library', view: 'sources' });
  for (const key of ['role', 'area', 'courseId', 'view', 'lessonId', 'page', 'threadId']) {
    assert.ok(key in filled, `fullLocation omits ${key}`);
  }
  /* A stale lessonId must not survive into a library address. */
  const fromLesson = fullLocation({ role: 'instructor', area: 'library', view: 'courses' });
  assert.equal(fromLesson.lessonId, null);
  assert.equal(fromLesson.courseId, null);
});

test('startOffsetSeconds paces the script against the clock', () => {
  assert.equal(startOffsetSeconds(0), 0);
  assert.equal(startOffsetSeconds(1), STEPS[0].seconds);
  assert.equal(startOffsetSeconds(STEPS.length), budgetSeconds());
  assert.equal(startOffsetSeconds(-5), 0);
});

test('formatClock reads as a stopwatch', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(420), '7:00');
  assert.equal(formatClock(-3), '0:00');
});

test('the course token never leaks into a rendered address', () => {
  for (const step of STEPS) {
    const address = href(resolveLocation(step, DEMO_COURSE));
    assert.ok(!address.includes(COURSE_TOKEN), `${step.id}: unsubstituted course token in ${address}`);
  }
});

/* ----------------------- the other half of the contract ------------------- */

/* Proving a step points at a real address is only half of it: the highlight
   also has to have something to attach to. These assert the anchor side. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENT_ANCHORS, tourAnchor } from '../app/prototype/walkthrough-anchors.js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), 'utf8');

/** 'nav-sources' out of '[data-tour="nav-sources"]'. */
function anchorName(selector) {
  const match = /^\[data-tour="([^"]+)"\]$/.exec(selector);
  return match ? match[1] : null;
}

test('every step targets a data-tour anchor, written in the form the shells emit', () => {
  for (const step of STEPS) {
    const name = anchorName(step.target);
    assert.ok(name, `${step.id}: target ${step.target} is not a [data-tour="…"] selector`);
  }
});

test('every screen-level step matches the anchor its own route produces', () => {
  for (const step of STEPS) {
    const name = anchorName(step.target);
    if (ELEMENT_ANCHORS.has(name)) continue;
    const location = resolveLocation(step, DEMO_COURSE);
    assert.equal(
      tourAnchor(location),
      name,
      `${step.id}: targets "${name}" but ${location.role}/${location.area}/${location.view} renders `
        + `"${tourAnchor(location)}" — the highlight would never attach`,
    );
  }
});

/* Anti-vacuity for the anchor check: it must reject a mismatch. */
test('the anchor check rejects a step pointing at the wrong screen', () => {
  const mismatched = { id: 'wrong', location: { role: 'instructor', area: 'library', view: 'sources' } };
  const location = resolveLocation(mismatched, DEMO_COURSE);
  assert.notEqual(tourAnchor(location), 'course-aar', 'expected sources to not render the AAR anchor');
});

test('element-level anchors are actually rendered by a component', () => {
  /* Screen-level anchors come from the shells; these do not, so confirm the
     attribute really exists rather than trusting the set. */
  const chat = source('app/prototype/CourseChat.js');
  for (const name of ELEMENT_ANCHORS) {
    assert.ok(
      chat.includes(`data-tour="${name}"`),
      `${name} is listed as element-level but no component emits data-tour="${name}"`,
    );
  }
});

test('both shells render the anchor attribute from the shared module', () => {
  for (const file of ['app/prototype/InstructorShell.js', 'app/prototype/StudentShell.js']) {
    const text = source(file);
    assert.ok(text.includes('data-tour='), `${file}: no data-tour attribute`);
    assert.ok(
      text.includes("from './walkthrough-anchors'"),
      `${file}: must use the shared anchor module so the test and the app cannot disagree`,
    );
    assert.ok(
      !/function (instructor|student)TourAnchor/.test(text),
      `${file}: defines its own anchor function — the test would then verify a different copy`,
    );
  }
});

test('the account menu offers the tour on both sides of the account', () => {
  for (const file of ['app/prototype/InstructorShell.js', 'app/prototype/StudentShell.js']) {
    const text = source(file);
    assert.ok(text.includes('Guided tour'), `${file}: no Guided tour item in the account menu`);
    assert.ok(text.includes('tour.start'), `${file}: menu item does not call the provider's start`);
  }
});
