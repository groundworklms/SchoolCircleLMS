/**
 * Measure HHEM entailment support for the items a course approval is about to
 * materialise.
 *
 * The product promises "an on-device entailment check confirms the specifics
 * are actually supported by the source". This is that check for course
 * content: each item's own claim, scored against the passage text its own
 * citation resolves to, by the verifier on the Orin.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD
 *
 * A support score is a measurement or it is nothing. There is no default, no
 * estimate, no carried-forward value and no floor anywhere in this file. An
 * item only appears in the returned map when the verifier returned a finite
 * 0..1 number for THAT item's claim and THAT item's spans; every other
 * outcome -- no service configured, unreachable, timed out, over budget,
 * malformed, ok:false -- simply leaves the id out, Item.support stays null,
 * and the review panel keeps saying "not verified". That is the honest state,
 * and an instructor about to put their name on a doctrine item is entitled to
 * the difference between "verified 0.84" and "not checked".
 *
 * WHY IT RUNS BEFORE THE TRANSACTION
 *
 * Items are written inside the Prisma transaction in approveCourseAtomically.
 * A network call to an 8GB board has no business inside a database
 * transaction: it would hold row locks open for the length of a model run and
 * make a slow verifier into a lock-contention outage. So the caller
 * (lib/learning/core.js) projects the rows it is about to ask for, measures
 * them here, and hands the resulting id -> score map down. The transaction
 * projects the same rows from the same inputs and adopts a score only where
 * the id matches; anything unmatched stays null.
 *
 * COST
 *
 * A course can be dozens of items and each call runs a real model on a board
 * that also serves retrieval. Three bounds apply:
 *   - at most VERIFY_CONCURRENCY calls in flight;
 *   - a whole-course wall-clock budget, after which nothing further is
 *     dispatched (the remaining items stay unverified);
 *   - each call's own timeout is clamped to what is left of that budget, so
 *     the total time an approval can spend here is the budget, not the budget
 *     plus one hung request.
 * Approval must never fail because the verifier is down or slow; it must
 * produce unverified items.
 */
import { verifyClaim } from '../doctrine.js';
import { itemVerificationTargets, measuredSupport } from './project-course.js';

export { measuredSupport };

/**
 * Two, not more. Measured against the live board: one claim against one page
 * takes about 2.7s, and four concurrent claims take about 11s -- the verifier
 * serialises, so extra concurrency buys no throughput at all and only adds
 * queueing latency, memory pressure on an 8GB board shared with retrieval, and
 * stragglers that get cut by the budget with their work wasted. Two keeps the
 * next request on the wire while one is being scored, which is the whole
 * benefit available.
 */
export const VERIFY_CONCURRENCY = 2;

/**
 * The whole-course ceiling. At roughly 2.7s an item this verifies about 20
 * items, so a large course finishes partly verified -- which is why the
 * unverified state has to be honest rather than defaulted. It sits well under
 * the approve route's own 120s maxDuration, because verification running past
 * the request deadline would fail an approval, and a slow verifier must never
 * do that.
 */
export const VERIFY_BUDGET_MS = 60_000;

function boundedNumber(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

/**
 * Score every verifiable item of a projected course.
 *
 * @param {Array} sections   sections as returned by projectCourseRows
 * @param {Array<{labels:string[],text:string}>} passages  the persisted index
 * @param {object} [options]
 * @param {Function} [options.verify]  the client seam; tests stub it
 * @param {number} [options.concurrency]
 * @param {number} [options.budgetMs]
 * @param {Function} [options.now]     injectable clock, for testing the budget
 * @returns {Promise<Map<string, number>>} id -> measured support, measured only
 */
export async function measureItemSupport(sections, passages, {
  verify = verifyClaim,
  concurrency,
  budgetMs,
  now = Date.now,
} = {}) {
  const measured = new Map();
  const targets = itemVerificationTargets(sections, passages);
  if (targets.length === 0) return measured;

  const limit = Math.max(1, Math.trunc(boundedNumber(
    concurrency ?? process.env.DOCTRINE_VERIFY_CONCURRENCY,
    VERIFY_CONCURRENCY,
  )));
  const budget = boundedNumber(
    budgetMs ?? process.env.DOCTRINE_VERIFY_BUDGET_MS,
    VERIFY_BUDGET_MS,
  );
  const deadline = now() + budget;

  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      if (index >= targets.length) return;
      const remaining = deadline - now();
      // Out of budget: stop dispatching. Everything not yet scored stays
      // unverified, which is a true statement about it.
      if (remaining <= 0) return;
      next += 1;
      const target = targets[index];
      let result;
      try {
        result = await verify({
          claim: target.claim,
          spans: target.spans,
          // Never outlive the course budget, even on one hung request.
          timeoutMs: remaining,
        });
      } catch {
        // verifyClaim is written never to throw; a stub or a future client
        // that does must still not fail an approval.
        result = null;
      }
      if (!result || result.ok !== true) continue;
      const support = measuredSupport(result.support);
      if (support === null) continue;
      measured.set(target.id, support);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return measured;
}
