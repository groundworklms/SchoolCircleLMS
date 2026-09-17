/**
 * Project an approved COURSE_DRAFT LearningRecord into the first-class LMS
 * tables (Course / Section / Item) — see docs/03-data-model.md.
 *
 * LearningRecord stays the authoring and evidence store: the Coursewright
 * draft, its approval, tutor turns and mastery sessions all live there. The
 * typed rows are the delivery read model behind /api/courses, each carrying
 * the citation of the passage that grounds it and addressable by a stable id
 * so an Attempt or Schedule can point at it later.
 *
 * That citation is resolved PER ITEM. A section is grounded in up to four
 * passages (the top-K widening), and `cite` names only the highest-scoring
 * one; stamping it onto every item displayed a question drawn from the third
 * passage with the first passage's page number -- and the per-item review
 * screen asks a human to ratify exactly that claim. Given the passage index
 * (see `passages` below) each item is instead cited to the passage its own
 * text best matches, out of the set the section declared and never beyond it.
 *
 * Items are materialised PENDING. Generation proposes; a human ratifies. The
 * learner-facing queries in app/api/courses filter `status: 'APPROVED'`, so an
 * item only reaches a student once an instructor has approved (or revised and
 * approved) it item by item.
 *
 * Pure and deterministic. Ids derive from the record id, so re-approving the
 * same record materialises the same rows (the caller replaces, never appends).
 */

import { GROUNDING_THRESHOLD, groundingScore } from './grounding.js';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* A Coursewright section `cite` looks like "<sourceRecordId> p.3" (see
   sourcePassages in core.js) or a free label. Pull the page when it is there. */
function pageOf(cite) {
  const match = /\bp\.\s*([0-9A-Za-z-]+)/.exec(cite || '');
  return match ? match[1] : null;
}

/**
 * What it takes for a passage to MEANINGFULLY WIN an item away from the
 * section's primary citation. Both have to hold:
 *
 *   - it accounts for at least ten points more of the item's own vocabulary
 *     (the overlap is the fraction of the item's distinct tokens the passage
 *     contains), and
 *   - at least two more of the item's distinct tokens in absolute terms.
 *
 * The fraction alone is not enough, because it is coarse on short text: a nine
 * token lesson moves eleven points on ONE incidental word, which is arithmetic
 * and not provenance. The count alone is not enough either, because two tokens
 * out of forty is noise. Requiring both means a challenger has to hold several
 * of the item's own words that the primary does not -- evidence the item was
 * written from it.
 *
 * Anything short of that is a near tie: two passages saying much the same
 * thing about the same claim, with nothing to say the item came from one
 * rather than the other. The primary then stands. It is the passage retrieval
 * ranked first for this section and the label the section is already cited to,
 * so preferring it also means the same draft cannot materialise two different
 * page numbers across two runs.
 */
const MIN_CITATION_MARGIN = 0.1;
const MIN_CITATION_TOKEN_MARGIN = 2;

/**
 * The passage parts a single citation label addresses, in index order.
 *
 * One label can address several parts -- a page split across chunks, or the
 * bare source label that addresses every page of the source -- so this is a
 * list. The citation resolver below wants them as one body of text; the
 * entailment verifier wants them as separate spans. Both read the SAME
 * passages, because an item scored against text its citation does not name is
 * not verified, it is mismeasured.
 */
function spansForLabel(label, passages) {
  return passages
    .filter((passage) => Array.isArray(passage?.labels) && passage.labels.includes(label))
    .map((passage) => cleanText(passage?.text))
    .filter(Boolean);
}

/** The passage text a single citation label addresses, joined if it spans parts. */
function textForLabel(label, passages) {
  return spansForLabel(label, passages).join('\n\n');
}

/**
 * Which of a section's cited passages an individual item actually came from.
 *
 * Since the top-K widening a section is grounded in up to four passages, but
 * `cite` names only the highest-scoring one. Writing that single label onto
 * every item means a question drawn from the third passage is displayed -- and
 * ratified by a human -- with the first passage's page number. So each item is
 * scored against each declared passage on the project's own token overlap and
 * cited to the one it best matches.
 *
 * Deterministic, model-free, and conservative in every direction:
 *   - a passage the item does not clear the grounding floor against can never
 *     be cited, so a near-miss cannot pull the citation off the primary;
 *   - the challenger must beat the primary by MIN_CITATION_MARGIN;
 *   - equal scores keep the earlier label, and `cites` is in retrieval order,
 *     so ties resolve toward the better-ranked passage and never flip-flop;
 *   - anything unresolved returns the primary, which is exactly today's
 *     behaviour.
 *
 * @param {string[]} labels    the section's declared labels, primary first
 * @param {string} primary     the label used today for every item
 * @param {Array<{labels:string[],text:string}>} passages  the persisted index
 * @param {string} text        the item's load-bearing text
 */
function resolveLabel(labels, primary, passages, text) {
  const claim = cleanText(text);
  if (!claim || labels.length < 2 || passages.length === 0) return primary;

  const scored = labels.map((label) => {
    const passageText = textForLabel(label, passages);
    const score = passageText
      ? groundingScore(claim, passageText)
      : { tokens: 0, matched: 0, overlap: 0 };
    return {
      label,
      ...score,
      // Reuse the validator's floor: a passage this item is not grounded in is
      // not a passage this item can have come from, whatever it outscores. A
      // label that resolves to nothing persisted scores nothing and is never
      // citable.
      grounded: Boolean(passageText) && score.overlap >= GROUNDING_THRESHOLD,
    };
  });

  const head = scored.find((entry) => entry.label === primary);
  let best = null;
  for (const entry of scored) {
    if (!entry.grounded) continue;
    // Strictly greater, so the first label of an equal pair wins -- and `cites`
    // is in retrieval order, so a tie resolves toward the better-ranked passage.
    if (!best || entry.overlap > best.overlap) best = entry;
  }
  if (!best || best.label === primary) return primary;
  const wins =
    best.overlap - (head?.overlap ?? 0) >= MIN_CITATION_MARGIN &&
    best.matched - (head?.matched ?? 0) >= MIN_CITATION_TOKEN_MARGIN;
  return wins ? best.label : primary;
}

/**
 * The labels a section declares, primary first. `cites` is the full ordered
 * list the top-K grounding produced; `cite` is its head and the only label
 * older drafts carry. Nothing outside this set may ever be cited.
 */
function declaredLabels(section) {
  const cite = cleanText(section.cite);
  const cites = (Array.isArray(section.cites) ? section.cites : [])
    .map((label) => cleanText(label))
    .filter(Boolean);
  const ordered = [cite, ...cites].filter(Boolean);
  return [...new Set(ordered)];
}

function citationAt(label, sourceId) {
  if (!label && !sourceId) return null;
  return {
    citation: label || sourceId,
    pubId: sourceId || null,
    page: pageOf(label),
  };
}

/**
 * The per-item citation resolver for one section. Returns a function of the
 * item's load-bearing text.
 *
 * When there is nothing to resolve -- a single label, no `cites`, or no
 * passage index to resolve labels against -- it returns the one section-level
 * citation object every item shared before this change, so a draft without
 * `cites` materialises exactly as it did.
 */
function citationResolverFor(section, sourceId, passages) {
  const labels = declaredLabels(section);
  const primary = labels[0] || '';
  const shared = citationAt(primary, sourceId);
  if (labels.length < 2 || passages.length === 0) return () => shared;

  const declared = new Set(labels);
  return (text) => {
    const label = resolveLabel(labels, primary, passages, text);
    // Fail closed. A citation is a traceability claim a human is about to put
    // their name on, so a label the section did not declare is a bug in the
    // resolver, not a citation: fall back to the primary rather than emit it.
    if (!declared.has(label)) return shared;
    return label === primary ? shared : citationAt(label, sourceId);
  };
}

function questionItem({ id, question, cite }) {
  const stem = cleanText(question?.stem);
  if (!stem) return null;
  const options = Array.isArray(question.options)
    ? question.options.map((option) => (typeof option === 'string' ? option : cleanText(option?.text))).filter(Boolean)
    : null;
  const answer = Number.isInteger(question.answer) ? question.answer : null;
  const rationale = cleanText(question.rationale) || null;
  return {
    id,
    kind: 'QUESTION',
    stem,
    options,
    answer,
    rationale,
    // Stem plus rationale, and deliberately NOT the options. Those are the
    // question's load-bearing claims -- the same text validateCourseDraft
    // grounds a phase on (`${stem} ${rationale}`). Distractors are by
    // construction plausible statements the source does NOT make, so scoring
    // them against passages would grade a passage on text no passage should
    // contain and let the wrong option sway which page gets cited.
    citation: cite([stem, rationale].filter(Boolean).join(' ')),
    status: 'PENDING',
  };
}

/**
 * The single gate between a returned number and a stored support score.
 *
 * A support value is a finite probability or it is not a measurement, however
 * confidently it was serialised. Everything else -- undefined, null, a string,
 * NaN, 1.4 -- is "not verified", and there is deliberately no other branch:
 * nothing in this path may invent, estimate, floor or carry forward a score.
 * Lives here, with the pure materialisation rules, because both the verifier
 * (lib/learning/verify-support.js) and the writer (lib/db.js) must apply the
 * same test, and the writer must not take on a dependency on the HTTP client
 * to do it.
 */
export function measuredSupport(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/**
 * What one materialised item actually ASSERTS -- the text an entailment check
 * has to find supported by the passage it is cited to. Empty when the item
 * makes no checkable assertion, and an unscored item keeps `support: null`
 * rather than a guess.
 *
 * LESSON is its own prose. That IS the claim, and it is the claim the citation
 * was resolved on.
 *
 * QUESTION is the keyed answer, stated after the stem that gives it a subject,
 * plus the rationale. Note the difference from per-item citation resolution,
 * which scores `stem + rationale` and deliberately excludes the options:
 *
 *   - That resolver compares token overlap between the item and several
 *     passages. Distractors are by construction plausible statements the
 *     source does NOT make, so including them would let a wrong option decide
 *     which page gets cited. That reasoning still holds, and the distractors
 *     are still excluded here.
 *   - But the KEYED option is not a distractor; it is the assertion the item
 *     exists to make, and the one a student is graded against. And unlike
 *     token overlap, entailment is sensitive to grammatical mood: a stem on
 *     its own is usually an interrogative, which has no truth value for an
 *     entailment model to find supported. Measured against the live verifier,
 *     "How many phases make up the shot process?" alone scores 0.63 -- a
 *     middling number that means nothing -- while the same stem with its
 *     keyed answer and rationale scores 0.92 against the passage that states
 *     it, and 0.07 when the key is wrong. Excluding the key would publish the
 *     0.63.
 *
 * SCENARIO makes no claim about the source: it is a hypothetical situation and
 * a task, and its citation names the publication rather than any passage, so
 * there are no spans that would make a score mean anything. It is left
 * unverified rather than scored against passages it was never cited to.
 */
function verifiableClaim(item) {
  const stem = cleanText(item?.stem);
  const rationale = cleanText(item?.rationale);
  if (item?.kind === 'LESSON') return stem;
  if (item?.kind !== 'QUESTION') return '';
  const options = Array.isArray(item?.options) ? item.options : [];
  const keyed = Number.isInteger(item?.answer) ? cleanText(options[item.answer]) : '';
  // No key means nothing is asserted to be true, so there is nothing to check.
  if (!keyed) return '';
  return [stem, keyed, rationale].filter(Boolean).join(' ');
}

/**
 * The entailment checks a materialised course calls for: for each item that
 * makes a checkable claim, that claim and the passage spans its OWN citation
 * resolves to.
 *
 * Derived from the projection rather than from the draft, so the ids are the
 * ids that will be written and the spans are the passages the citation on the
 * row actually names. Pure: it decides what to measure, it does not measure.
 * lib/learning/verify-support.js runs these against the doctrine service.
 *
 * @param {Array} sections  sections as returned by projectCourseRows
 * @param {Array<{labels:string[],text:string}>} passages  the persisted index
 * @returns {Array<{id:string,claim:string,spans:string[]}>}
 */
export function itemVerificationTargets(sections, passages) {
  const index = Array.isArray(passages)
    ? passages.filter((passage) => cleanText(passage?.text))
    : [];
  if (index.length === 0) return [];
  const targets = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items : []) {
      if (typeof item?.id !== 'string' || !item.id) continue;
      const claim = verifiableClaim(item);
      if (!claim) continue;
      const label = cleanText(item?.citation?.citation);
      if (!label) continue;
      // Exactly the passages this item's citation addresses. A label that
      // resolves to nothing persisted -- a publication-level citation, or a
      // legacy free-text label -- yields no spans and so no measurement.
      const spans = spansForLabel(label, index);
      if (spans.length === 0) continue;
      targets.push({ id: item.id, claim, spans });
    }
  }
  return targets;
}

/**
 * Re-apply a status a human already recorded.
 *
 * Materialisation is the generator's output, so it always proposes PENDING.
 * If an Item id is already on record as APPROVED or REJECTED, that is a human
 * decision and must survive re-materialisation — a rewrite that silently reset
 * it to PENDING would discard the ratification, and one that reset it to
 * APPROVED would be worse. Pure so it can be tested without a database.
 *
 * @param {Array} sections  sections as returned by projectCourseRows
 * @param {Map<string,string>|object} existingStatusById  item id -> current ItemStatus
 */
export function withPreservedItemStatus(sections, existingStatusById) {
  const lookup = existingStatusById instanceof Map
    ? (id) => existingStatusById.get(id)
    : (id) => (existingStatusById || {})[id];
  return (Array.isArray(sections) ? sections : []).map((section) => ({
    ...section,
    items: (Array.isArray(section?.items) ? section.items : []).map((item) => {
      const recorded = lookup(item.id);
      return recorded === 'APPROVED' || recorded === 'REJECTED'
        ? { ...item, status: recorded }
        : item;
    }),
  }));
}

/**
 * @param {string} recordId  the COURSE_DRAFT LearningRecord id (becomes Course.id)
 * @param {object} payload   the record payload (Coursewright output + title/sourceIds)
 * @param {object} [options]
 * @param {string|null} [options.sourceId]  the human-readable Anchor id of the first
 *   approved source, e.g. "TC 3-22.9"; stored on Course.sourceId and each citation
 * @param {Array<{labels:string[],text:string}>} [options.passages]  the approved
 *   sources' addressable passages, as `sourcePassageIndex` in lib/arsenal-core.js
 *   builds them. Supplying it turns on per-item citation resolution; omitting it
 *   (the legacy materialisation seam, and any draft without `cites`) keeps the
 *   section's primary label on every item, exactly as before.
 */
/**
 * The structured teaching content a section carries beside its prose: the
 * intro, authored pages and diagram-label explanations the grounded page pass
 * wrote (lib/arsenal-core.js `expandCoursePages`), plus the diagram and
 * flashcards Coursewright generated. It rides on the LESSON row's `options`
 * column -- unused for that kind -- so the SAME ratification decision that
 * releases the prose releases the pages a learner reads it through, and a
 * withheld lesson withholds all of it. Null when the section has none, so a
 * bare micro-lesson materialises exactly as before.
 */
export function lessonContent(section) {
  if (!section || typeof section !== 'object') return null;
  const content = {};
  if (cleanText(section.intro)) content.intro = cleanText(section.intro);
  if (Array.isArray(section.pages) && section.pages.length) content.pages = section.pages;
  if (Array.isArray(section.labels) && section.labels.length) content.labels = section.labels;
  if (section.diagram && typeof section.diagram === 'object' && Array.isArray(section.diagram.elements) && section.diagram.elements.length) {
    content.diagram = section.diagram;
  }
  if (Array.isArray(section.flashcards) && section.flashcards.length) content.flashcards = section.flashcards;
  return Object.keys(content).length ? content : null;
}

export function projectCourseRows(recordId, payload, { sourceId = null, passages = [] } = {}) {
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw new TypeError('recordId is required');
  }
  const draft = payload && typeof payload === 'object' ? payload : {};
  const title = cleanText(draft.title) || cleanText(draft.course?.title) || 'Untitled course';
  const sections = Array.isArray(draft.sections) ? draft.sections : [];
  const passageIndex = Array.isArray(passages) ? passages.filter((passage) => cleanText(passage?.text)) : [];

  const rows = sections.map((section, index) => {
    const sectionId = `${recordId}:s${index + 1}`;
    const cite = citationResolverFor(section || {}, sourceId, passageIndex);
    const items = [];

    const lesson = cleanText(section?.lesson);
    if (lesson) {
      // A lesson is scored on its own prose -- that IS the claim being cited.
      items.push({ id: `${sectionId}:lesson`, kind: 'LESSON', stem: lesson, options: lessonContent(section), answer: null, rationale: null, citation: cite(lesson), status: 'PENDING' });
    }
    for (const phase of ['pre', 'post']) {
      const questions = Array.isArray(section?.[phase]) ? section[phase] : [];
      questions.forEach((question, qi) => {
        const item = questionItem({ id: `${sectionId}:${phase}${qi + 1}`, question, cite });
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
        status: 'PENDING',
      }],
    });
  }

  return {
    course: { id: recordId, title, sourceId: sourceId || 'unknown' },
    sections: rows,
  };
}
