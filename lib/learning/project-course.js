/**
 * Project an approved COURSE_DRAFT LearningRecord into the first-class LMS
 * tables (Course / Section / Item) — see docs/03-data-model.md.
 *
 * LearningRecord stays the authoring and evidence store: the Coursewright
 * draft, its approval, tutor turns and mastery sessions all live there. The
 * typed rows are the delivery read model behind /api/courses: every item a
 * learner can see, each carrying the citation of the section that grounds it,
 * and each addressable by a stable id so an Attempt or Schedule can point at
 * it later.
 *
 * Pure and deterministic. Ids derive from the record id, so re-approving the
 * same record materialises the same rows (the caller replaces, never appends).
 */

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* A Coursewright section `cite` looks like "<sourceRecordId> p.3" (see
   sourcePassages in core.js) or a free label. Pull the page when it is there. */
function pageOf(cite) {
  const match = /\bp\.\s*([0-9A-Za-z-]+)/.exec(cite || '');
  return match ? match[1] : null;
}

function citationFor(section, sourceId) {
  const cite = cleanText(section.cite);
  if (!cite && !sourceId) return null;
  return {
    citation: cite || sourceId,
    pubId: sourceId || null,
    page: pageOf(cite),
  };
}

function questionItem({ id, question, citation }) {
  const stem = cleanText(question?.stem);
  if (!stem) return null;
  const options = Array.isArray(question.options)
    ? question.options.map((option) => (typeof option === 'string' ? option : cleanText(option?.text))).filter(Boolean)
    : null;
  const answer = Number.isInteger(question.answer) ? question.answer : null;
  return {
    id,
    kind: 'QUESTION',
    stem,
    options,
    answer,
    rationale: cleanText(question.rationale) || null,
    citation,
    status: 'APPROVED',
  };
}

/**
 * @param {string} recordId  the COURSE_DRAFT LearningRecord id (becomes Course.id)
 * @param {object} payload   the record payload (Coursewright output + title/sourceIds)
 * @param {{ sourceId?: string|null }} [options]  the human-readable Anchor id of the
 *   first approved source, e.g. "TC 3-22.9"; stored on Course.sourceId and each citation
 */
export function projectCourseRows(recordId, payload, { sourceId = null } = {}) {
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw new TypeError('recordId is required');
  }
  const draft = payload && typeof payload === 'object' ? payload : {};
  const title = cleanText(draft.title) || cleanText(draft.course?.title) || 'Untitled course';
  const sections = Array.isArray(draft.sections) ? draft.sections : [];

  const rows = sections.map((section, index) => {
    const sectionId = `${recordId}:s${index + 1}`;
    const citation = citationFor(section || {}, sourceId);
    const items = [];

    const lesson = cleanText(section?.lesson);
    if (lesson) {
      items.push({ id: `${sectionId}:lesson`, kind: 'LESSON', stem: lesson, options: null, answer: null, rationale: null, citation, status: 'APPROVED' });
    }
    for (const phase of ['pre', 'post']) {
      const questions = Array.isArray(section?.[phase]) ? section[phase] : [];
      questions.forEach((question, qi) => {
        const item = questionItem({ id: `${sectionId}:${phase}${qi + 1}`, question, citation });
        if (item) items.push(item);
      });
    }

    return {
      id: sectionId,
      title: cleanText(section?.title) || `Section ${index + 1}`,
      order: index,
      items,
    };
  });

  // The course-level scenario, when Coursewright produced one, is its own
  // item under a trailing section so it is addressable like everything else.
  const scenario = draft.scenario && typeof draft.scenario === 'object' ? draft.scenario : null;
  const situation = cleanText(scenario?.situation);
  if (situation) {
    const sectionId = `${recordId}:scenario`;
    rows.push({
      id: sectionId,
      title: 'Scenario',
      order: rows.length,
      items: [{
        id: `${sectionId}:item`,
        kind: 'SCENARIO',
        stem: [situation, cleanText(scenario.task)].filter(Boolean).join('\n\n'),
        options: null,
        answer: null,
        rationale: cleanText(scenario.coaching) || null,
        citation: sourceId ? { citation: sourceId, pubId: sourceId, page: null } : null,
        status: 'APPROVED',
      }],
    });
  }

  return {
    course: { id: recordId, title, sourceId: sourceId || 'unknown' },
    sections: rows,
  };
}
