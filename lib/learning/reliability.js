/**
 * Whether a rubric means the same thing in two different hands.
 *
 * WHY THIS EXISTS. The north star lists "rubric reliability is *measured*"
 * among the things this platform proves rather than asserts, and Rubricon
 * ships the arithmetic for it -- percentAgreement, cohenKappa, weightedKappa,
 * interpretKappa, reliabilityReport. Nothing in this repository had ever called
 * any of them. The claim was true of the library and false of the product.
 *
 * It is also the question a schoolhouse asks before letting a model grade
 * anybody. A mastery session ends with a verdict per criterion, produced by a
 * model reading an approved rubric. "Is that verdict any good?" has exactly one
 * respectable answer, and it is not a confidence score the model reports about
 * itself: it is whether a qualified human applying the same rubric to the same
 * answers reaches the same tier -- corrected for the agreement you would get by
 * chance, which is what kappa is for and why raw percent agreement flatters.
 *
 * So the two raters here are the model and the instructor, on the same session,
 * against the same criteria. The instructor re-rates; this pairs the verdicts
 * up and hands them to Rubricon unchanged. The arithmetic is not reimplemented.
 *
 * WHY THE TIER MAPPING MATTERS. Whetstone's vocabulary is developing /
 * competent / mastered; Rubricon's canonical TIERS are unsatisfactory /
 * satisfactory / proficient. Weighted kappa needs the ORDER, because the weight
 * of a disagreement is how many tiers apart two ratings are -- and Rubricon
 * refuses to guess an order from the alphabet, which would rank "proficient"
 * below "satisfactory" and silently invert the scale. Passing our three labels
 * raw would throw. They are mapped to the canonical ones instead, in the right
 * order, once, here.
 *
 * Pure apart from Rubricon's own maths. No model, no database.
 */

import { reliabilityReport, TIERS } from 'rubricon';

/** Whetstone's verdicts, weakest first. The order IS the ordinal scale. */
export const VERDICTS = ['developing', 'competent', 'mastered'];

/**
 * Whetstone verdict -> Rubricon canonical tier, in rank order.
 *
 * Kept explicit rather than positional so a future fourth verdict cannot
 * silently shift what "competent" maps to.
 */
const TIER_FOR = {
  developing: 'unsatisfactory',
  competent: 'satisfactory',
  mastered: 'proficient',
};

/** The canonical tiers in rank order, which is what weightedKappa needs. */
const TIER_ORDER = Object.keys(TIERS).sort((left, right) => TIERS[left] - TIERS[right]);

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const key = (value) => text(value).toLowerCase();

/** Is this one of the three verdicts, rather than a free-text note? */
export function isVerdict(value) {
  return VERDICTS.includes(key(value));
}

/**
 * The criterion a verdict belongs to, however the record spells it.
 *
 * A stored report calls it `competency`; the plan and the session call it
 * `elo`. Both are the same string, and pairing on the wrong one would silently
 * compare a rater's verdict on one criterion with the model's on another --
 * producing a kappa that is arithmetically valid and completely meaningless.
 */
export function criterionOf(entry) {
  return key(entry?.competency ?? entry?.elo ?? entry?.criterion ?? entry?.name);
}

/**
 * Line up two sets of verdicts on the criteria they share.
 *
 * Returns the paired tiers and, deliberately, what did NOT pair: a criterion
 * only one rater judged is not a disagreement and must not be scored as one,
 * but an instructor who rated four of nine criteria should be able to see that
 * rather than read a kappa over four and believe it covered the session.
 */
export function pairVerdicts(modelCriteria, raterCriteria) {
  const theirs = new Map();
  for (const entry of Array.isArray(raterCriteria) ? raterCriteria : []) {
    const criterion = criterionOf(entry);
    if (criterion && isVerdict(entry?.verdict)) theirs.set(criterion, key(entry.verdict));
  }
  const model = [];
  const rater = [];
  const criteria = [];
  const unpaired = [];
  for (const entry of Array.isArray(modelCriteria) ? modelCriteria : []) {
    const criterion = criterionOf(entry);
    if (!criterion) continue;
    if (!isVerdict(entry?.verdict) || !theirs.has(criterion)) {
      unpaired.push(criterion);
      continue;
    }
    criteria.push(criterion);
    model.push(TIER_FOR[key(entry.verdict)]);
    rater.push(TIER_FOR[theirs.get(criterion)]);
  }
  return { model, rater, criteria, unpaired };
}

/**
 * How far below agreement a kappa has to be before this says so out loud.
 *
 * 0.6 is the conventional floor for "substantial" agreement, and it is the
 * number an assessment shop would argue about; it is stated here rather than
 * buried in a comparison so it can be argued about.
 */
export const SUBSTANTIAL = 0.6;

/**
 * The reliability of one rubric as two raters applied it.
 *
 * Returns null when there is nothing to measure. Rubricon's own functions throw
 * on empty or mismatched input and return NaN when every rating is identical --
 * that last one is not a failure, it is the honest answer for a set with no
 * variance, where agreement cannot be corrected for chance at all. Both are
 * handled here so a caller gets a report or a reason, never a NaN on a screen.
 */
export function reliabilityOf(modelCriteria, raterCriteria) {
  const paired = pairVerdicts(modelCriteria, raterCriteria);
  if (paired.model.length === 0) {
    return { n: 0, unpaired: paired.unpaired, report: null, reason: 'no criterion was rated by both' };
  }
  const report = reliabilityReport(paired.model, paired.rater, { categories: TIER_ORDER });
  // Every rating identical in both columns: kappa is undefined, not zero. Say
  // what actually happened rather than showing a dash that reads as failure.
  const degenerate = !Number.isFinite(report.cohenKappa);
  return {
    n: report.n,
    criteria: paired.criteria,
    unpaired: paired.unpaired,
    agreement: report.percentAgreement,
    kappa: degenerate ? null : report.cohenKappa,
    weightedKappa: Number.isFinite(report.weightedKappa) ? report.weightedKappa : null,
    interpretation: degenerate ? null : report.interpretation,
    substantial: Number.isFinite(report.cohenKappa) ? report.cohenKappa >= SUBSTANTIAL : null,
    ...(degenerate
      ? { reason: 'every criterion was rated the same by both, so agreement cannot be corrected for chance' }
      : {}),
    report,
  };
}

/**
 * The verdicts an instructor submitted, reduced to what may be stored.
 *
 * Allowlisted: a rating is instructor input arriving over HTTP, and it must not
 * be able to put arbitrary fields onto a record that later feeds an aggregate.
 * A criterion this session does not have is dropped rather than invented, and a
 * verdict outside the three is dropped rather than coerced.
 */
export function cleanRatings(criteria, submitted) {
  const known = new Map();
  for (const entry of Array.isArray(criteria) ? criteria : []) {
    const criterion = criterionOf(entry);
    if (criterion) known.set(criterion, text(entry?.competency ?? entry?.elo ?? ''));
  }
  const seen = new Set();
  const clean = [];
  for (const entry of Array.isArray(submitted) ? submitted : []) {
    const criterion = criterionOf(entry);
    if (!criterion || !known.has(criterion) || seen.has(criterion)) continue;
    if (!isVerdict(entry?.verdict)) continue;
    seen.add(criterion);
    clean.push({ competency: known.get(criterion) || criterion, verdict: key(entry.verdict) });
  }
  return clean;
}

/**
 * Reliability across every session an instructor has re-rated on a course.
 *
 * Pooled rather than averaged. A mean of per-session kappas weights a session
 * with two criteria the same as one with nine, and kappa over two ratings is
 * not a measurement anybody should average into anything. Concatenating the
 * columns and computing once over the pool is the figure an assessment shop
 * would report.
 */
export function pooledReliability(pairs) {
  const model = [];
  const rater = [];
  let sessions = 0;
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const paired = pairVerdicts(pair?.model, pair?.rater);
    if (paired.model.length === 0) continue;
    sessions += 1;
    model.push(...paired.model);
    rater.push(...paired.rater);
  }
  if (model.length === 0) {
    return { sessions: 0, n: 0, report: null, reason: 'no session has been rated by an instructor yet' };
  }
  const report = reliabilityReport(model, rater, { categories: TIER_ORDER });
  const degenerate = !Number.isFinite(report.cohenKappa);
  return {
    sessions,
    n: report.n,
    agreement: report.percentAgreement,
    kappa: degenerate ? null : report.cohenKappa,
    weightedKappa: Number.isFinite(report.weightedKappa) ? report.weightedKappa : null,
    interpretation: degenerate ? null : report.interpretation,
    substantial: Number.isFinite(report.cohenKappa) ? report.cohenKappa >= SUBSTANTIAL : null,
    ...(degenerate
      ? { reason: 'every rating agreed exactly, so agreement cannot be corrected for chance' }
      : {}),
    report,
  };
}
