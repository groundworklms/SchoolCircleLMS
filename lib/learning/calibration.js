/**
 * Confidence stated before the reveal, and what it is worth afterwards.
 *
 * WHY THIS EXISTS. A normal quiz reports one number per learner, and that
 * number hides the difference between the two failures that need opposite
 * responses. A learner who guessed and missed knows they do not know it; they
 * need the material again. A learner who was certain and missed does not know
 * they are wrong, will not re-read anything, and will carry the error into a
 * rehearsal. The second is the dangerous one and a percentage cannot see it.
 *
 * Separating them needs exactly one fact a score does not carry: how sure the
 * learner was BEFORE they saw the answer. After the reveal the question is
 * worthless -- nobody can un-know a keyed answer -- so this is asked between
 * the click and the grade, or not at all.
 *
 * WHY THE SCHEMA ALREADY HAS IT AND NOTHING WROTE IT. `Attempt.confidence` is
 * `Int` NOT NULL, and lib/db.js records why no attempt was ever written as a
 * typed row: no surface asked, so satisfying the column would have meant
 * writing 0 ("guessing") on a learner's behalf -- publishing a calibration
 * claim they never made, into the one field whose entire purpose is catching
 * the confidently wrong. Inventing the number destroys the measurement it
 * pretends to make.
 *
 * So the rule here, and it is the whole design: an attempt either carries a
 * confidence the learner actually stated, or it carries none and is excluded
 * from every calibration figure. `stated()` is the gate. An absent confidence
 * is never a zero.
 *
 * Pure. No imports, no model, no database.
 */

/**
 * The scale, as the schema comment defines it: 0=guessing .. 3=certain.
 *
 * Four points on purpose. Two cannot express "fairly sure", and a ten-point
 * scale asks a learner mid-lesson to discriminate between 6 and 7, which is a
 * judgement nobody makes consistently and which would add noise to the one
 * signal this exists to read.
 */
export const CONFIDENCE = [
  { value: 0, label: 'Guessing', short: 'Guess' },
  { value: 1, label: 'Unsure', short: 'Unsure' },
  { value: 2, label: 'Fairly sure', short: 'Fairly sure' },
  { value: 3, label: 'Certain', short: 'Certain' },
];

export const MAX_CONFIDENCE = 3;

/** The two upper points: the learner committed. */
const COMMITTED = 2;

/**
 * Did the learner actually state this?
 *
 * Deliberately strict. A string, a float, a null, a NaN or anything off the
 * scale is not a statement a learner made, and coercing it would put a number
 * they never chose into the calibration. The caller stores nothing instead.
 */
export function stated(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CONFIDENCE;
}

/** Confidence as a 0..1 fraction, for comparison against an accuracy. */
export function asFraction(value) {
  return stated(value) ? value / MAX_CONFIDENCE : null;
}

const confidenceOf = (attempt) => {
  const direct = attempt?.confidence;
  if (stated(direct)) return direct;
  const nested = attempt?.result?.confidence;
  return stated(nested) ? nested : null;
};

const wasCorrect = (attempt) => attempt?.correct === true || attempt?.result?.correct === true;

/**
 * What a learner's own answers say about how well they know what they know.
 *
 * `gap` is the headline: mean stated confidence minus accuracy, both on 0..1.
 * Positive means they were surer than they were right (overconfident);
 * negative means the reverse. Zero is a learner whose confidence is worth
 * trusting, which is the actual goal -- not maximum confidence.
 *
 * `confidentlyWrong` is the one that changes what an instructor does. It counts
 * only the committed half of the scale, because "unsure and wrong" is a learner
 * behaving correctly.
 *
 * Attempts with no stated confidence are counted in `unrated` and excluded from
 * everything else. A course answered before this existed reports zero rated
 * attempts rather than a fabricated calibration.
 */
export function calibrationOf(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const rated = [];
  let unrated = 0;
  for (const attempt of list) {
    const confidence = confidenceOf(attempt);
    if (confidence === null) {
      unrated += 1;
      continue;
    }
    rated.push({ confidence, correct: wasCorrect(attempt) });
  }
  if (rated.length === 0) {
    return { rated: 0, unrated, gap: null, accuracy: null, confidence: null, confidentlyWrong: 0, guessedRight: 0 };
  }
  const accuracy = rated.filter((entry) => entry.correct).length / rated.length;
  const confidence = rated.reduce((sum, entry) => sum + entry.confidence, 0) / rated.length / MAX_CONFIDENCE;
  return {
    rated: rated.length,
    unrated,
    accuracy,
    confidence,
    gap: confidence - accuracy,
    // Certain or fairly sure, and wrong. The learner a percentage hides.
    confidentlyWrong: rated.filter((entry) => !entry.correct && entry.confidence >= COMMITTED).length,
    // The other blind spot, and the reason a raw score flatters: right without
    // knowing why. It will not survive being asked again a week later.
    guessedRight: rated.filter((entry) => entry.correct && entry.confidence < COMMITTED).length,
  };
}

/**
 * One sentence for the learner about their own calibration.
 *
 * Returns null when there is nothing honest to say -- no rated attempts, or too
 * few for the figure to mean anything. A calibration claim off three answers is
 * noise wearing a percentage, and showing it would teach a learner to distrust
 * the number when it finally matters.
 */
const MIN_FOR_A_CLAIM = 8;
const NOTABLE_GAP = 0.15;

export function calibrationNote(summary) {
  if (!summary || summary.rated < MIN_FOR_A_CLAIM) return null;
  if (summary.confidentlyWrong > 0) {
    const n = summary.confidentlyWrong;
    return `You were sure and wrong on ${n} ${n === 1 ? 'question' : 'questions'}. Those are worth re-reading first — you would not have gone back to them on your own.`;
  }
  if (summary.gap > NOTABLE_GAP) {
    return 'You tend to be surer than you are right. Slow down on the ones you feel certain about.';
  }
  if (summary.gap < -NOTABLE_GAP) {
    return 'You know this better than you think you do — you are marking yourself unsure on questions you get right.';
  }
  return 'Your confidence matches your accuracy, which means you can trust your own sense of what you still need to study.';
}
