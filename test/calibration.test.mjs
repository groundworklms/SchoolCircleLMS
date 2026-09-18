import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE,
  MAX_CONFIDENCE,
  asFraction,
  calibrationNote,
  calibrationOf,
  stated,
} from '../lib/learning/calibration.js';

const at = (confidence, correct) => ({ confidence, correct });

test('the scale is the one the schema documents', () => {
  assert.deepEqual(CONFIDENCE.map((point) => point.value), [0, 1, 2, 3]);
  assert.equal(MAX_CONFIDENCE, 3);
  assert.match(CONFIDENCE[0].label, /guess/i);
});

/*
 * The rule the whole design rests on. lib/db.js records why no attempt was ever
 * written as a typed row: Attempt.confidence is NOT NULL, no surface asked for
 * it, and writing 0 to satisfy the column would publish a claim the learner
 * never made -- into the one field whose purpose is catching the confidently
 * wrong. An absent confidence must therefore never become a zero.
 */
test('only an integer on the scale counts as something a learner stated', () => {
  for (const value of [0, 1, 2, 3]) assert.equal(stated(value), true, String(value));
  for (const value of [-1, 4, 1.5, '2', null, undefined, NaN, true, {}]) {
    assert.equal(stated(value), false, JSON.stringify(value) ?? String(value));
  }
});

test('an unrated attempt is excluded rather than counted as a guess', () => {
  const summary = calibrationOf([at(3, false), { correct: true }, { correct: false, confidence: null }]);
  assert.equal(summary.rated, 1);
  assert.equal(summary.unrated, 2);
  assert.equal(summary.accuracy, 0, 'the one rated attempt was wrong');
  // If the two unrated attempts had been read as 0, confidence would be 1/3
  // rather than 1, and the overconfidence this learner is showing would vanish.
  assert.equal(summary.confidence, 1);
});

test('a course answered before any of this existed reports nothing, not zero calibration', () => {
  const summary = calibrationOf([{ correct: true }, { correct: false }]);
  assert.equal(summary.rated, 0);
  assert.equal(summary.unrated, 2);
  assert.equal(summary.gap, null);
  assert.equal(summary.accuracy, null, 'an accuracy over nothing is not a zero');
  assert.equal(summary.confidentlyWrong, 0);
});

test('the gap is confidence minus accuracy, both on the same scale', () => {
  // Certain on all four, right on two: perfectly confident, half right.
  const over = calibrationOf([at(3, true), at(3, true), at(3, false), at(3, false)]);
  assert.equal(over.confidence, 1);
  assert.equal(over.accuracy, 0.5);
  assert.equal(over.gap, 0.5);

  // The reverse: guessing throughout and right every time.
  const under = calibrationOf([at(0, true), at(0, true)]);
  assert.equal(under.gap, -1);

  // A calibrated learner: sure when right, unsure when wrong.
  const level = calibrationOf([at(3, true), at(3, true), at(0, false), at(0, false)]);
  assert.equal(level.gap, 0, 'the goal is calibration, not maximum confidence');
});

/* The measurement this feature exists for. */
test('confidently wrong counts only the committed half of the scale', () => {
  const summary = calibrationOf([
    at(3, false), // certain and wrong
    at(2, false), // fairly sure and wrong
    at(1, false), // unsure and wrong -- the learner is behaving correctly
    at(0, false), // guessing and wrong -- likewise
  ]);
  assert.equal(summary.confidentlyWrong, 2);
});

test('right-without-knowing-why is counted too, because a raw score flatters it', () => {
  const summary = calibrationOf([at(0, true), at(1, true), at(2, true), at(3, true)]);
  assert.equal(summary.accuracy, 1, 'a perfect score');
  assert.equal(summary.guessedRight, 2, 'half of which will not survive next week');
});

test('confidence stored on the result rather than the attempt is still read', () => {
  // The attempts route records a grade under `result`; older or nested shapes
  // must not silently become unrated.
  const summary = calibrationOf([{ result: { correct: false, confidence: 3 } }]);
  assert.equal(summary.rated, 1);
  assert.equal(summary.confidentlyWrong, 1);
});

test('asFraction refuses what stated refuses', () => {
  assert.equal(asFraction(0), 0);
  assert.equal(asFraction(3), 1);
  assert.equal(asFraction('3'), null);
  assert.equal(asFraction(undefined), null);
});

test('nothing at all is a summary, not a crash', () => {
  const summary = calibrationOf(null);
  assert.equal(summary.rated, 0);
  assert.deepEqual(calibrationOf([]).gap, null);
});

/* A claim off three answers is noise wearing a percentage, and showing one
   teaches a learner to distrust the number when it finally matters. */
test('no claim is made until there are enough answers to support one', () => {
  assert.equal(calibrationNote(calibrationOf([at(3, false), at(3, false)])), null);
  assert.equal(calibrationNote(null), null);
  assert.equal(calibrationNote({ rated: 0 }), null);
});

test('the note names the confidently wrong first, because they are the ones who will not go back', () => {
  const attempts = [...Array(7)].map(() => at(3, true)).concat([at(3, false)]);
  const note = calibrationNote(calibrationOf(attempts));
  assert.match(note, /sure and wrong on 1 question/);
  assert.match(note, /re-read/i);
});

test('overconfidence and underconfidence are told apart, and calibration is praised as itself', () => {
  const over = [...Array(8)].map((_, i) => at(3, i < 4));
  // Eight wrong-free answers at "guessing": right, and does not know it.
  const under = [...Array(8)].map(() => at(0, true));
  const level = [...Array(4)].map(() => at(3, true)).concat([...Array(4)].map(() => at(0, false)));

  assert.match(calibrationNote(calibrationOf(over)), /sure and wrong on 4/);
  assert.match(calibrationNote(calibrationOf(under)), /better than you think/);
  assert.match(calibrationNote(calibrationOf(level)), /trust your own sense/);
});
