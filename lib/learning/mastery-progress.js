/**
 * What a learner in the middle of a mastery session is entitled to know.
 *
 * WHY THIS EXISTS. A mastery session is the one exercise in this product where
 * a Marine writes in their own words and is graded against a rubric rather than
 * against four options. Whetstone tracks it in detail: which criterion the
 * current question is aimed at, how many exchanges the session has left, how
 * many attempts remain on this criterion before it is scored as it stands,
 * whether the session has stalled. `serialiseMasterySession` stores every one
 * of those on the record.
 *
 * None of it reached the screen. `savedMasteryView` projected the question, the
 * verdict list and the transcript, and dropped the rest -- so a learner faced a
 * question with no idea what it was testing, no idea how much of the session
 * was left, and no warning that their third attempt at one criterion was their
 * last. They could tell they were being graded and nothing else about how.
 *
 * That is a worse experience than a quiz, which at least shows a question
 * count. The information already exists and is already the learner's own; this
 * decides which of it is safe to show and shapes it for a screen.
 *
 * WHAT IS DELIBERATELY NOT HERE. The rubric itself. `session.rubric` is the
 * grading material -- the indicators a verdict is decided by -- and it stays on
 * the record and out of the view, exactly as it does today. A learner shown the
 * indicators is a learner writing to them, and the session stops measuring
 * whether they understand the material. The criterion NAME is different: it is
 * a course objective they were taught from and can already read on the course.
 *
 * Pure. No imports, no model, no database.
 */

/** The three verdicts, weakest first. */
const ASSESSED = new Set(['developing', 'competent', 'mastered']);

const int = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

/**
 * The criterion the current question is aimed at.
 *
 * Whetstone works one criterion at a time and `eloIndex` is its cursor. Null
 * when the session is finished or the index has run off the end, which is the
 * honest answer rather than clamping to the last one and implying a question
 * that is not being asked.
 */
export function currentCriterion(session) {
  const criteria = Array.isArray(session?.criteria) ? session.criteria : [];
  const index = int(session?.eloIndex);
  if (index === null || index >= criteria.length) return null;
  const criterion = criteria[index];
  const name = typeof criterion?.elo === 'string' && criterion.elo.trim()
    ? criterion.elo.trim()
    : typeof criterion?.competency === 'string' ? criterion.competency.trim() : '';
  if (!name) return null;
  return { index, name, verdict: typeof criterion?.verdict === 'string' ? criterion.verdict : null };
}

/**
 * How far through the session the learner is.
 *
 * `exchanges` is what Whetstone counts against `maxTurns`; `turns` is its own
 * internal tally and the two are not interchangeable, so the one the budget is
 * actually spent from is the one reported.
 *
 * Returns null rather than a zero-of-zero when the session carries no budget.
 * A progress bar that reads 0/0 says the session is both finished and not
 * started.
 */
export function sessionProgress(session) {
  const used = int(session?.exchanges) ?? int(session?.turns);
  const total = int(session?.maxTurns);
  if (used === null || !total) return null;
  const left = Math.max(0, total - used);
  return {
    used: Math.min(used, total),
    total,
    left,
    // Worth saying out loud near the end, because the session ends when the
    // budget does and an unassessed criterion is scored as it stands.
    nearlyDone: left > 0 && left <= 2,
  };
}

/**
 * Attempts left on the criterion being assessed.
 *
 * A learner who does not know this is a learner who gets three shots at
 * something, spends two of them warming up, and never finds out that the third
 * was the last. Null when the session does not track it.
 */
export function attemptsLeft(session) {
  const criterion = currentCriterion(session);
  if (!criterion) return null;
  const max = int(session?.maxAttemptsPerCriterion);
  if (!max) return null;
  const attempts = session?.attempts;
  const used = Array.isArray(attempts)
    ? int(attempts[criterion.index]) ?? 0
    : int(attempts?.[criterion.name]) ?? int(attempts?.[criterion.index]) ?? 0;
  return { used: Math.min(used, max), max, left: Math.max(0, max - used) };
}

/**
 * How much of the session has actually been decided.
 *
 * Counted from the verdicts rather than the cursor: a criterion Whetstone moved
 * past without reaching a verdict is not assessed, and reporting the cursor
 * would tell a learner four of six were done when two of them were skipped.
 */
export function criteriaProgress(session) {
  const criteria = Array.isArray(session?.criteria) ? session.criteria : [];
  const assessed = criteria.filter((criterion) => ASSESSED.has(String(criterion?.verdict || '').toLowerCase()));
  return {
    total: criteria.length,
    assessed: assessed.length,
    mastered: assessed.filter((criterion) => String(criterion.verdict).toLowerCase() === 'mastered').length,
  };
}

/**
 * The transcript as an exchange, rather than a flat list of strings.
 *
 * It was rendered as one list item per entry with a JSON.stringify fallback, so
 * a learner reviewing a finished session read their own answers and the
 * questions that prompted them as an undifferentiated column. Pairing them is
 * the difference between a record of a conversation and a log.
 *
 * Whetstone's transcript entries are either strings or objects with a role.
 * Both are handled, and an entry whose role cannot be determined alternates
 * from whatever came before -- a question is always followed by an answer.
 */
export function exchanges(transcript) {
  const entries = Array.isArray(transcript) ? transcript : [];
  const turns = [];
  let expecting = 'question';
  for (const entry of entries) {
    const text = typeof entry === 'string'
      ? entry
      : typeof entry?.text === 'string' ? entry.text : typeof entry?.content === 'string' ? entry.content : '';
    if (!text.trim()) continue;
    const stated = typeof entry?.role === 'string' ? entry.role.toLowerCase() : '';
    const role = stated === 'learner' || stated === 'user' || stated === 'answer'
      ? 'answer'
      : stated === 'assistant' || stated === 'tutor' || stated === 'question'
        ? 'question'
        : expecting;
    turns.push({ role, text: text.trim() });
    expecting = role === 'question' ? 'answer' : 'question';
  }
  return turns;
}

/**
 * The pages of the source this session is graded against.
 *
 * Deduplicated and ordered, because the stored citation list is one entry per
 * retrieved chunk and a source with forty chunks on nine pages would otherwise
 * print forty citations. The learner is being told which part of the manual
 * they are answering from, and nine numbers say that better than forty.
 */
export function citedPages(citations) {
  const pages = [];
  for (const citation of Array.isArray(citations) ? citations : []) {
    const page = Number(citation?.page);
    if (Number.isFinite(page) && !pages.includes(page)) pages.push(page);
  }
  return pages.sort((left, right) => left - right);
}
