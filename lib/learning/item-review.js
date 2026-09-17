/**
 * The decision rules behind per-item ratification, kept pure so they can be
 * tested without a database.
 *
 * Materialisation writes every Item PENDING (see ./project-course.js) and the
 * learner-facing queries return only APPROVED, so an instructor's decision
 * here is the gate a generated question has to pass to reach a student. The
 * persistence and authorisation halves live in ./core.js; what is here is only
 * "is this a legal decision, and what does it change".
 */

export const ITEM_DECISIONS = ['APPROVE', 'REJECT', 'REVISE'];

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  error.status = 400;
  return error;
}

export function normaliseDecision(value) {
  const decision = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ITEM_DECISIONS.includes(decision)) {
    throw badRequest('decision must be APPROVE, REJECT or REVISE');
  }
  return decision;
}

function cleanOptions(options) {
  if (!Array.isArray(options)) throw badRequest('options must be an array of choice strings');
  const cleaned = options.map((option) => (typeof option === 'string' ? option.trim() : ''));
  if (cleaned.length < 2 || cleaned.some((option) => !option)) {
    throw badRequest('options must be at least two non-empty strings');
  }
  return cleaned;
}

/**
 * The writable half of a revision.
 *
 * Only the four authored fields are writable. `citation` and `support` are
 * evidence, not content: the citation names the passage the item was grounded
 * in and `support` is the HHEM score measured against the keyed answer.
 * Neither can be re-derived from an instructor's wording change, so neither is
 * ever written here — a revision that silently carried an old support score
 * onto a new answer would be worse than carrying no score at all.
 *
 * @param {object} body      the request body
 * @param {{ kind: string, options?: unknown, answer?: unknown }} existing  the item on record
 * @returns {object} a Prisma `data` object containing only changed fields
 */
export function itemRevisionData(body, existing) {
  const patch = body && typeof body === 'object' ? body : {};
  const item = existing && typeof existing === 'object' ? existing : {};
  const data = {};

  if (patch.stem !== undefined) {
    const stem = typeof patch.stem === 'string' ? patch.stem.trim() : '';
    if (!stem) throw badRequest('stem must be a non-empty string');
    data.stem = stem;
  }

  if (patch.rationale !== undefined) {
    if (patch.rationale === null) data.rationale = null;
    else if (typeof patch.rationale === 'string') data.rationale = patch.rationale.trim() || null;
    else throw badRequest('rationale must be a string or null');
  }

  const keyed = item.kind === 'QUESTION';
  if (!keyed && (patch.options !== undefined || patch.answer !== undefined)) {
    throw badRequest(`a ${item.kind || 'non-question'} item has no options or keyed answer`);
  }
  if (keyed) {
    if (patch.options !== undefined) data.options = cleanOptions(patch.options);
    const options = data.options || (Array.isArray(item.options) ? item.options : []);
    if (patch.answer !== undefined) {
      if (!Number.isInteger(patch.answer) || patch.answer < 0 || patch.answer >= options.length) {
        throw badRequest('answer must be an index into options');
      }
      data.answer = patch.answer;
    } else if (data.options) {
      // Rewriting the choices can strand the key on record; make the reviewer say.
      const current = item.answer;
      if (!Number.isInteger(current) || current < 0 || current >= options.length) {
        throw badRequest('answer is required when options change');
      }
    }
  }

  if (Object.keys(data).length === 0) throw badRequest('a revision must change something');
  if ('citation' in data || 'support' in data) {
    throw new Error('a revision must never write citation or support');
  }
  return data;
}

/**
 * The full Prisma `data` for one decision. REVISE edits and ratifies in the
 * same action: a reviewer who had to fix an item has, by fixing it, reviewed it.
 *
 * A revision also CLEARS `support`. Now that approval measures entailment for
 * real (lib/learning/verify-support.js), the score on record was measured
 * against the wording that has just been replaced -- so leaving it would show
 * "support 0.87" beside text no entailment check has ever seen. That is
 * exactly the same lie as an invented number, arrived at by inertia. Clearing
 * it is not writing a score, it is recording that there is not one: the item
 * reads "not verified" until something measures it. Note this is null on the
 * DATA, not from the request -- `itemRevisionData` still refuses a caller-supplied
 * `support` outright.
 */
export function itemDecisionData(decision, body, existing) {
  if (decision === 'REVISE') {
    return { ...itemRevisionData(body, existing), support: null, status: 'APPROVED' };
  }
  return { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' };
}

/** How much of a release is still unreviewed — what makes partial ratification legible. */
export function itemReviewCounts(sections) {
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items : []) {
      if (counts[item?.status] !== undefined) counts[item.status] += 1;
    }
  }
  return counts;
}
