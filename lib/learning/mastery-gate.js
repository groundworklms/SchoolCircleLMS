/**
 * Whether a learner may start a mastery session, and what to say when they may
 * not.
 *
 * WHY THIS EXISTS. The mastery session is the one place in this product where a
 * learner answers in their own words and is graded against the source rather
 * than against four options. All of the machinery for it is built and wired:
 * `startMastery` creates the record, `answerMasterySession` grades each turn,
 * the instructor can generate and approve a shared plan, and both shells render
 * it. But no generated course has ever reached it, because the learner's Start
 * button required an APPROVED mastery plan and nothing in course generation
 * makes one. Every freshly generated course therefore showed "No approved
 * mastery plan yet" over a disabled button, forever, with no action on that
 * screen that could change it.
 *
 * The server never asked for that. `startMastery` treats the plan as optional
 * and falls back to the source's own task titles as objectives when there is
 * none -- the instructor panel says so too ("Optional -- doesn't block review or
 * publish"). The UI was simply stricter than the contract it calls, and the
 * stricter half was the half a learner sees.
 *
 * So this states the server's rule once, in a form both a test and a button can
 * read:
 *
 *   - no plan at all          -> allowed, graded on the source's own objectives
 *   - PENDING                 -> blocked, and it is the instructor who unblocks
 *                                it, so say that rather than blaming the source
 *   - APPROVED, source agrees -> allowed, graded on the approved criteria
 *   - APPROVED, source differs -> blocked; the server returns a 404 for this and
 *                                a disabled button beats an unexplained failure
 *   - anything else           -> blocked as invalid, matching the 422
 *
 * Pure. No imports, no React, no network.
 */

/**
 * @param {object|null} plan     the course's mastery plan, if it has one
 * @param {string|null} sourceId the source the session would be graded against
 * @returns {{allowed: boolean, reason: string|null, tone: 'info'|'warning'}}
 */
export function masteryStart(plan, sourceId = null) {
  if (!sourceId) {
    return {
      allowed: false,
      reason: 'This course has no approved source to grade against.',
      tone: 'warning',
    };
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return {
      allowed: true,
      // Not a warning. A session without a shared plan is a supported way to
      // use this, not a degraded one, and the learner is told what it will be
      // graded on rather than what it lacks.
      reason: 'Graded on this course’s objectives. Your instructor has not shared a rubric for it.',
      tone: 'info',
    };
  }
  if (plan.status === 'PENDING') {
    return {
      allowed: false,
      reason: 'Your instructor has a mastery rubric waiting for approval. Sessions open once it is approved.',
      tone: 'warning',
    };
  }
  if (plan.status !== 'APPROVED') {
    return {
      allowed: false,
      reason: 'This course’s mastery rubric is not usable. Ask your instructor to regenerate it.',
      tone: 'warning',
    };
  }
  if (plan.sourceId && plan.sourceId !== sourceId) {
    return {
      allowed: false,
      reason: 'The approved rubric grades a different source than this course reads from.',
      tone: 'warning',
    };
  }
  return {
    allowed: true,
    reason: 'Graded on your instructor’s approved rubric.',
    tone: 'info',
  };
}

/** The label for the start button, which differs by what it will grade on. */
export function startLabel(plan) {
  return plan?.status === 'APPROVED' ? 'Start session with approved plan' : 'Start mastery session';
}
