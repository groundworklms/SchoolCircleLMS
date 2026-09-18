import test from 'node:test';
import assert from 'node:assert/strict';
import { driftedTerms } from '../lib/learning/term-drift.js';
import { learnerCourseProjection } from '../lib/learning/core.js';

const SOURCE =
  'The combatant commanders are responsible for the planning and execution of joint operations. ' +
  'The operational level of war links tactical actions to strategic objectives. The Joint Staff ' +
  'supports the Chairman of the Joint Chiefs of Staff in advising the President.';

// ASTRA P4.1: section 5 says "combat commanders" four times.
test('a term rebuilt slightly wrong is reported with what the source says', () => {
  assert.deepEqual(driftedTerms('The combat commanders own joint operations.', SOURCE), [
    { used: 'combat commanders', source: 'combatant commanders' },
  ]);
});

test('the term written correctly is not reported', () => {
  assert.deepEqual(driftedTerms('The combatant commanders own joint operations.', SOURCE), []);
});

// The expensive false positive: a term is not wrong for being singular.
test('a plural or singular of the same term is the same term', () => {
  assert.deepEqual(driftedTerms('The combatant commander owns it.', SOURCE), []);
  assert.deepEqual(driftedTerms('The Joint Staff supports the Chairman.', SOURCE), []);
});

test('an ending that changes the meaning is drift, not inflection', () => {
  assert.deepEqual(driftedTerms('The operation level of war matters.', SOURCE), [
    { used: 'operation level', source: 'operational level' },
  ]);
});

test('unrelated prose is left alone', () => {
  assert.deepEqual(driftedTerms('The supply sergeant issues the gear before dawn.', SOURCE), []);
  assert.deepEqual(driftedTerms('', SOURCE), []);
  assert.deepEqual(driftedTerms('The combat commanders own it.', ''), []);
});

test('both words differing is two different words, not a drifted term', () => {
  assert.deepEqual(driftedTerms('The tactical commander owns it.', SOURCE), []);
});

test('a drifted term is reported once however often it is used', () => {
  const text = 'The combat commanders plan. The combat commanders execute. The combat commanders own it.';
  assert.equal(driftedTerms(text, SOURCE).length, 1);
});

test('drifted terms never reach a learner', () => {
  const wire = JSON.stringify(
    learnerCourseProjection({
      title: 'A course',
      sections: [
        {
          title: 'A section',
          cite: 'pub p.1',
          driftedTerms: [{ used: 'combat commanders', source: 'combatant commanders' }],
        },
      ],
    }),
  );
  assert.doesNotMatch(wire, /driftedTerms/);
});

/*
 * Every pair below was reported as drift by the live generation on
 * 2026-09-17, seven of them in one section, and every one is a single word in
 * two verb forms. A check that fires on every section teaches a reviewer to
 * skip its warnings, which costs more than the check saves.
 */
const LIVE =
  'Joint forces achieve objectives by exploiting tactical successes, preserving freedom of ' +
  'action, reducing vulnerability and securing positional advantage. The combatant commanders ' +
  'integrate across domains, necessitating changes that minimize human error and provide ' +
  'mobility. This includes operations at the operational level of war.';

test('two verb forms of one word are not drift', () => {
  for (const text of [
    'Joint forces achieving objectives.',
    'Successes preserve freedom of action.',
    'The force exploits tactical successes.',
    'Commanders minimizing human error.',
    'Necessitate changes across the force.',
    'It provides mobility and secures positional advantage.',
    'This including operations across domains.',
  ]) {
    assert.deepEqual(driftedTerms(text, LIVE), [], text);
  }
});

// The endings that change what a word means are still drift, which is the
// whole reason the check exists.
test('an ending that makes a different word is still reported', () => {
  assert.deepEqual(driftedTerms('The combat commanders integrate across domains.', LIVE), [
    { used: 'combat commanders', source: 'combatant commanders' },
  ]);
  assert.deepEqual(driftedTerms('At the operation level of war.', LIVE), [
    { used: 'operation level', source: 'operational level' },
  ]);
});

test('stemming cannot collapse short words into each other', () => {
  const source = 'The ship sails at dawn. The sale closes at noon.';
  assert.deepEqual(driftedTerms('The ships sail at dawn.', source), []);
});
