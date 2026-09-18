import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER,
  dueForReview,
  nextInterval,
  nextRung,
  reviewNote,
  reviewSchedule,
} from '../lib/learning/spacing.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const answer = (itemId, correct, confidence, days, objective = 'Plan') => ({
  itemId,
  correct,
  ...(confidence === undefined ? {} : { confidence }),
  answeredAt: ago(days),
  objective,
});

/*
 * The four quadrants. A schedule that only reads correctness treats the top
 * two rows as one thing and the bottom two as another, which throws away the
 * whole reason a confidence was asked for before the reveal.
 */
test('right and certain climbs the ladder; right while guessing holds its rung', () => {
  assert.equal(nextInterval({ correct: true, confidence: 3, rung: 0 }), LADDER[1]);
  assert.equal(nextInterval({ correct: true, confidence: 0, rung: 0 }), LADDER[0]);
  assert.equal(nextInterval({ correct: true, confidence: 1, rung: 2 }), LADDER[2], 'held, not climbed');
  assert.equal(nextInterval({ correct: true, confidence: 2, rung: 2 }), LADDER[3]);
});

test('confidently wrong comes back at the next sitting, not tomorrow', () => {
  // The worst state in the set: the learner is not missing the fact, they are
  // holding a wrong one confidently, and every day it sits is a rehearsal.
  assert.equal(nextInterval({ correct: false, confidence: 3, rung: 4 }), 0);
  assert.equal(nextInterval({ correct: false, confidence: 2, rung: 4 }), 0);
  // Wrong but they knew they did not know is an ordinary miss.
  assert.equal(nextInterval({ correct: false, confidence: 1, rung: 4 }), LADDER[0]);
  assert.equal(nextInterval({ correct: false, confidence: 0, rung: 4 }), LADDER[0]);
});

test('an unrated answer is scheduled on correctness alone, at the unsure interval', () => {
  // Never invented. "We do not know how sure they were" is less information
  // than "they told us", and the schedule must not pretend otherwise -- least
  // of all by reading the absence as 0, which would mean "guessing".
  assert.equal(nextInterval({ correct: true, rung: 3 }), LADDER[3], 'holds rather than climbing');
  assert.equal(nextInterval({ correct: false, rung: 3 }), LADDER[0], 'and is not treated as confidently wrong');
  assert.equal(nextInterval({ correct: false, confidence: '3', rung: 3 }), LADDER[0]);
});

test('a miss drops the rung to the bottom whatever it was', () => {
  assert.equal(nextRung({ correct: false, confidence: 3, rung: 4 }), 0);
  assert.equal(nextRung({ correct: true, confidence: 3, rung: 4 }), 4, 'and the ladder has a top');
  assert.equal(nextRung({ correct: true, confidence: 0, rung: 1 }), 1);
});

test('the ladder tops out rather than running away', () => {
  assert.equal(nextInterval({ correct: true, confidence: 3, rung: 99 }), LADDER[LADDER.length - 1]);
});

/* The rung is a running count, so the history has to be replayed in order. A
   schedule computed from the latest answer alone restarts every item at the
   bottom on every read. */
test('an item climbs across answers rather than being scored on the last one', () => {
  const schedule = reviewSchedule([
    answer('i1', true, 3, 30),
    answer('i1', true, 3, 20),
    answer('i1', true, 3, 10),
  ], { now: NOW });
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].rung, 3);
  assert.equal(schedule[0].intervalDays, LADDER[3]);
  assert.equal(schedule[0].answers, 3);
});

test('attempts are replayed in the order they were answered, not the order they arrive', () => {
  const shuffled = [answer('i1', true, 3, 10), answer('i1', false, 3, 30), answer('i1', true, 3, 20)];
  const schedule = reviewSchedule(shuffled, { now: NOW });
  // Ordered: wrong (rung 0), right+sure (1), right+sure (2).
  assert.equal(schedule[0].rung, 2);
});

test('a due date is measured from when the answer was given', () => {
  const [entry] = reviewSchedule([answer('i1', true, 3, 10)], { now: NOW });
  assert.equal(entry.intervalDays, LADDER[1]);
  assert.equal(entry.dueAt, NOW - 10 * DAY + LADDER[1] * DAY);
  assert.ok(entry.dueAt <= NOW, 'three days after an answer ten days ago is overdue');
});

test('an item answered well and recently is not due', () => {
  const due = dueForReview([answer('i1', true, 3, 0)], { now: NOW });
  assert.deepEqual(due, []);
});

test('an item the learner has never answered is not overdue, it is unstudied', () => {
  assert.deepEqual(reviewSchedule([], { now: NOW }), []);
  assert.deepEqual(reviewSchedule(null, { now: NOW }), []);
  assert.deepEqual(reviewSchedule([{ correct: true }], { now: NOW }), [], 'no item id, no schedule');
});

/*
 * The ordering is the feature. A learner with twenty overdue items will do the
 * first five, so the first five have to be the ones that matter -- sorting
 * purely by due date buries a rehearsed wrong fact behind a fortnight of easy
 * ones.
 */
test('the queue leads with what the learner was sure about and wrong', () => {
  const due = dueForReview([
    answer('old-right', true, 0, 40),
    answer('ordinary-miss', false, 1, 5),
    answer('sure-and-wrong', false, 3, 2),
    answer('older-miss', false, 0, 20),
  ], { now: NOW });
  assert.equal(due[0].itemId, 'sure-and-wrong');
  // Then the other misses, oldest first, then anything merely due.
  assert.deepEqual(due.slice(1).map((entry) => entry.itemId), ['older-miss', 'ordinary-miss', 'old-right']);
});

test('the queue can be capped without losing the ordering', () => {
  const due = dueForReview([
    answer('a', true, 0, 40),
    answer('b', false, 3, 2),
  ], { now: NOW, limit: 1 });
  assert.deepEqual(due.map((entry) => entry.itemId), ['b']);
});

test('confidence recorded on the result rather than the attempt still counts', () => {
  const [entry] = reviewSchedule(
    [{ itemId: 'i1', answeredAt: ago(1), result: { correct: false, confidence: 3 } }],
    { now: NOW },
  );
  assert.equal(entry.intervalDays, 0, 'confidently wrong, however the record spells it');
});

test('nothing due says nothing, rather than filling the screen', () => {
  assert.equal(reviewNote([]), null);
  assert.equal(reviewNote(null), null);
});

test('the note names the confidently wrong when there are any', () => {
  const due = dueForReview([answer('a', false, 3, 2), answer('b', false, 0, 3)], { now: NOW });
  assert.match(reviewNote(due), /2 due/);
  assert.match(reviewNote(due), /sure about and got wrong/);
  const plain = dueForReview([answer('b', false, 0, 3)], { now: NOW });
  assert.equal(reviewNote(plain), '1 due for review.');
});
