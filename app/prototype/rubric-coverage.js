/*
 * How a course's objectives line up with the rubrics written for them.
 *
 * A course teaches objectives; a rubric says how performance against one of
 * those objectives is judged. Those two facts lived on two screens that never
 * referred to each other, so "which objectives can actually be assessed?" was
 * a question nobody could answer. These helpers answer it.
 *
 * Deliberately free of React and of the API client: the course screen and the
 * rubrics library ask the same question, and the answer is worth testing
 * without rendering anything.
 */

/** The objectives written on a course draft, as plain strings. */
export function courseObjectives(course) {
  const candidate = Array.isArray(course?.objectives)
    ? course.objectives
    : course?.course?.objectives;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry?.objective || '').trim()))
    .filter(Boolean);
}

/**
 * What a rubric row means to an instructor.
 *
 * `flagged` is not a failure state and is not a draft on its way to approval:
 * Rubricon refused to anchor the standard, and the next step is a human
 * rewriting it. Keeping it distinct from `draft` is the whole point -- a
 * flagged rubric will never become approved by being reviewed again.
 */
export function rubricState(rubric) {
  if (!rubric) return 'none';
  if (rubric.status === 'APPROVED') return 'approved';
  if (rubric.flagged === true) return 'flagged';
  return 'draft';
}

export const RUBRIC_STATE_LABELS = {
  none: 'No rubric',
  draft: 'Draft rubric',
  flagged: 'Flagged for an SME',
  approved: 'Rubric approved',
};

/**
 * The rubric that speaks for an objective.
 *
 * An objective can collect several rubrics: a flagged standard is rewritten
 * and generated again, and nothing deletes the refusal. An approved one is the
 * answer whenever there is one; otherwise the newest attempt is, because that
 * is the one the instructor last worked on. `rubrics` arrives newest-first
 * from the API, so the first match is the newest.
 */
export function rubricForObjective(rubrics, courseId, objective) {
  const list = Array.isArray(rubrics) ? rubrics : [];
  const matches = list.filter(
    (rubric) => rubric?.courseId === courseId && rubric?.objective === objective,
  );
  return matches.find((rubric) => rubric.status === 'APPROVED') || matches[0] || null;
}

/** One row per objective, in the order the course teaches them. */
export function objectiveCoverage(course, rubrics, courseId) {
  return courseObjectives(course).map((objective) => {
    const rubric = rubricForObjective(rubrics, courseId, objective);
    return { objective, rubric, state: rubricState(rubric) };
  });
}

/**
 * The one line the course screen leads with. `assessable` counts only approved
 * rubrics: a draft is not a judgement anyone has agreed to, and a flagged one
 * is the explicit absence of one.
 */
export function coverageSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    objectives: list.length,
    assessable: list.filter((row) => row.state === 'approved').length,
    drafted: list.filter((row) => row.state === 'draft').length,
    flagged: list.filter((row) => row.state === 'flagged').length,
    missing: list.filter((row) => row.state === 'none').length,
  };
}
