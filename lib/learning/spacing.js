/**
 * When a question should be asked again.
 *
 * WHY THIS EXISTS. The learner loop in the north star runs practice into spaced
 * review and review back into the path, and the review node was never built.
 * Cadence plans a syllabus across a calendar, which is a different job: it says
 * when to study a lesson, not when a specific thing you got wrong has decayed
 * far enough to be worth asking again. Without the second, a course is a thing
 * you finish rather than a thing you retain, and the evidence the platform
 * collects about a learner stops being used the moment they answer.
 *
 * WHY IT IS WEIGHTED BY CONFIDENCE. The north star calls for
 * confidence-weighted spacing specifically, and the reason is the same one that
 * put a rating in front of the reveal: a right answer and a right answer are
 * not the same fact. Right and certain is knowledge, and asking it again
 * tomorrow wastes the only thing a learner has less of than motivation. Right
 * while guessing is a coin that landed well, and it will not land well in a
 * week. Wrong and certain is the worst state in the set -- the learner is not
 * merely missing the fact, they are holding a wrong one confidently, and every
 * day it sits unchallenged it is being rehearsed.
 *
 * So the four quadrants get four different treatments rather than one interval
 * scaled by correctness:
 *
 *                 | guessed / unsure        | fairly sure / certain
 *   --------------+-------------------------+-------------------------
 *    correct      | short -- it was luck    | long -- this is known
 *    wrong        | short -- known unknown  | shortest -- actively wrong
 *
 * WHAT IT DOES NOT DO. It does not invent a confidence for an attempt that
 * carries none. An unrated attempt is scheduled on correctness alone, at the
 * unsure interval, because "we do not know how sure they were" is genuinely
 * less information than "they told us" and the schedule should not pretend
 * otherwise. See lib/learning/calibration.js for why an absent rating is never
 * a zero.
 *
 * Pure. One import, no clock of its own -- every entry point takes `now`, so a
 * test never races midnight and a caller can ask "what is due on Friday?".
 */

import { stated } from './calibration.js';

const DAY = 86400000;

/**
 * The ladder, in days. An item climbs one rung each time it is answered well
 * and drops to the bottom when it is missed.
 *
 * Roughly the intervals a Leitner box produces, which is the schedule with the
 * longest record of working and the shortest list of parameters to get wrong.
 * Nothing here is tuned to a dataset we do not have; inventing a decay constant
 * and presenting it as science would be worse than a box that is honestly a
 * box.
 */
export const LADDER = [1, 3, 7, 16, 35];

/** Confidence at or above this is a commitment, not a lean. */
const COMMITTED = 2;

/**
 * The next interval in days for one answer.
 *
 * `rung` is how many times in a row this item has been answered well; it is
 * the caller's running count, not a guess made here.
 */
export function nextInterval({ correct, confidence, rung = 0 } = {}) {
  const sure = stated(confidence) ? confidence >= COMMITTED : false;
  const rated = stated(confidence);

  // Confidently wrong. Not on the ladder at all: the learner is rehearsing a
  // wrong fact, and the only useful interval is the next sitting.
  if (!correct && rated && sure) return 0;
  // Wrong, and they knew they did not know. Tomorrow.
  if (!correct) return LADDER[0];
  // Right, but they were guessing or unsure -- or never said. Hold the rung
  // rather than climbing: a coin that landed well is not evidence of knowing,
  // and neither is an answer whose confidence nobody recorded.
  if (!sure) return LADDER[Math.min(rung, LADDER.length - 1)];
  // Right and committed. Climb.
  return LADDER[Math.min(rung + 1, LADDER.length - 1)];
}

/** The rung an item sits on after this answer. */
export function nextRung({ correct, confidence, rung = 0 } = {}) {
  if (!correct) return 0;
  const sure = stated(confidence) && confidence >= COMMITTED;
  return sure ? Math.min(rung + 1, LADDER.length - 1) : rung;
}

const timeOf = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const correctOf = (attempt) => attempt?.correct === true || attempt?.result?.correct === true;
const confidenceOf = (attempt) => {
  if (stated(attempt?.confidence)) return attempt.confidence;
  return stated(attempt?.result?.confidence) ? attempt.result.confidence : null;
};

/**
 * Walk a learner's answers per item and work out when each is next due.
 *
 * Attempts are replayed in the order they were answered, because the rung is a
 * running count and a schedule computed from the latest answer alone would
 * restart every item at the bottom of the ladder on every read.
 *
 * Only items with at least one answer appear. An item a learner has never seen
 * is not overdue -- it is unstudied, which the course itself already reports.
 */
export function reviewSchedule(attempts, { now = Date.now() } = {}) {
  const byItem = new Map();
  const ordered = [...(Array.isArray(attempts) ? attempts : [])]
    .filter((attempt) => attempt && typeof attempt.itemId === 'string' && attempt.itemId)
    .sort((left, right) => timeOf(left.answeredAt) - timeOf(right.answeredAt));

  for (const attempt of ordered) {
    const state = byItem.get(attempt.itemId) || { rung: 0, answers: 0 };
    const correct = correctOf(attempt);
    const confidence = confidenceOf(attempt);
    const days = nextInterval({ correct, confidence, rung: state.rung });
    byItem.set(attempt.itemId, {
      itemId: attempt.itemId,
      objective: attempt.objective || state.objective || null,
      rung: nextRung({ correct, confidence, rung: state.rung }),
      answers: state.answers + 1,
      lastCorrect: correct,
      lastConfidence: confidence,
      intervalDays: days,
      dueAt: new Date(timeOf(attempt.answeredAt) || now).getTime() + days * DAY,
    });
  }
  return [...byItem.values()];
}

/**
 * What is due now, worst first.
 *
 * The order is the point. A learner with twenty overdue items will do the first
 * five, so the first five have to be the ones that matter: everything they were
 * confidently wrong about, then everything else by how long it has been
 * waiting. Sorting purely by due date would bury a rehearsed wrong fact behind
 * a fortnight of easy items.
 */
export function dueForReview(attempts, { now = Date.now(), limit = 0 } = {}) {
  const due = reviewSchedule(attempts, { now })
    .filter((entry) => entry.dueAt <= now)
    .sort((left, right) => {
      const leftUrgent = left.lastCorrect === false && stated(left.lastConfidence) && left.lastConfidence >= COMMITTED;
      const rightUrgent = right.lastCorrect === false && stated(right.lastConfidence) && right.lastConfidence >= COMMITTED;
      if (leftUrgent !== rightUrgent) return leftUrgent ? -1 : 1;
      if (left.lastCorrect !== right.lastCorrect) return left.lastCorrect ? 1 : -1;
      return left.dueAt - right.dueAt;
    });
  return limit > 0 ? due.slice(0, limit) : due;
}

/**
 * One line for the learner about their review queue.
 *
 * Returns null when there is nothing due, because a review screen that always
 * has something to say trains a learner to stop reading it.
 */
export function reviewNote(due) {
  const list = Array.isArray(due) ? due : [];
  if (list.length === 0) return null;
  const urgent = list.filter(
    (entry) => entry.lastCorrect === false && stated(entry.lastConfidence) && entry.lastConfidence >= COMMITTED,
  ).length;
  if (urgent > 0) {
    return `${list.length} due. Start with the ${urgent} you were sure about and got wrong — those are the ones you are still carrying.`;
  }
  return `${list.length} due for review.`;
}
