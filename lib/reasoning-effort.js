/**
 * How hard the model is asked to think, as one operator-facing choice.
 *
 * Reasoning tokens bill as output and are drawn from the same budget as the
 * visible answer, so effort is both a real cost and a real risk of truncation.
 * But it is not one dial for the whole product, because the calls are not one
 * kind of work:
 *
 *   premium    The whole-course plan outline and the lesson page. The outline
 *              has to cover a document set once each in a sensible teaching
 *              order without repeating itself; the lesson page is the prose a
 *              student actually reads, held inside one cited passage. Made a
 *              bounded number of times per course.
 *   authoring  The rest of course generation -- objectives, the source survey,
 *              section drafting. Material an instructor reviews before anyone
 *              is taught from it.
 *   helper     Classifying, checking, scoring a claim against a passage,
 *              answering one grounded tutor turn. These run per learner turn
 *              and per verification, indefinitely, which is where per-token
 *              spend actually accumulates -- and none of them get better for
 *              extra deliberation.
 *
 * Exposing three separate controls would be three ways to get it wrong, so the
 * panel offers one profile that shifts the whole ladder and keeps the ordering
 * (helper <= authoring <= premium) intact.
 *
 * `low` is the floor rather than "off" deliberately. Several families -- the
 * Gemini 3 line among them -- reason unconditionally, so turning it off is not
 * available everywhere; and omitting the parameter does NOT mean "no thinking",
 * it means the provider's own default, which is often *more* than low. A dial
 * whose cheapest setting could silently cost more than the one above it would
 * be worse than no dial.
 */

export const EFFORT_PROFILES = {
  economy: {
    label: 'Economy',
    summary: 'Least thinking everywhere. Cheapest, and roughest on long drafts.',
    tiers: { helper: 'low', authoring: 'low', premium: 'low' },
  },
  balanced: {
    label: 'Balanced',
    summary: 'Thinks hard where a student will read the result, sparingly elsewhere.',
    tiers: { helper: 'low', authoring: 'medium', premium: 'high' },
  },
  thorough: {
    label: 'Thorough',
    summary: 'More thinking on every call, including per-learner ones. Costs the most.',
    tiers: { helper: 'medium', authoring: 'high', premium: 'high' },
  },
};

export const DEFAULT_EFFORT_PROFILE = 'balanced';

export const EFFORT_TIERS = ['helper', 'authoring', 'premium'];

export function isEffortProfile(value) {
  return typeof value === 'string' && Object.hasOwn(EFFORT_PROFILES, value.trim().toLowerCase());
}

/** The profile name, or null when `value` does not name one. */
export function normaliseEffortProfile(value) {
  return isEffortProfile(value) ? value.trim().toLowerCase() : null;
}

/**
 * The effort level for one tier under one profile. An unknown profile falls
 * back to the default rather than throwing: this is on the path of every
 * generation, and a bad stored value must not take generation down.
 */
export function effortFor(profile, tier) {
  const chosen = EFFORT_PROFILES[normaliseEffortProfile(profile) || DEFAULT_EFFORT_PROFILE];
  return chosen.tiers[tier] || chosen.tiers.authoring;
}

/** The operator-facing list, for the Settings panel. */
export function effortProfileOptions() {
  return Object.entries(EFFORT_PROFILES).map(([id, { label, summary, tiers }]) => ({
    id,
    label,
    summary,
    tiers: { ...tiers },
  }));
}
