/**
 * The learner's half of a generated course: answering a check, and the record
 * that makes the answer evidence.
 *
 * WHY THIS EXISTS. Generation, grounding, verification and per-item
 * ratification all end at an approved Item row — and nothing ever wrote back.
 * A learner could read a generated course but not DO anything in it, so every
 * surface downstream of an answer (class gaps, learning gain, My Progress, the
 * roster's "this learner is actually working this course" relationship) had no
 * data because none was ever captured.
 *
 * WHERE AN ANSWER IS RECORDED, AND WHY THERE. It becomes a `MASTERY_ATTEMPT`
 * LearningRecord owned by the answering learner. That is not a new store
 * invented here: it is the exact row shape the evidence store already reads
 * (lib/db.js `listLearnerAttempts` / `listCohortAttempts`), which requires a
 * `courseId`, a matching `releaseId`, a `pre`/`post` phase, a boolean
 * `correct` and an objective before Sextant will look at it. Writing anything
 * else would have meant a second shape for the same fact and two halves free
 * to drift. It is also already one of the roster's learner-participation types
 * (lib/roster/service.js), so answering a check registers the same real
 * relationship a saved mastery session does.
 *
 * WHAT IS DELIBERATELY NOT HERE. No approval, grounding or citation rule is
 * touched. The answerable set is the APPROVED half of the materialised
 * delivery rows and nothing else, so an item a human has not ratified can
 * neither be shown nor answered — the gate stays where it already was rather
 * than being re-implemented at the answer boundary.
 */
import {
  createLearningRecord,
  getLearningRecord,
  listDeliveryCourseItems,
  listLearningRecords,
} from '../db.js';
import { projectLearnerLessons, selectedDeliveryId } from './delivery.js';

/** The record type the evidence store already reads scored attempts from. */
export const COURSE_ATTEMPT = 'MASTERY_ATTEMPT';

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  error.status = 404;
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.code = 'CONFLICT';
  error.status = 409;
  return error;
}

function requiredId(value, label) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw badRequest(`${label} is required`);
  return id;
}

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload
    : {};
}

/**
 * Where a materialised item sits in the course a learner is reading.
 *
 * The id grammar belongs to ./project-course.js — `<record>:s<n>:lesson`,
 * `<record>:s<n>:pre<k>`, `<record>:s<n>:post<k>` — and this is the only place
 * it is read back. It is parsed rather than recomputed on the client because
 * the phase decides whether Sextant can use the attempt at all, and a learner
 * must not be the one asserting which half of a pre/post pair they answered.
 *
 * Returns null for anything outside the grammar: a legacy typed course seeded
 * with its own ids is still answerable, it simply carries no phase.
 */
export function itemAddress(itemId) {
  const match = /:(pre|post)([0-9]+)$/.exec(typeof itemId === 'string' ? itemId : '');
  if (!match) return null;
  return { phase: match[1], ordinal: Number(match[2]) };
}

/**
 * The learner-facing half of one approved question.
 *
 * The stem and choices come from the TYPED row rather than the authoring
 * draft, because the keyed answer this module grades against is an index into
 * that row's `options`. Rendering the choices from one store and grading them
 * against another would let the two drift into an answer key pointing at text
 * the learner never saw. `answer`, `rationale` and `support` are simply not
 * copied — the learner reader never receives them before an answer.
 */
export function answerableItem(item, sectionIndex, sectionTitle) {
  const address = itemAddress(item?.id);
  return {
    id: item.id,
    sectionIndex,
    sectionTitle,
    phase: address?.phase || null,
    ordinal: address?.ordinal ?? null,
    stem: typeof item?.stem === 'string' ? item.stem : '',
    options: (Array.isArray(item?.options) ? item.options : []).map((option) => String(option)),
  };
}

/**
 * Which choice a learner picked.
 *
 * A choice has no id of its own on a materialised row: the keyed answer IS an
 * index into `options`, so the index is the choice's identity and the string
 * form is what travels over the wire. Anything that is not an in-range index
 * is refused rather than coerced, because a coerced index grades a different
 * choice than the learner clicked.
 */
export function optionIndexOf(optionId, optionCount) {
  const text = typeof optionId === 'number' ? String(optionId) : String(optionId ?? '').trim();
  // Number('') is 0, so a blank choice would grade as the first option.
  const raw = text ? Number(text) : NaN;
  if (!Number.isInteger(raw) || raw < 0 || raw >= optionCount) {
    throw badRequest('optionId must be the index of one of the choices on this item');
  }
  return raw;
}

/**
 * Grade one answer, in the same shape the published reader's `gradeBlock`
 * returns (lib/authoring/content.js). Identical field names are the point:
 * app/_course/CoursePresentation renders `result.correct` and
 * `result.feedback` and stores the result under `answers[blockId]`, so a
 * generated course and a published manual course give a learner the same
 * experience without a second presentation path.
 *
 * The rationale is the feedback. It is the "why" a human ratified alongside
 * the key, and it crosses to the learner HERE and only here — after they have
 * committed to a choice, never in the reader's course payload.
 */
export function gradeItem(item, optionId) {
  const options = Array.isArray(item?.options) ? item.options : [];
  const index = optionIndexOf(optionId, options.length);
  if (!Number.isInteger(item?.answer) || item.answer < 0 || item.answer >= options.length) {
    // An approved question with no usable key cannot be graded, and marking
    // every answer wrong would be inventing a grade rather than reporting one.
    throw conflict('This question has no keyed answer on record and cannot be graded.');
  }
  return {
    blockId: item.id,
    optionId: String(index),
    correct: item.answer === index,
    feedback: typeof item?.rationale === 'string' ? item.rationale : '',
  };
}

/**
 * The learner's own recorded answers for one release, newest first wins.
 *
 * Attempts are append-only, so a learner who tries a second choice leaves both
 * on record (the miss is real evidence and stays countable); what the reader
 * shows back is simply the most recent one.
 */
export function recordedAnswers(records, courseId, releaseId) {
  const answers = {};
  for (const record of Array.isArray(records) ? records : []) {
    const payload = payloadOf(record);
    if (payload.courseId !== courseId || payload.releaseId !== releaseId) continue;
    if (typeof payload.itemId !== 'string' || !payload.itemId) continue;
    if (answers[payload.itemId]) continue;
    const result = payload.result && typeof payload.result === 'object' ? payload.result : null;
    if (!result || typeof result.correct !== 'boolean') continue;
    answers[payload.itemId] = {
      optionId: String(result.optionId ?? payload.optionId ?? ''),
      correct: result.correct,
      feedback: typeof result.feedback === 'string' ? result.feedback : '',
    };
  }
  return answers;
}

/**
 * The persistence seam, mirroring lib/learning/evidence.js: the handlers stay
 * free of Prisma so the authorization and grading rules can be exercised
 * against an in-memory store.
 */
export function createCourseAttemptStore() {
  return {
    getCourseRecord: (id) => getLearningRecord(id),
    listReleaseSections: (releaseId) => listDeliveryCourseItems(releaseId),
    listLearnerAttempts: (learnerId) =>
      listLearningRecords({ ownerId: learnerId, type: COURSE_ATTEMPT }),
    saveAttempt: (learnerId, payload) =>
      createLearningRecord({ ownerId: learnerId, type: COURSE_ATTEMPT, status: 'RECORDED', payload }),
  };
}

export function createCourseAttemptHandlers({ store } = {}) {
  if (!store || typeof store !== 'object') {
    throw new TypeError('createCourseAttemptHandlers: store is required');
  }

  /**
   * Resolve the course a learner is answering in, and refuse everything else.
   *
   * This is the same rule the delivery projection applies (app/api/courses):
   * only an APPROVED COURSE_DRAFT is delivered, and an explicit release pin
   * must be one of that root's own approved releases. An instructor's
   * unapproved draft is not answerable through this route by anyone — the
   * owner-visibility branch of `canViewCourse` exists for authoring, and
   * recording learner evidence against unreviewed content is not authoring.
   */
  async function deliveryContext(courseId, requestedReleaseId) {
    const record = await store.getCourseRecord(requiredId(courseId, 'Course id'));
    if (!record || record.type !== 'COURSE_DRAFT' || record.status !== 'APPROVED') {
      throw notFound('Course not found');
    }
    const releaseId = selectedDeliveryId(record, requestedReleaseId);
    if (!releaseId) throw notFound('Release not found');
    return { record, releaseId };
  }

  /**
   * Everything of the selected release a learner may be shown -- the approved
   * questions and the approved lesson PROSE -- keyed by where each sits in the
   * course they are reading, plus that learner's own answers so far.
   *
   * `sectionIndex` is `Section.order`, which materialisation sets to the
   * draft's own section index, so the reader can place an item against the
   * section it is rendering without reconstructing an id.
   *
   * Prose is here rather than on the authoring read for the reason the whole
   * route exists: this is the response that has already passed the ratification
   * gate. Serving the reader's text from anywhere else is what let a PENDING
   * lesson reach a student. See `projectLearnerLessons`.
   */
  async function answerable(record, releaseId, learnerId) {
    const sections = await store.listReleaseSections(releaseId);
    const lessons = projectLearnerLessons(sections);
    const items = [];
    (Array.isArray(sections) ? sections : []).forEach((section, index) => {
      const sectionIndex = Number.isInteger(section?.order) ? section.order : index;
      for (const item of Array.isArray(section?.items) ? section.items : []) {
        // The ratification gate, unchanged: PENDING and REJECTED content is
        // not listed, so a learner never sees it and cannot answer it.
        if (item?.status !== 'APPROVED' || item?.kind !== 'QUESTION') continue;
        items.push(answerableItem(item, sectionIndex, section?.title || ''));
      }
    });
    const records = await store.listLearnerAttempts(learnerId);
    return { items, lessons, answers: recordedAnswers(records, record.id, releaseId) };
  }

  return {
    /** GET — what this learner may answer, and what they have already answered. */
    async getCourseAttempts(identity, { params = {}, query = {} } = {}) {
      const { record, releaseId } = await deliveryContext(params.id, query.releaseId);
      const state = await answerable(record, releaseId, identity.id);
      return { json: { id: record.id, releaseId, ...state } };
    },

    /**
     * POST — record one answer.
     *
     * `attemptId` carries the same idempotency contract as the published
     * reader (app/prototype/published/client.js `createStableAttemptManager`):
     * a retry of the same answer replays the stored result instead of banking
     * a second one, and reusing an id for a different answer is a conflict
     * rather than a silent overwrite.
     */
    async recordCourseAttempt(identity, { params = {}, body = {} } = {}) {
      const itemId = requiredId(body?.itemId, 'itemId');
      const attemptId = requiredId(body?.attemptId, 'attemptId');
      if (body?.optionId === undefined || body?.optionId === null) {
        throw badRequest('optionId is required');
      }
      const { record, releaseId } = await deliveryContext(params.id, body?.releaseId);

      const sections = await store.listReleaseSections(releaseId);
      let found = null;
      for (const section of Array.isArray(sections) ? sections : []) {
        const match = (Array.isArray(section?.items) ? section.items : [])
          .find((candidate) => candidate?.id === itemId);
        if (match) {
          found = { item: match, section };
          break;
        }
      }
      // One message for "no such item", "not in this course", "not ratified"
      // and "not a question". A learner probing ids must not be able to tell a
      // withheld item from an absent one.
      if (!found || found.item.status !== 'APPROVED' || found.item.kind !== 'QUESTION') {
        throw notFound('Item not found');
      }

      const previousRecords = await store.listLearnerAttempts(identity.id);
      const previous = previousRecords
        .map(payloadOf)
        .find((payload) => payload.attemptId === attemptId && payload.courseId === record.id);
      if (previous) {
        const result = previous.result && typeof previous.result === 'object' ? previous.result : null;
        if (!result || previous.itemId !== itemId || String(result.optionId) !== String(body.optionId)) {
          throw conflict('Attempt id was already used for another answer.');
        }
        return { json: { result, releaseId, recorded: false } };
      }

      const result = gradeItem(found.item, body.optionId);
      const address = itemAddress(found.item.id);
      await store.saveAttempt(identity.id, {
        courseId: record.id,
        releaseId,
        itemId: found.item.id,
        sectionId: found.section?.id || null,
        attemptId,
        optionId: result.optionId,
        correct: result.correct,
        // Sextant groups class gaps and learning gain by objective; the
        // section title is the same key lib/db.js `classGaps` groups the typed
        // Attempt table by, so both aggregates name a gap the same way.
        objective: found.section?.title || 'overall',
        // Only when the id grammar actually states it. An attempt with no
        // phase stays on record and simply does not enter a pre/post gain
        // calculation — better than asserting a half it was not asked in.
        ...(address ? { phase: address.phase } : {}),
        // The passage the key was graded against, recorded beside the grade
        // for the same reason Attempt.gradedAgainst exists on the typed row.
        gradedAgainst: found.item.citation ?? null,
        result,
      });
      return { status: 201, json: { result, releaseId, recorded: true } };
    },
  };
}

let productionHandlers = null;

/** Handlers bound to Prisma persistence (built once per process). */
export function courseAttemptHandlers() {
  if (!productionHandlers) {
    productionHandlers = createCourseAttemptHandlers({ store: createCourseAttemptStore() });
  }
  return productionHandlers;
}
