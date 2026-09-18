/**
 * Whole-course planning: survey -> outline -> map -> build, one bounded step
 * per request.
 *
 * A COURSE_PLAN LearningRecord holds the plan; the course it builds is an
 * ordinary COURSE_DRAFT that grows one section per build step and is then
 * reviewed, approved and ratified exactly like a hand-drafted one. Every step
 * is idempotent and resumable: the client calls it until the plan says the
 * stage is done, and a step that fails leaves the plan where it was.
 *
 * Why one lesson per request: a 48-lesson course is an hour of model calls.
 * No single HTTP request survives that on the hosted runtime, and a failure
 * forty minutes in must not throw away thirty-nine good lessons. So the unit of
 * work is one lesson, its result is saved before the response is sent, and
 * the plan carries the pointer to the next one.
 */
import {
  cleanPlanOutline,
  draftCourse,
  outlineCoursePlan,
  outlineFromLessonCodes,
  passageIndex,
  rankPassages,
  sampleSourceText,
  surveyBatches,
  surveySourceBatch,
  writeLessonObjectives,
} from '../arsenal-core.js';
import { hasRole } from '../auth.js';
import {
  createLearningRecord,
  deleteLearningRecords,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecordIfVersion,
} from '../db.js';
import { createRecordWithSourceGuards, sourceFor } from '../source/library.js';
import { buildCourseRubricsRecord, sourceDocuments } from './core.js';
import { normaliseCourseIds } from './course-revisions.js';
import { notFound } from './http.js';

export const COURSE_PLAN = 'COURSE_PLAN';
const INSTRUCTOR = 'INSTRUCTOR';

// Sources surveyed per request. Each is up to one model call; three keeps a
// request well under the hosted timeout with the largest documents.
const SURVEY_SOURCES_PER_STEP = 3;
// Stages, in order. `status` on the plan is the stage it is IN.
/* The stages a whole-course plan moves through.
 *
 * `rubrics` is its own stage rather than a tail on `build` because a BARS
 * rubric is a model call per objective, and sixteen of them inside the request
 * that finishes the last lesson would be well past the 300-second ceiling. The
 * client already repeats a short request until the status moves on; this stage
 * writes one rubric per call and uses that loop. */
const STAGES = ['survey', 'outline', 'map', 'build', 'rubrics', 'complete'];

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' ? record.payload : {};
}

function conflict(message) {
  const error = new Error(message);
  error.code = 'CONFLICT';
  error.status = 409;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  error.status = 400;
  return error;
}

/* A source document's record id is the first token of its citation label
   ("<record id> p.N", see core.js sourcePassages). */
function recordIdOf(label) {
  return typeof label === 'string' ? label.trim().split(/\s+/)[0] : '';
}

/** Every lesson of a plan, in order, with its annex. Pure; exported for test. */
export function planLessons(payload) {
  const out = [];
  for (const annex of Array.isArray(payload?.annexes) ? payload.annexes : []) {
    for (const lesson of Array.isArray(annex?.lessons) ? annex.lessons : []) {
      out.push({ ...lesson, annex: { letter: annex.letter, title: annex.title } });
    }
  }
  return out;
}

/** What the client draws: the plan without any source text. Pure. */
export function planView(record) {
  const p = payloadOf(record);
  const lessons = planLessons(p);
  const counts = { planned: 0, building: 0, drafted: 0, failed: 0, ungrounded: 0, skipped: 0 };
  for (const lesson of lessons) counts[lesson.status] = (counts[lesson.status] || 0) + 1;
  return {
    id: record.id,
    version: Number.isInteger(record.version) ? record.version : 0,
    status: p.status || 'survey',
    title: p.title || '',
    sourceIds: Array.isArray(p.sourceIds) ? p.sourceIds : [],
    survey: Array.isArray(p.survey) ? p.survey : [],
    surveyed: Array.isArray(p.survey) ? p.survey.length : 0,
    annexes: Array.isArray(p.annexes) ? p.annexes : [],
    dropped: Array.isArray(p.dropped) ? p.dropped : [],
    lessons: lessons.length,
    counts,
    courseId: p.courseId || null,
    outlinedFrom: p.outlinedFrom || null,
    diagrams: p.diagrams === true,
    error: p.error || null,
    updatedAt: record.updatedAt,
  };
}

async function ownedPlan(identity, id) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Plan not found');
  const record = await getLearningRecord(id);
  if (!record || record.type !== COURSE_PLAN || record.ownerId !== identity.id) throw notFound('Plan not found');
  return record;
}

async function savePlan(record, payload) {
  const version = Number.isInteger(record.version) ? record.version : 0;
  const committed = await updateLearningRecordIfVersion(record.id, version, { payload });
  if (!committed) throw conflict('This plan changed while a step was running; reload and continue.');
  return { ...record, version: version + 1, payload };
}

async function planSources(identity, payload) {
  const ids = Array.isArray(payload.sourceIds) ? payload.sourceIds : [];
  return Promise.all(ids.map((id) => sourceFor(identity, id, { approvedOnly: true })));
}

function sourceTitle(record) {
  const body = payloadOf(record);
  return body.title || body.sourceId || record.id;
}

/* ---------------- handlers ---------------- */

export async function createPlan(identity, { body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Plan not found');
  const { title, sourceIds, diagrams = false } = body || {};
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) throw new TypeError('sourceIds must be a non-empty array');
  const unique = [...new Set(sourceIds)];
  if (unique.some((id) => typeof id !== 'string' || !id.trim())) throw new TypeError('sourceIds must contain non-empty strings');
  // Every source must be approved now; the plan remembers the ids and
  // re-checks approval at each step, since a source can be withdrawn later.
  await Promise.all(unique.map((id) => sourceFor(identity, id, { approvedOnly: true })));
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: COURSE_PLAN,
    status: 'PENDING',
    payload: {
      title: typeof title === 'string' ? title.trim() : '',
      sourceIds: unique,
      diagrams: diagrams === true,
      status: 'survey',
      survey: [],
      annexes: [],
      dropped: [],
      courseId: null,
    },
  });
  return { status: 201, json: planView(record) };
}

export async function listPlans(identity) {
  if (!hasRole(identity?.role, INSTRUCTOR)) return { json: [] };
  const records = await listLearningRecords({ ownerId: identity.id, type: COURSE_PLAN });
  return { json: records.map(planView) };
}

export async function getPlan(identity, { params }) {
  const record = await ownedPlan(identity, params.id);
  return { json: planView(record) };
}

/**
 * Survey the next few unsurveyed sources. Repeat until `status` moves on.
 */
export async function surveyPlanStep(identity, { params }) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  if (payload.status !== 'survey') return { json: planView(record) };
  const done = new Set((payload.survey || []).map((s) => s.id));
  const pending = (payload.sourceIds || []).filter((id) => !done.has(id)).slice(0, SURVEY_SOURCES_PER_STEP);
  if (pending.length === 0) {
    const saved = await savePlan(record, { ...payload, status: 'outline', error: null });
    return { json: planView(saved) };
  }
  const sources = await Promise.all(pending.map((id) => sourceFor(identity, id, { approvedOnly: true })));
  const samples = sources.map((source) => ({
    id: source.id,
    title: sourceTitle(source),
    text: sampleSourceText(sourceDocuments(source)),
  })).filter((sample) => sample.text.trim());
  const surveyed = [];
  for (const batch of surveyBatches(samples)) {
    const entries = await surveySourceBatch({ samples: batch });
    for (const entry of entries) {
      const source = sources.find((s) => s.id === entry.id);
      surveyed.push({ ...entry, title: source ? sourceTitle(source) : entry.id });
    }
  }
  // A source with no text at all is surveyed as empty rather than blocking.
  for (const source of sources) {
    if (!surveyed.some((s) => s.id === source.id)) {
      surveyed.push({ id: source.id, title: sourceTitle(source), kind: 'other', summary: '', topics: [], lessons: [], missing: true });
    }
  }
  const survey = [...(payload.survey || []), ...surveyed];
  const complete = survey.length >= (payload.sourceIds || []).length;
  const saved = await savePlan(record, { ...payload, survey, status: complete ? 'outline' : 'survey', error: null });
  return { json: planView(saved) };
}

/** Outline annexes and lessons from the survey. One model call. */
export async function outlinePlanStep(identity, { params, body }) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  // `again` re-outlines a plan past this stage. A draft it has already built
  // is left where it is -- an orphan in Courses, removable from its own row --
  // and the next build starts a new one: sections built for one outline's
  // lessons cannot be trusted to be another outline's.
  const redo = body?.again === true;
  if (payload.status !== 'outline' && !(redo && ['map', 'build', 'rubrics', 'complete'].includes(payload.status))) {
    return { json: planView(record) };
  }
  if (!Array.isArray(payload.survey) || payload.survey.length === 0) throw conflict('Survey the sources before outlining.');
  // Coded titles decide the structure; the model writes only the objectives.
  // An uncoded corpus keeps the model outline.
  const coded = outlineFromLessonCodes(payload.survey);
  const outline = coded
    ? await (async () => {
      const lessons = planLessons(coded);
      const objectives = await writeLessonObjectives({ lessons });
      let fallbacks = 0;
      const annexes = coded.annexes.map((annex) => ({
        ...annex,
        lessons: annex.lessons.map((lesson) => {
          const { catalogue, ...rest } = lesson;
          if (lesson.kind === 'exam') return rest;
          const written = objectives.get(lesson.id);
          if (written?.fallback) fallbacks += 1;
          return { ...rest, objective: written?.objective || `Explain ${lesson.title}.`, objectiveFallback: Boolean(written?.fallback) };
        }),
      }));
      return { title: payload.title, annexes, dropped: [], coded: coded.coded, fallbacks };
    })()
    : await outlineCoursePlan({ title: payload.title, survey: payload.survey });
  if (!outline.annexes.length) {
    const error = new Error('The outline produced no lessons with a testable objective.');
    error.code = 'PLAN_OUTLINE_EMPTY';
    error.status = 422;
    throw error;
  }
  const saved = await savePlan(record, {
    ...payload,
    title: payload.title || outline.title,
    annexes: outline.annexes,
    dropped: outline.dropped,
    outlinedFrom: coded ? 'lesson-codes' : 'model',
    ...(redo ? { courseId: null, previousCourseIds: [...(payload.previousCourseIds || []), ...(payload.courseId ? [payload.courseId] : [])] } : {}),
    status: 'map',
    error: null,
  });
  return { json: planView(saved) };
}

/**
 * Map sources to lessons by retrieval -- no model. For each lesson the
 * passages that would ground it are ranked across every selected source; the
 * sources those passages belong to are the lesson's. A lesson no passage
 * covers is marked `ungrounded` here rather than failing at build.
 */
export async function mapPlanStep(identity, { params }) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  if (payload.status !== 'map') return { json: planView(record) };
  const sources = await planSources(identity, payload);
  const documents = sources.flatMap(sourceDocuments);
  const index = passageIndex(documents);
  const knownIds = new Set(sources.map((s) => s.id));
  const annexes = (payload.annexes || []).map((annex) => ({
    ...annex,
    lessons: (annex.lessons || []).map((lesson) => {
      if (lesson.kind === 'exam') return { ...lesson, sourceIds: (lesson.suggestedSourceIds || []).filter((id) => knownIds.has(id)) };
      const hits = rankPassages(lesson.objective, index);
      const hitIds = [...new Set(hits.map((hit) => recordIdOf(hit.source)).filter((id) => knownIds.has(id)))];
      const suggested = (lesson.suggestedSourceIds || []).filter((id) => knownIds.has(id));
      // A lesson's own coded documents are the pool when they ground it: the
      // build reads every mapped source and retrieval picks by score, so
      // merely listing the plan and handout for BE0204 first would still let
      // a passage in another lesson's book that scores higher write BE0204.
      // Only a lesson none of its own documents cover reads the wider corpus.
      const own = suggested.filter((id) => hitIds.includes(id));
      const kept = own.length ? hits.filter((hit) => own.includes(recordIdOf(hit.source))) : hits;
      const sourceIds = own.length ? own : hitIds.length ? [...new Set([...hitIds, ...suggested])] : suggested;
      return {
        ...lesson,
        sourceIds,
        cites: kept.map((hit) => hit.source),
        passages: kept.length,
        status: kept.length ? 'planned' : 'ungrounded',
        reason: kept.length ? null : 'no approved passage covers this objective',
      };
    }),
  }));
  const saved = await savePlan(record, { ...payload, annexes, status: 'build', error: null });
  return { json: planView(saved) };
}

/**
 * Build the next planned lesson: draftCourse with that one objective over the
 * lesson's mapped sources, appended as a section of the plan's course draft.
 * The first build creates the draft. Repeat until `status` is `complete`.
 */
export async function buildPlanStep(identity, { params }, { emit } = {}) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  if (payload.status !== 'build') return { json: planView(record) };
  const lessons = planLessons(payload);
  const next = lessons.find((lesson) => lesson.status === 'planned');
  if (!next) {
    // Every lesson is written. A course with no draft behind it -- every lesson
    // refused -- has nothing to write rubrics against, so it finishes here.
    const saved = await savePlan(record, {
      ...payload,
      status: payload.courseId ? 'rubrics' : 'complete',
      error: null,
    });
    return { json: planView(saved) };
  }

  // Only the lesson's mapped sources are read -- a hundred full documents per
  // lesson is what made this slow -- and a lesson the map could not place
  // falls back to every source, so it still gets the retrieval draftCourse
  // always does.
  const mappedIds = (next.sourceIds || []).filter((id) => (payload.sourceIds || []).includes(id));
  const pool = mappedIds.length
    ? await Promise.all(mappedIds.map((id) => sourceFor(identity, id, { approvedOnly: true })))
    : await planSources(identity, payload);
  const documents = pool.flatMap(sourceDocuments);

  let section = null;
  let failure = null;
  try {
    const course = await draftCourse(
      { title: next.title, objectives: [next.objective], documents, diagrams: payload.diagrams === true, pages: true },
      { emit },
    );
    const built = normaliseCourseIds(course);
    section = Array.isArray(built.sections) ? built.sections[0] : null;
    if (!section) {
      const skipped = Array.isArray(course.skippedObjectives) ? course.skippedObjectives[0] : null;
      failure = (skipped && (skipped.reason || skipped)) || 'no section was generated';
    }
  } catch (error) {
    // A missing provider is not a lesson failure: nothing was tried.
    if (error?.code === 'NO_PROVIDER' || error?.code === 'MODEL_UNAVAILABLE' || error?.code === 'ARSENAL_UNAVAILABLE') throw error;
    failure = error?.message || 'generation failed';
  }

  let courseId = payload.courseId || null;
  if (section) {
    const placed = {
      ...section,
      id: next.id,
      title: next.title,
      // The plan's objective, not whatever the generator restated it as. It is
      // the string written into the draft's own `objectives` list two lines
      // below, and a rubric may only claim an objective the draft actually
      // teaches -- so if these two disagreed, every rubric for this course
      // would be written unlinked and deriveMasteryPlan would never find one.
      objective: next.objective,
      annex: { letter: next.annex.letter, title: next.annex.title },
      lessonId: next.id,
      ...(next.code ? { code: next.code } : {}),
    };
    if (!courseId) {
      // Guarded on the sources this lesson was written from; approval
      // re-validates every source the course cites.
      const draft = await createRecordWithSourceGuards({
        ownerId: identity.id,
        type: 'COURSE_DRAFT',
        status: 'PENDING',
        sources: pool,
        payload: {
          title: payload.title || 'Untitled course',
          sourceIds: payload.sourceIds,
          objectives: [next.objective],
          sections: [placed],
          planId: record.id,
        },
      });
      courseId = draft.id;
    } else {
      const draft = await getLearningRecord(courseId);
      if (!draft || draft.type !== 'COURSE_DRAFT' || draft.ownerId !== identity.id) throw notFound('Course draft not found');
      const draftPayload = payloadOf(draft);
      const version = Number.isInteger(draft.version) ? draft.version : 0;
      const committed = await updateLearningRecordIfVersion(courseId, version, {
        payload: {
          ...draftPayload,
          objectives: [...(draftPayload.objectives || []), next.objective],
          sections: [...(draftPayload.sections || []).filter((s) => s?.lessonId !== next.id), placed],
        },
      });
      if (!committed) throw conflict('The course draft changed while a lesson was being built; retry.');
    }
  }

  const annexes = (payload.annexes || []).map((annex) => ({
    ...annex,
    lessons: (annex.lessons || []).map((lesson) => (lesson.id === next.id
      ? { ...lesson, status: section ? 'drafted' : 'failed', reason: section ? null : failure, builtAt: new Date().toISOString() }
      : lesson)),
  }));
  const remaining = planLessons({ annexes }).some((lesson) => lesson.status === 'planned');
  /* The terminal transition, and the one that actually fires on a real plan:
   * the last lesson is written in this call, not in a later one that finds
   * nothing left to do. Handing over to the rubric stage has to happen here as
   * well as in the early return above, or the whole stage is dead code on
   * every plan that ever runs. A plan with no draft behind it -- every lesson
   * refused -- has nothing to write rubrics against and finishes. */
  const done = courseId ? 'rubrics' : 'complete';
  const saved = await savePlan(record, { ...payload, annexes, courseId, status: remaining ? 'build' : done, error: null });
  return { json: { ...planView(saved), built: { id: next.id, title: next.title, ok: Boolean(section), reason: failure } } };
}

/**
 * Remove a plan. The plan is the recipe, not the course: a draft it built
 * stays, and is removed (or archived, if learners have worked in it) through
 * the course's own DELETE, which owns that decision.
 */
/**
 * One BARS rubric, against the course this plan produced.
 *
 * Generation through "Create course" writes rubrics inside its own job, where
 * nothing is holding a socket open. The planner cannot: it is driven by a
 * client repeating a bounded request, which is exactly why it survives a
 * twenty-one-lesson course in the first place. So it writes one per call and
 * lets the same loop carry it, the way every other stage here works.
 *
 * A rubric that fails is not a failed plan. The course and its lessons are on
 * disk and reviewable; the rubrics screen and POST /courses/:id/rubrics are
 * both ways to finish the job later. The stage advances regardless, because a
 * plan stuck on a rubric would be a worse outcome than a plan with fewer
 * rubrics than objectives.
 */
export async function rubricPlanStep(identity, { params }, { emit } = {}) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  if (payload.status !== 'rubrics') return { json: planView(record) };
  if (!payload.courseId) {
    const saved = await savePlan(record, { ...payload, status: 'complete', error: null });
    return { json: planView(saved) };
  }
  let remaining = 0;
  try {
    const result = await buildCourseRubricsRecord(
      identity,
      { params: { id: payload.courseId }, body: { limit: 1 } },
      { emit },
    );
    remaining = result?.json?.remaining ?? 0;
  } catch (error) {
    // Recorded on the plan so the screen can say what happened, and then the
    // stage ends: see the note above on why this does not stall the plan.
    const saved = await savePlan(record, {
      ...payload,
      status: 'complete',
      error: error?.message || 'Rubrics could not be written for this course.',
    });
    return { json: planView(saved) };
  }
  const saved = await savePlan(record, {
    ...payload,
    status: remaining > 0 ? 'rubrics' : 'complete',
    error: null,
  });
  return { json: planView(saved) };
}

export async function deletePlan(identity, { params }) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  await deleteLearningRecords([record.id]);
  return { json: { id: record.id, deleted: true, courseId: payload.courseId || null } };
}

/** Put a failed or ungrounded lesson back in the queue (after fixing sources). */
export async function retryPlanLesson(identity, { params, body }) {
  const record = await ownedPlan(identity, params.id);
  const payload = payloadOf(record);
  const lessonId = typeof body?.lessonId === 'string' ? body.lessonId.trim() : '';
  if (!lessonId) throw badRequest('lessonId is required');
  let found = null;
  const annexes = (payload.annexes || []).map((annex) => ({
    ...annex,
    lessons: (annex.lessons || []).map((lesson) => {
      if (lesson.id !== lessonId) return lesson;
      found = lesson;
      return { ...lesson, status: 'planned', reason: null };
    }),
  }));
  if (!found) throw notFound('Lesson not found');
  // An exam is skipped on purpose and has no objective; queued, the build
  // would fail it and offer a retry of its own, for ever.
  if (found.kind === 'exam') throw badRequest('An exam is administered, not generated; it cannot be queued');
  // Reopen the build from either terminal state. A plan that has moved on to
  // its rubrics is finished with lessons, not finished, and a retry queued
  // there would otherwise sit unbuilt for ever.
  const status = ['complete', 'rubrics'].includes(payload.status) ? 'build' : payload.status;
  const saved = await savePlan(record, { ...payload, annexes, status });
  return { json: planView(saved) };
}

export { STAGES as PLAN_STAGES };
