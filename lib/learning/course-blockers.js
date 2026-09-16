/**
 * Draft blockers — the grounding validator's own issues, grouped so an
 * instructor can see which section to revise, plus the rule for accepting a
 * revision that moves a blocked draft toward publishable.
 *
 * Nothing here relaxes the publication gate. `approveCourse` still requires
 * `validateCourseDraft` to pass outright, so a section that is uncited or
 * ungrounded can never reach a learner. These helpers only decide what is
 * worth persisting for a human to review and what counts as progress while
 * they review it.
 */

/* The validator returns early — with nothing per-section to review — only for
   these three. A draft that fails any of them has no reviewable content, so it
   is still an outright generation failure rather than a draft to repair. */
const STRUCTURAL_ISSUES = new Set([
  'course must be an object',
  'course must contain at least one section',
  'approved source projections are required for grounding',
]);

function issueList(validation) {
  return Array.isArray(validation?.issues) ? validation.issues.map(String) : [];
}

/** The section an issue names, or null for a course-wide issue. */
export function sectionIndexOf(issue) {
  const match = /^section (\d+)\b/.exec(String(issue || ''));
  return match ? Number(match[1]) : null;
}

/** True when the draft has no reviewable content at all. */
export function isStructuralFailure(validation) {
  if (validation?.valid) return false;
  return issueList(validation).some((issue) => STRUCTURAL_ISSUES.has(issue));
}

/**
 * Group a validation result for display: course-wide issues, and the issues
 * belonging to each section, keyed by the section's index in `sections`.
 */
export function groupBlockers(validation) {
  const issues = issueList(validation);
  const general = [];
  const bySection = new Map();
  for (const issue of issues) {
    const index = sectionIndexOf(issue);
    if (index === null) {
      general.push(issue);
      continue;
    }
    if (!bySection.has(index)) bySection.set(index, []);
    // Strip the "section N" prefix: the UI already knows which section it is.
    bySection.get(index).push(issue.replace(/^section \d+[.\s]*/, '').trim() || issue);
  }
  return {
    valid: Boolean(validation?.valid),
    issues,
    general,
    sections: [...bySection.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, sectionIssues]) => ({ index, issues: sectionIssues })),
  };
}

/** Indexes of sections carrying at least one issue. */
function blockedSections(validation) {
  return new Set(
    issueList(validation)
      .map(sectionIndexOf)
      .filter((index) => index !== null),
  );
}

/**
 * May a revision be saved? A revision is always welcome when it leaves the
 * course publishable, and never welcome when it blocks a course that was
 * publishable before. In between — repairing a draft that the generator left
 * blocked — it must make progress: fewer blocking issues overall, and no
 * section that was clean may become blocked.
 *
 * Accepting one of these saves a PENDING revision for human review. It does
 * not publish anything; approval revalidates from scratch.
 */
export function revisionProgress(before, after) {
  if (after?.valid) return { accept: true };
  if (before?.valid) {
    return {
      accept: false,
      reason: 'This revision would leave the course ungrounded, so it was not saved.',
    };
  }

  const wasBlocked = blockedSections(before);
  const nowBlocked = blockedSections(after);
  const broken = [...nowBlocked].filter((index) => !wasBlocked.has(index)).sort((a, b) => a - b);
  if (broken.length > 0) {
    return {
      accept: false,
      reason: `This revision would block ${
        broken.length === 1 ? 'section' : 'sections'
      } ${broken.map((index) => index + 1).join(', ')}, which passed before, so it was not saved.`,
    };
  }

  const beforeCount = issueList(before).length;
  const afterCount = issueList(after).length;
  if (afterCount >= beforeCount) {
    return {
      accept: false,
      reason: 'This revision did not resolve anything that is blocking publication, so it was not saved. Try more specific instructions.',
    };
  }
  return { accept: true };
}
