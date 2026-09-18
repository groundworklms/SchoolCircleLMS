/**
 * Core learning loop: sources -> cited course drafts -> rubrics, tutor, and
 * Whetstone mastery sessions, all persisted as LearningRecord rows.
 *
 * Every function takes the verified `identity` (lib/auth.js) plus the parsed
 * request pieces and returns `{ status?, json }`. Ownership and approval rules
 * live here, not in the UI: a learner can only ever read APPROVED material,
 * and nothing generated transitions itself to APPROVED.
 */
import {
  answerMasterySession,
  deriveMasteryPlan,
  draftCourse,
  draftRubricTask,
  expandCoursePages,
  passageForCitation,
  generateRubric,
  ingestSource,
  learningModelStatus,
  masteryPlanProvenance,
  masteryView,
  redactCourse,
  restoreMasterySession,
  reviseCourseContent,
  serialiseMasterySession,
  sourcePassageIndex,
  startMasterySession,
  validateCourseDraft,
  validateKeyDistribution,
  validateMasteryPlan,
} from '../arsenal-core.js';
import { groundedStudentAnswer } from '../student-grounding.js';
import { authReadiness, hasRole } from '../auth.js';
import {
  createLearningRecord,
  createCourseRevisionAtomically,
  getLearningRecord,
  getLearningRecordsByIds,
  listLearningRecords,
  approveCourseAtomically,
  updateLearningRecord,
  updateLearningRecordIfVersion,
  deleteLearningRecords,
  courseEvidenceCount,
  approvePendingDeliveryCourseItems,
  listDeliveryCourseItems,
  getDeliveryCourseItem,
  updateDeliveryCourseItem,
} from '../db.js';
import { errorStatus, notFound } from './http.js';
import { jobProgress, jobView, readJob, resumableJob, runningJobs, startJob } from './job.js';
import { runChunkedDraft } from './chunked-draft.js';
import { cleanRatings, pooledReliability, reliabilityOf } from './reliability.js';
import {
  rubricIsApprovable,
  rubricSourceText,
  rubricTaskFor,
  sectionsNeedingRubrics,
} from './course-rubrics.js';
import { itemDecisionData, itemReviewCounts, normaliseDecision } from './item-review.js';
import { lessonContent, projectCourseRows } from './project-course.js';
import { measureItemSupport } from './verify-support.js';
import { readPdfUpload } from '../pdf-upload.js';
import {
  attachSourcePdf,
  createRecordWithSourceGuards,
  createSourceWithPdf,
  normaliseCollection,
  publicSourcePayload,
  sourceFor,
  sourcePdfMap,
  sourcePdfResponse,
  sourceSummary,
  updateSourceStatusIfVersion,
  validatePdfPages,
} from '../source/library.js';
import { approvedReleaseIds, selectedDeliveryId } from './delivery.js';
import {
  applyCourseRevision,
  courseRevisionError,
  normaliseCourseIds,
  parseRevisionRequest,
  revisionHistoryOf,
  revisionSummary,
} from './course-revisions.js';

const INSTRUCTOR = 'INSTRUCTOR';
const LEARNER = 'LEARNER';
const MAX_TUTOR_QUESTION = 2_000;
const TUTOR_HISTORY_RECORDS = 24;
const MAX_TUTOR_HISTORY_TURNS = 24;
const MAX_TUTOR_HISTORY_CHARS = 12_000;
const MAX_TUTOR_HISTORY_TURN_CHARS = 2_000;

function recordPayload(record) {
  return record?.payload && typeof record.payload === 'object' ? record.payload : {};
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function pageNumber(value, index) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : index + 1;
}

function sourcePassages(record) {
  const payload = recordPayload(record);
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  const chunkPassages = chunks
    .filter((chunk) => typeof chunk?.text === 'string' && chunk.text.trim())
    .map((chunk, index) => ({
      // Grounded student chat requires a stable, server-created passage key;
      // do not let a source's display id become an authority boundary.
      id: `${record.id}:chunk:${index}`,
      text: chunk.text,
      // The record id is the authenticated page-opening key. Keep the
      // human-readable source id alongside it without making it authoritative.
      source: `${record.id} p.${pageNumber(chunk.page, index)}`,
      sourceId: payload.sourceId || null,
    }));
  if (chunkPassages.length) return distinctPassages(chunkPassages);
  return distinctPassages((payload.pages || [])
    .filter((page) => typeof page?.text === 'string' && page.text.trim())
    .map((page, index) => ({
      id: `${record.id}:page:${index}`,
      text: page.text,
      source: `${record.id} p.${pageNumber(page.page, index)}`,
      sourceId: payload.sourceId || null,
    })));
}

function distinctPassages(passages) {
  const provenance = new Set();
  return passages.filter((passage) => {
    const key = `${passage.text}\u0000${passage.source}`;
    if (provenance.has(key)) return false;
    provenance.add(key);
    return true;
  });
}

function sourceCitationPages(record) {
  const payload = recordPayload(record);
  const pageProjection = Array.isArray(payload.pages) ? payload.pages : [];
  const chunkProjection = Array.isArray(payload.chunks) ? payload.chunks : [];
  const pages = pageProjection.some(
    (page) => typeof page?.text === 'string' && page.text.trim(),
  )
    ? pageProjection
    : chunkProjection;
  return pages
    .filter((page) => typeof page?.text === 'string' && page.text.trim())
    .map((page) => ({
      source: record.id,
      sourceId: payload.sourceId || null,
      page: page.page,
    }));
}

function sourceText(record) {
  const payload = recordPayload(record);
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text;
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  return [...pages, ...chunks]
    .map((part) => (typeof part === 'string' ? part : part?.text))
    .filter((text) => typeof text === 'string' && text.trim())
    .join('\n\n');
}

/**
 * Coursewright receives one document per persisted page/chunk so generated
 * citations can identify the exact authenticated source passage. Legacy
 * text-only source records retain a single source-level document.
 */
export function sourceDocuments(record) {
  const payload = recordPayload(record);
  const passages = sourcePassages(record);
  if (passages.length) {
    return passages.map(({ text, source, sourceId }) => ({ text, source, sourceId }));
  }
  const text = sourceText(record);
  if (!text) return [];
  return [{
    text,
    source: payload.sourceId || payload.title || record.id,
    sourceId: payload.sourceId || null,
  }];
}

function sourceApprovalError(message, code = 'SOURCE_NOT_APPROVABLE') {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

async function ownedCourse(identity, courseId, message = 'Course not found') {
  const record = await getLearningRecord(courseId);
  if (!record || record.type !== 'COURSE_DRAFT' || record.ownerId !== identity.id) {
    throw notFound(message);
  }
  return record;
}

function courseConflict(message) {
  const error = new Error(message);
  error.code = 'CONFLICT';
  error.status = 409;
  return error;
}

function courseRevisionPayload(record) {
  return record?.payload && typeof record.payload === 'object' ? record.payload : {};
}

function authoredCoursePayload(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload.sections) &&
    payload.course &&
    typeof payload.course === 'object' &&
    Array.isArray(payload.course.sections)
  ) {
    return {
      ...payload.course,
      ...(payload.title && !payload.course.title ? { title: payload.title } : {}),
      ...(Array.isArray(payload.sourceIds) ? { sourceIds: payload.sourceIds } : {}),
    };
  }
  return payload;
}

/**
 * Is `revision` the pending revision `course` points at? Pure, so a list view
 * can batch the reads and still apply exactly the same ownership and state
 * checks as a single-record fetch.
 */
function acceptPendingRevision(course, revision) {
  if (
    !revision ||
    revision.type !== 'COURSE_REVISION' ||
    revision.ownerId !== course.ownerId ||
    revision.status !== 'PENDING' ||
    courseRevisionPayload(revision).courseId !== course.id
  ) {
    return null;
  }
  return revision;
}

function pendingRevisionId(course) {
  const payload = recordPayload(course);
  return typeof payload.pendingRevisionId === 'string' && payload.pendingRevisionId.trim()
    ? payload.pendingRevisionId.trim()
    : null;
}

async function pendingCourseRevision(course) {
  const id = pendingRevisionId(course);
  if (!id) return null;
  return acceptPendingRevision(course, await getLearningRecord(id));
}

/**
 * The pending revision for each of `courses`, in one query rather than one per
 * course. Returns a Map keyed by course id; absent means no pending revision.
 */
async function pendingCourseRevisions(courses) {
  const ids = courses.map(pendingRevisionId).filter(Boolean);
  if (!ids.length) return new Map();
  const byId = await getLearningRecordsByIds(ids);
  const result = new Map();
  for (const course of courses) {
    const id = pendingRevisionId(course);
    if (!id) continue;
    const accepted = acceptPendingRevision(course, byId.get(id));
    if (accepted) result.set(course.id, accepted);
  }
  return result;
}

function visibleRevisionHistory(course, { owner = false } = {}) {
  const history = revisionHistoryOf(recordPayload(course));
  return owner ? history : history.filter((entry) => entry.status === 'APPROVED');
}

function courseEnvelope(course, coursePayload, { owner = false, revision = null } = {}) {
  const hasPendingRevision = Boolean(revision);
  return {
    id: course.id,
    status: course.status,
    version: Number.isInteger(course.version) ? course.version : 0,
    course: coursePayload,
    revisionHistory: visibleRevisionHistory(course, { owner }),
    hasPendingRevision,
  };
}

function masteryPlanError(message, code = 'MASTERY_PLAN_CONFLICT', status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function courseSourceIds(course) {
  const sourceIds = recordPayload(course).sourceIds;
  return Array.isArray(sourceIds) ? sourceIds : [];
}

function courseObjectives(course, source) {
  const payload = recordPayload(course);
  const nested = payload.course && typeof payload.course === 'object'
    ? payload.course.objectives
    : undefined;
  const candidate = payload.objectives ?? nested;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  if (Array.isArray(candidate)) {
    const objectives = candidate
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
    if (objectives.length) return objectives;
  }
  const tasks = recordPayload(source).tasks;
  const taskTitles = Array.isArray(tasks)
    ? tasks.map((task) => task?.title).filter((title) => typeof title === 'string' && title.trim())
    : [];
  if (taskTitles.length) return taskTitles;
  return recordPayload(source).title || payload.title || payload.course?.title || source.id;
}

function planFromCourse(course) {
  const plan = recordPayload(course).masteryPlan;
  return plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : null;
}

function planResponse(record, plan) {
  return {
    id: record.id,
    courseId: record.id,
    status: plan.status,
    sourceId: plan.sourceId,
    revision: plan.revision,
    // Read off the criteria, so the summary beside the Approve button is the
    // plan's own account of itself: RATIFIED only when every criterion came
    // from a rubric this instructor approved, MIXED the moment one did not.
    provenance: masteryPlanProvenance(plan.criteria),
    masteryPlan: plan,
  };
}

/* ---------------- status ---------------- */

export function learningStatus() {
  return {
    json: {
      auth: authReadiness(),
      persistence: {
        provider: 'prisma-postgresql',
        learningRecord: true,
        destructiveMigrationPerformed: false,
      },
      arsenal: learningModelStatus(),
    },
  };
}

/* ---------------- sources ---------------- */

export async function createSource(identity, { body }) {
  const ingested = await ingestSource(body || {});
  const collection = normaliseCollection(body?.collection);
  const payload = collection ? { ...ingested, collection } : ingested;
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload,
  });
  const pdfs = await sourcePdfMap([record.id]);
  return {
    status: 201,
    json: {
      ...sourceSummary(record, payload, {
        hasPdf: pdfs.has(record.id),
        canRemove: hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id,
      }),
      tasks: payload.tasks.length,
    },
  };
}

// The existing /api/ingest upload remains a parse-only seam; this persists a
// Quarry page-preserving source without replacing that response. The original
// bytes are stored in a separate SOURCE_PDF record in the same transaction.
export async function createSourceFromPdf(identity, { body: form }) {
  const file = form?.get?.('file');
  const bytes = await readPdfUpload(file);
  const quarry = await new Function('specifier', 'return import(specifier)')('quarry/pdf');
  // pdfjs may transfer/detach the supplied Uint8Array. Keep the validated
  // upload untouched for durable SOURCE_PDF storage.
  const parsed = await quarry.pdfText(bytes.slice());
  const title = form.get('title');
  const sourceId = form.get('sourceId');
  const collection = normaliseCollection(form.get('collection'));
  // The citation label defaults to the filename. Two zips -- lesson plans and
  // student material -- can both carry a lesson-01.pdf, so inside a collection
  // the default is prefixed to keep those citations tellable apart.
  const defaultSourceId = collection && file.name ? `${collection}/${file.name}` : file.name;
  const ingested = await ingestSource({
    title: String(title || file.name || 'Uploaded source'),
    sourceId: sourceId || defaultSourceId,
    text: parsed.text,
    pages: parsed.pageTexts.map((text, index) => ({ page: index + 1, text })),
  });
  const payload = collection ? { ...ingested, collection } : ingested;
  const { source: record } = await createSourceWithPdf({
    ownerId: identity.id,
    sourcePayload: payload,
    bytes,
    file,
    extractedPages: parsed.pageTexts,
  });
  return {
    status: 201,
    json: {
      ...sourceSummary(record, payload, {
        hasPdf: true,
        canRemove: hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id,
      }),
    },
  };
}

export async function listSources(identity) {
  const records = await listLearningRecords({ type: 'SOURCE' });
  const pdfs = await sourcePdfMap(records.map((record) => record.id));
  return {
    json: records
      .filter(
        (record) =>
          record.status === 'APPROVED' ||
          (hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity?.id),
      )
      .map((record) => {
        const owner = hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id;
        return {
          ...sourceSummary(record, recordPayload(record), {
            hasPdf: pdfs.has(record.id),
            canRemove: owner,
          }),
        };
      }),
  };
}

export async function getSource(identity, { params }) {
  const record = await sourceFor(identity, params.id, {
    approvedOnly: hasRole(identity.role, LEARNER) && !hasRole(identity.role, INSTRUCTOR),
  });
  const payload = publicSourcePayload(recordPayload(record));
  delete payload.ownerId;
  const pdfs = await sourcePdfMap([record.id]);
  return {
    json: {
      ...payload,
      id: record.id,
      status: record.status,
      canRemove: hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id,
      hasPdf: pdfs.has(record.id),
    },
  };
}

export async function getSourcePdf(identity, { params }) {
  return sourcePdfResponse(identity, params.id);
}

export async function attachSourcePdfRecord(identity, { params, body: form }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Source not found');
  const source = await sourceFor(identity, params.id);
  if (source.ownerId !== identity.id) throw notFound('Source not found');
  const file = form?.get?.('file');
  const bytes = await readPdfUpload(file);
  const quarry = await new Function('specifier', 'return import(specifier)')('quarry/pdf');
  const parsed = await quarry.pdfText(bytes.slice());
  const extractedPages = Array.isArray(parsed?.pageTexts) ? parsed.pageTexts : [];
  validatePdfPages(source, extractedPages);
  await attachSourcePdf(source, {
    ownerId: identity.id,
    bytes,
    file,
    extractedPages,
  });
  const payload = recordPayload(source);
  return {
    json: {
      ...sourceSummary(source, payload, { hasPdf: true, canRemove: true }),
    },
  };
}

export async function approveSource(identity, { params }) {
  const record = await sourceFor(identity, params.id);
  if (record.ownerId !== identity.id) throw notFound('Source not found');
  const payload = recordPayload(record);
  if (!sourceText(record)) {
    throw sourceApprovalError('Source cannot be approved without source text.');
  }
  const pageProjection = Array.isArray(payload.pages) ? payload.pages : [];
  const chunkProjection = Array.isArray(payload.chunks) ? payload.chunks : [];
  const addressablePages = pageProjection.some(
    (page) => typeof page?.text === 'string' && page.text.trim(),
  )
    ? pageProjection
    : chunkProjection;
  if (
    !addressablePages.some((page) => typeof page?.text === 'string' && page.text.trim())
  ) {
    throw sourceApprovalError('Source cannot be approved without addressable page text.');
  }
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  if (!(await updateSourceStatusIfVersion(
    record.id,
    expectedVersion,
    record.status,
    'APPROVED',
  ))) {
    const latest = await getLearningRecord(record.id);
    if (!latest || latest.type !== 'SOURCE' || latest.ownerId !== identity.id) {
      throw notFound('Source not found');
    }
    throw sourceApprovalError(
      'The source changed while it was being approved; retry with the latest source.',
      'SOURCE_TRANSITION_CONFLICT',
    );
  }
  const updated = await getLearningRecord(record.id);
  return { json: { id: updated.id, status: updated.status } };
}

const MAX_BATCH_APPROVE = 200;

function badRequest(message) {
  const error = new TypeError(message);
  error.code = 'BAD_REQUEST';
  return error;
}

// Approve several sources in one request -- the "approve all pending" click on
// a collection. Each id goes through approveSource unchanged, so ownership,
// the addressable-text rule, and the version CAS are exactly the single-source
// gate applied N times. It is deliberately not atomic: a scanned PDF with no
// text should be reported by id, not hold up the twenty documents beside it.
export async function approveSources(identity, { body }) {
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.trim())) {
    throw badRequest('ids must be a non-empty array of source ids');
  }
  const unique = [...new Set(ids.map((id) => id.trim()))];
  if (unique.length > MAX_BATCH_APPROVE) {
    throw badRequest(`Approve at most ${MAX_BATCH_APPROVE} sources per request`);
  }
  const approved = [];
  const failed = [];
  for (const id of unique) {
    try {
      const { json } = await approveSource(identity, { params: { id } });
      approved.push(json);
    } catch (error) {
      failed.push({ id, error: error?.message || 'Source could not be approved', code: error?.code || 'ERROR' });
    }
  }
  return { json: { approved, failed } };
}

/* ---------------- courses ---------------- */

export async function draftCourseRecord(identity, { body }, { emit, progress, saveProgress } = {}) {
  // Title and objectives are both optional: the ordinary path is an instructor
  // picking sources and letting the model name the course and write the
  // outline. Anything they do supply is passed through untouched.
  /* Diagrams default ON, now that the renderer owns layout.
   *
   * They were on once before and it was a mistake. The generator asked a model
   * for SVG primitives at absolute coordinates, and on a real course the
   * hotspot markers landed on top of the labels they pointed at -- "Edge"
   * rendered as "Edg(4)" -- a caption overflowed into the row above it, four
   * markers floated attached to nothing, and the labels that survived were
   * single words describing no relationship. The pipeline was complete and the
   * output was unusable, which is the whole lesson: a diagram that renders is
   * not a diagram worth showing.
   *
   * What changed is the division of labour, not the flag. The model is now
   * asked what connects to what and never sees a coordinate;
   * lib/learning/diagram-layout.js owns every number -- box sizes from the
   * text they hold, rows from the graph's own depth, edges routed between box
   * edges, marker anchors at a corner where no label can be. Each of the four
   * defects above has a test named after it.
   */
  const { title, objectives = [], sourceIds, diagrams = true } = body || {};
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new TypeError('sourceIds must be a non-empty array');
  }
  const uniqueSourceIds = [...new Set(sourceIds)];
  if (uniqueSourceIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new TypeError('sourceIds must contain non-empty strings');
  }
  const sources = await Promise.all(
    uniqueSourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  const documents = sources.flatMap(sourceDocuments);
  /* Sections first, saved, and only then the pages.
   *
   * These used to run in one call: draftCourse wrote the sections, expanded
   * every one of them into lesson pages, and the record was created at the
   * very end. So nothing was persisted until everything was finished, and a
   * generation that died anywhere in those twenty minutes left nothing behind.
   *
   * That is not hypothetical. On 2026-09-17 a generation completed all twelve
   * sections AND all twelve page expansions, and the instance was replaced
   * before the record was written. Twenty minutes of model calls, every one of
   * them successful, thrown away at the last step.
   *
   * Splitting it puts the expensive, unrepeatable part on disk as soon as it
   * exists. Pages are the right half to leave until after the save because
   * they already have a resumable home: expandCoursePagesRecord is an endpoint
   * the review screen calls "Rewrite lesson pages", so a page pass that dies
   * is a button, not a lost course. Sections have no such path -- losing them
   * means generating again from nothing. */
  /* Written a section at a time, checkpointing as it goes.
   *
   * `saveProgress` is what makes a generation survive losing its process: the
   * plan and every finished section are written down as they land, so a run
   * that dies costs the section in flight rather than the twenty minutes
   * before it. A caller that does not supply one gets the same generation with
   * nothing recorded, which is what every test and the non-job path want.
   *
   * `progress` is whatever a previous run left behind. Passing it back in
   * resumes; passing nothing starts fresh. See lib/learning/chunked-draft.js
   * for why the stems travel with it. */
  const course = await runChunkedDraft(
    { title, objectives, documents, diagrams, pages: false, progress },
    { emit, save: saveProgress },
  );
  const normalizedCourse = normaliseCourseIds(course);
  // A shuffle can still land badly by chance, and a generator change could
  // reintroduce the bias silently, so the distribution is asserted rather than
  // assumed. Scores are the product here; a course that cannot measure is worse
  // than no course.
  const keys = validateKeyDistribution(normalizedCourse);
  if (!keys.valid) {
    const error = new Error(`Course answer keys are not usable: ${keys.issues.join('; ')}`);
    error.code = 'COURSE_KEYS_BIASED';
    error.status = 422;
    error.validation = keys;
    throw error;
  }
  const validation = validateCourseDraft(normalizedCourse, { sources });
  if (!validation.valid) {
    const error = new Error(`Course generation failed validation: ${validation.issues.join('; ')}`);
    error.code = 'COURSE_GENERATION_INVALID';
    error.status = 422;
    error.validation = validation;
    throw error;
  }
  const record = await createRecordWithSourceGuards({
    ownerId: identity.id,
    type: 'COURSE_DRAFT',
    status: 'PENDING',
    sources,
    payload: {
      ...normalizedCourse,
      sourceIds: uniqueSourceIds,
      objectives: Array.isArray(normalizedCourse.objectives)
        ? normalizedCourse.objectives
        : objectives,
      // Objectives this draft does not teach, each with its reason: retrieval
      // found no passage, or the generator refused to teach from the one it
      // had. Recorded on the draft, not only streamed, because the instructor
      // who reviews this PENDING course days later is the person who has to
      // decide whether partial coverage is acceptable -- and the progress
      // modal they watched is gone by then.
      ...(Array.isArray(course.skippedObjectives) && course.skippedObjectives.length > 0
        ? { skippedObjectives: course.skippedObjectives }
        : {}),
      // Set when the outline reached only a slice of a large source. The review
      // screen turns it into one line pointing at the objectives box, which is
      // the control that narrows a course; it is not a validity signal and
      // nothing gates on it.
      ...(course.thinCoverage === true ? { thinCoverage: true } : {}),
      title: normalizedCourse.title,
    },
  });

  /* The sections are safe on disk. Now the pages.
   *
   * Run against the SAVED record, through the same function the "Rewrite
   * lesson pages" button calls, so there is one implementation of page
   * expansion rather than two that can drift. Each section's pages are written
   * onto the record as they land.
   *
   * A failure here is deliberately not a failure of the draft. The course
   * exists, it is reviewable, and its unwritten pages are already reported on
   * the review screen and already blocked from publication by
   * COURSE_PAGES_UNWRITTEN. Throwing would undo a save that succeeded and hand
   * the instructor nothing, which is the behaviour this whole change exists to
   * remove.
   */
  try {
    await expandCoursePagesRecord(identity, { params: { id: record.id } }, { emit });
  } catch (error) {
    if (typeof emit === 'function') {
      emit({
        phase: 'pages',
        status: 'done',
        ok: false,
        reason: error?.message || 'lesson pages could not be written',
      });
    }
  }

  /* And then the rubrics, on the same terms.
   *
   * A BARS rubric per taught objective is what a mastery session grades
   * against, and writing them here is the difference between a generated
   * course whose mastery plan is anchored to approved standards and one whose
   * criteria a model invented from a list of objective titles. Each rubric is
   * PENDING; the instructor approves them.
   *
   * Last, and non-fatal, because the course and its pages are already on disk
   * and reviewable without a single rubric. A failure is a button -- the same
   * endpoint, called again -- and a second attempt writes only what is missing.
   */
  try {
    await buildCourseRubricsRecord(identity, { params: { id: record.id } }, { emit });
  } catch (error) {
    if (typeof emit === 'function') {
      emit({
        phase: 'rubrics',
        status: 'done',
        ok: false,
        reason: error?.message || 'rubrics could not be written',
      });
    }
  }

  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      version: Number.isInteger(record.version) ? record.version : 0,
      title: normalizedCourse.title,
      sections: normalizedCourse.sections?.length || 0,
      sourceIds: uniqueSourceIds,
      ...(Array.isArray(course.skippedObjectives) && course.skippedObjectives.length > 0
        ? { skippedObjectives: course.skippedObjectives }
        : {}),
      ...(course.thinCoverage === true ? { thinCoverage: true } : {}),
    },
  };
}


/**
 * Write lesson pages for a saved course after the fact -- the same grounded
 * expansion draftCourse now runs during generation, for courses drafted
 * before it existed. Owner only. Each section's citation is resolved back to
 * the approved source text it was grounded in, and every block has to pass
 * the same overlap floor as the micro-lesson before it is kept. Nothing about
 * the section's questions, citation or support changes.
 */
export async function expandCoursePagesRecord(identity, { params }, { emit } = {}) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const record = await ownedCourse(identity, params.id);
  // Writing pages bumps the course version. A pending revision was reviewed
  // against the current one: approveCourse would reject it as stale for good,
  // and a fresh revision bases on the revision's course, which never got the
  // pages. Settle the revision first.
  if (await pendingCourseRevision(record)) {
    throw courseConflict('A revision is pending review; approve or discard it before writing lesson pages.');
  }
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  const payload = recordPayload(record);
  const course = authoredCoursePayload(payload);
  const sourceIds = courseSourceIds(record);
  if (sourceIds.length === 0) {
    throw sourceApprovalError(
      'Course cannot be expanded without persisted source relationships.',
      'COURSE_PAGES_NOT_GROUNDABLE',
    );
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  const model = learningModelStatus();
  if (!model?.model?.ready) {
    const error = new Error(model?.model?.reason || 'No text model is configured for lesson pages.');
    error.code = 'NO_PROVIDER';
    throw error;
  }
  const documents = sources.flatMap(sourceDocuments);
  const sections = structuredClone(Array.isArray(course.sections) ? course.sections : []);
  const { expanded } = await expandCoursePages(
    {
      sections,
      // The full cites list when the section has one, so a section grounded in
      // a union of passages is rewritten from that same union rather than from
      // its primary alone. Same convention validateCourseDraft reads.
      passageFor: (section) =>
        passageForCitation(
          documents,
          Array.isArray(section.cites) && section.cites.length > 0 ? section.cites : section.cite,
        ),
    },
    { emit },
  );
  const nextPayload = Array.isArray(payload.sections)
    ? { ...payload, sections }
    : { ...payload, course: { ...payload.course, sections } };
  const committed = await updateLearningRecordIfVersion(record.id, expectedVersion, {
    payload: nextPayload,
  });
  if (!committed) {
    throw courseConflict('This course changed while its pages were being written; retry.');
  }
  // An approved course already has its LESSON rows materialised, and a learner
  // reads from those rows alone. Carry the new content onto each row -- and
  // send the row back to PENDING, because the words a learner reads it through
  // changed and the instructor has not ratified them yet. A row that was
  // already withheld stays withheld; a fresh draft picks this up at approval.
  let rematerialised = 0;
  if (record.status === 'APPROVED') {
    const deliveryCourseId = deliveryCourseIdOf(record);
    const released = await listDeliveryCourseItems(deliveryCourseId);
    for (const [index, section] of sections.entries()) {
      if (!Array.isArray(section.pages) || !section.pages.length) continue;
      const row = (released[index]?.items || []).find((item) => item.kind === 'LESSON');
      if (!row) continue;
      const data = { options: lessonContent(section) };
      if (row.status === 'APPROVED') data.status = 'PENDING';
      const updated = await updateDeliveryCourseItem(deliveryCourseId, row.id, data);
      if (updated) rematerialised += 1;
    }
  }
  return {
    json: {
      id: record.id,
      version: expectedVersion + 1,
      expanded,
      rematerialised,
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        pages: Array.isArray(section.pages) ? section.pages.length : 0,
        reason: section.refusals?.pages || null,
      })),
    },
  };
}

/**
 * Write one BARS rubric per taught objective, against a saved course.
 *
 * The course already carries everything a rubric needs. Each section was
 * retrieved for one objective, written from its own cited passages, and checked
 * for grounding; that is a performance standard in all but name.
 * lib/learning/course-rubrics.js states it as one, and Rubricon decomposes it
 * into observable dimensions with three anchors apiece.
 *
 * WHY THIS IS WORTH A MODEL CALL PER OBJECTIVE. A mastery session grades a
 * learner on written answers, and what it grades them against is either an
 * approved rubric's anchors -- copied across verbatim by
 * masteryCriteriaFromRubric -- or criteria a model invented in one shot from a
 * list of objectives. The first is a human decision recorded in a learner's
 * own words; the second is a guess. Until now a generated course could only
 * ever have the second, because nothing generated rubrics.
 *
 * NOTHING HERE APPROVES ANYTHING. Every rubric is written PENDING and stays
 * PENDING. approveRubric is the only gate a rubric passes, an instructor is the
 * only one who can press it, and masteryCriteriaFromRubric re-asserts all four
 * of its conditions against the rubric's own stored evidence before a single
 * anchor reaches a learner. This pass fills the queue; it does not shorten it.
 *
 * Run after the course is saved and the pages are written, in the same
 * try/catch as the page pass, for the same reason: the course exists and is
 * reviewable, and a rubric pass that fails is a button on the review screen
 * rather than a lost course. Each rubric is its own row, so a pass cut in half
 * leaves the finished ones behind and a second attempt writes only the rest.
 */
export async function buildCourseRubricsRecord(identity, { params, body }, { emit, ask } = {}) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const record = await ownedCourse(identity, params.id);
  const payload = recordPayload(record);
  const course = authoredCoursePayload(payload);
  const sourceIds = courseSourceIds(record);
  if (sourceIds.length === 0) {
    throw sourceApprovalError(
      'Course cannot have rubrics written without persisted source relationships.',
      'COURSE_RUBRICS_NOT_GROUNDABLE',
    );
  }
  if (typeof ask !== 'function') {
    const model = learningModelStatus();
    if (!model?.model?.ready) {
      const error = new Error(model?.model?.reason || 'No text model is configured for rubrics.');
      error.code = 'NO_PROVIDER';
      throw error;
    }
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  // Which source a section was grounded in, by the citation it carries. A
  // single-source course is the ordinary case and answers itself; a course
  // drawing on two publications must not file a rubric against the wrong one,
  // because the rubric's own source relationship is what sourceFor checks
  // later.
  const sourceIndexFor = (cite) => {
    const wanted = typeof cite === 'string' ? cite.trim() : '';
    if (wanted) {
      for (const [index, source] of sources.entries()) {
        if (sourceDocuments(source).some((document) => document.source === wanted)) return index;
      }
    }
    return 0;
  };

  const taught = courseObjectiveTexts(record);
  /* A section's objective, or the course's for that position.
   *
   * Every course the whole-course planner built before it pinned the plan's
   * objective onto each section has sixteen sections and sixteen objectives
   * and no link between them -- the objectives are on the course, the sections
   * carry none, and a rubric pass would find nothing to write a standard from.
   * They are appended in lockstep, one per lesson, so position is the link
   * that was always there implicitly.
   *
   * Only ever a fallback. A section that states its own objective is believed,
   * and a position with no objective behind it stays empty rather than
   * borrowing its neighbour's. */
  const sections = (Array.isArray(course.sections) ? course.sections : []).map((section, index) => (
    typeof section?.objective === 'string' && section.objective.trim()
      ? section
      : { ...section, objective: taught[index] || '' }
  ));
  const taughtSet = new Set(taught);
  const owned = await listLearningRecords({ ownerId: identity.id, type: 'RUBRIC' });
  const existing = owned
    .map((row) => recordPayload(row))
    .filter((entry) => entry?.courseId === record.id);
  const outstanding = sectionsNeedingRubrics(sections, existing);
  /* How many to write in this call.
   *
   * A rubric is a model call of its own, so sixteen of them is well past the
   * 300-second ceiling a Cloud Run request has. The whole-course planner
   * already drives long work by repeating a short request until a status
   * moves on, and this is the seam that lets it: ask for one, get one, call
   * again. Unbounded stays the default, because the generation path runs this
   * inside a job where nothing is holding a socket open. */
  const limit = Number.isInteger(body?.limit) && body.limit > 0 ? body.limit : 0;
  const pending = limit > 0 ? outstanding.slice(0, limit) : outstanding;

  if (typeof emit === 'function') {
    emit({ phase: 'rubrics', status: 'start', total: pending.length, existing: existing.length });
  }

  /* Has somebody else written this objective's rubric?
   *
   * `existing` is read once before the loop, and each rubric is a model call of
   * twenty or thirty seconds. Two overlapping passes -- the plan stage and the
   * review screen's button, or a rollout serving two revisions at once -- both
   * read the same empty set and then both write, which is how one course ended
   * up with twenty-seven rubrics for sixteen objectives.
   *
   * This is not a lock and does not claim to be one. It narrows the window from
   * a model call to a database round trip; the honest fix for the remainder is
   * a uniqueness constraint on (courseId, objective), which is a migration.
   */
  const alreadyWritten = async (objective) => {
    if (!objective) return false;
    const rows = await listLearningRecords({ ownerId: identity.id, type: 'RUBRIC' });
    return (Array.isArray(rows) ? rows : []).some((row) => {
      const entry = recordPayload(row);
      return entry?.courseId === record.id
        && String(entry?.objective || '').trim().toLowerCase() === objective.toLowerCase();
    });
  };

  const written = [];
  for (const section of pending) {
    const index = sourceIndexFor(section.cite);
    // The publication's own name, so the rubric's task code is a citation an
    // instructor can look up rather than a record id.
    const task = rubricTaskFor(section, { publication: recordPayload(sources[index])?.title });
    const objective = String(section.objective || '').trim();
    /* The objective is only claimed when the course actually lists it.
     *
     * rubricCourseLink refuses a rubric naming an objective the draft does not
     * teach, and deriveMasteryPlan reads that link to find a ratified rubric.
     * A section objective that drifted from the outline's wording would fail
     * the first check and be invisible to the second, so the rubric is still
     * written -- it is a sound standard either way -- but it does not claim a
     * link it cannot prove. */
    const link = taughtSet.has(objective) ? { courseId: record.id, objective } : {};
    // Asked twice, on purpose: before the model call so an objective somebody
    // else has already covered does not cost one, and again before the create
    // so the write window is a database round trip rather than the whole call.
    // eslint-disable-next-line no-await-in-loop
    if (await alreadyWritten(objective)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await generateRubric(
        { task, sourceText: rubricSourceText(section) },
        // The same contract-test seam generateRubric has always exposed.
        // Production passes nothing and reaches the configured provider; a test
        // passes a reply and exercises everything around the model call, which
        // is where this handler's own mistakes would be.
        ask ? { ask } : {},
      );
      /* Re-read the source for its current version.
       *
       * createRecordWithSourceGuards proves the source has not changed by
       * matching its version and then incrementing it, so writing a second
       * rubric against the same source with the version read before the first
       * is a guaranteed conflict. Every rubric after the first failed on a
       * single-source course, which is every course this has ever run on. */
      // eslint-disable-next-line no-await-in-loop
      if (await alreadyWritten(objective)) continue;
      // eslint-disable-next-line no-await-in-loop
      const guard = await sourceFor(identity, sourceIds[index], { approvedOnly: true });
      // eslint-disable-next-line no-await-in-loop
      const created = await createRecordWithSourceGuards({
        ownerId: identity.id,
        type: 'RUBRIC',
        status: 'PENDING',
        sources: [guard],
        payload: {
          ...result,
          sourceId: sourceIds[index],
          title: section.title || task.title,
          ...link,
        },
      });
      const approvable = rubricIsApprovable(result);
      written.push({
        id: created.id,
        section: section.title || objective,
        objective,
        linked: Boolean(link.courseId),
        dimensions: Array.isArray(result.rubric?.dimensions) ? result.rubric.dimensions.length : 0,
        flagged: result.rubric?.flagged === true,
        approvable,
        coverage: result.traceability?.coverage ?? null,
      });
      if (typeof emit === 'function') {
        emit({
          phase: 'rubrics',
          kind: 'rubric',
          section: section.title || objective,
          ok: approvable,
          // A flagged rubric is Rubricon refusing to invent measurable criteria
          // for a standard that has none, which is the behaviour we want and
          // not a failure -- so it is reported as what it is.
          ...(result.rubric?.flagged === true
            ? { reason: `needs an SME: ${result.rubric.reason || 'standard is not observable'}` }
            : approvable
              ? {}
              : { reason: rubricShortfall(result) }),
        });
      }
    } catch (error) {
      if (typeof emit === 'function') {
        emit({
          phase: 'rubrics',
          kind: 'rubric',
          section: section.title || objective,
          ok: false,
          reason: error?.message || 'rubric could not be written',
        });
      }
    }
  }

  if (typeof emit === 'function') {
    emit({
      phase: 'rubrics',
      status: 'done',
      written: written.length,
      approvable: written.filter((entry) => entry.approvable).length,
      flagged: written.filter((entry) => entry.flagged).length,
    });
  }

  return {
    json: {
      id: record.id,
      written: written.length,
      // What is still to do after this call, so a caller stepping through one
      // at a time knows whether to come back.
      remaining: Math.max(0, outstanding.length - written.length),
      skipped: sections.length - outstanding.length,
      approvable: written.filter((entry) => entry.approvable).length,
      flagged: written.filter((entry) => entry.flagged).length,
      rubrics: written,
    },
  };
}

/**
 * Why a rubric cannot be approved as written, in one clause.
 *
 * The instructor reading the progress screen needs to know whether to fix the
 * rubric or the section it came from, and "not approvable" does not say.
 */
function rubricShortfall({ validation, traceability } = {}) {
  if (validation?.valid !== true) {
    const issues = Array.isArray(validation?.issues) ? validation.issues : [];
    return issues.length ? `structure: ${issues.slice(0, 2).join('; ')}` : 'failed structural validation';
  }
  const ungrounded = Array.isArray(traceability?.ungrounded) ? traceability.ungrounded : [];
  if (ungrounded.length) {
    return `unverified anchors: ${ungrounded.map((entry) => entry.name).filter(Boolean).join(', ')}`;
  }
  return 'grounding could not be verified';
}

/**
 * The same draft, reported as it happens.
 *
 * Generation is a minute or more of model calls, and a spinner over that is
 * both a worse experience and a worse bug report: when a section refuses, the
 * reason exists only inside Coursewright's progress callback, and the finished
 * error carries a summary at best. This streams one JSON object per line --
 * every objective, every artifact, every refusal with its reason -- and ends
 * with either the saved record or the failure.
 *
 * NDJSON rather than Server-Sent Events on purpose: EventSource cannot send an
 * Authorization header, and these routes have no cookie session to fall back
 * on.
 */
/**
 * The same generation, started as a job and reported by polling.
 *
 * This is draftCourseStream's replacement rather than its companion: a response
 * held open for the length of a generation cannot survive a platform that caps
 * responses at five minutes, and every real course exceeds it. The POST returns
 * as soon as the row exists; the events land on the row; the client polls.
 *
 * The stream route stays for now -- it is a working path for short courses and
 * removing it is a separate change from adding this one.
 */
export async function startCourseJob(identity, input) {
  // The route already enforces INSTRUCTOR (learningRoute's `roles`), the same
  // way it does for draftCourseRecord below. An earlier version called a
  // requireAnyRole that this module does not import, which is a ReferenceError
  // on the first real request and was invisible to every test because none of
  // them called the handler. There is one now.
  const body = input?.body && typeof input.body === 'object' ? input.body : {};
  /* Pick up where a dead job left off, if there is one.
   *
   * A generation stops here mainly because the instance was replaced, which
   * App Hosting does on every push. That leaves a row holding the plan and
   * every finished section, and the obvious thing to do with it is continue --
   * generating the same twenty minutes again is the behaviour this whole
   * change exists to remove. Matched on the sources, so a different course
   * starts fresh. */
  const stale = await resumableJob(identity.id, body);
  const progress = stale ? jobProgress(stale) : null;
  const record = await startJob({
    ownerId: identity.id,
    // From `body`, which is where the route puts the request payload. Reading
    // these off `input` -- the envelope of { body, params, query, request } --
    // stored an empty object and looked like it worked, because the generation
    // itself is handed the envelope and finds the body for itself.
    input: {
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(Array.isArray(body.objectives) ? { objectives: body.objectives } : {}),
      ...(Array.isArray(body.sourceIds) ? { sourceIds: body.sourceIds } : {}),
    },
    // `emit` writes onto the job row; everything else is the generation that
    // already existed, unchanged.
    run: (emit, saveProgress) => {
      if (progress) {
        emit({
          phase: 'resumed',
          sections: Array.isArray(progress.sections) ? progress.sections.length : 0,
          from: stale.id,
        });
      }
      return draftCourseRecord(identity, input, { emit, saveProgress, progress });
    },
  });
  return { status: 202, json: jobView(record) };
}

/** One job's progress. The client's polling loop reads this. */
export async function readCourseJob(identity, { params }) {
  const record = await readJob(identity.id, params?.id);
  if (!record) {
    const error = new Error('No such generation job.');
    error.code = 'JOB_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return { json: jobView(record) };
}

/**
 * Jobs still running for this instructor.
 *
 * So a reload, a second tab or a closed laptop can pick a generation back up
 * instead of starting a second one beside it.
 */
export async function listCourseJobs(identity) {
  const rows = await runningJobs(identity.id);
  return { json: rows.map(jobView) };
}

export function draftCourseStream(identity, input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };
      send({ phase: 'accepted' });
      draftCourseRecord(identity, input, { emit: send })
        .then((result) => {
          send({ phase: 'saved', status: result.status, record: result.json });
        })
        .catch((error) => {
          send({
            phase: 'failed',
            error: error?.message || 'Course generation failed',
            code: error?.code || 'ERROR',
            status: errorStatus(error),
            ...(error?.validation ? { validation: error.validation } : {}),
          });
        })
        .finally(finish);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      // Cloud Run sits behind a proxy that will otherwise buffer the whole
      // response and defeat the point of streaming it.
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function listCourses(identity) {
  const records = await listLearningRecords({ type: 'COURSE_DRAFT' });
  const isOwner = (record) =>
    hasRole(identity.role, INSTRUCTOR) && record.ownerId === identity.id;
  const visible = records.filter((record) => record.status === 'APPROVED' || isOwner(record));

  // One query for every pending revision on the page. This used to be a
  // findUnique per owned course, which made the library screen slower for
  // exactly the instructors who have the most drafts.
  const revisions = await pendingCourseRevisions(visible.filter(isOwner));

  return {
    json: visible.map((record) => {
      const owner = isOwner(record);
      const revision = owner ? revisions.get(record.id) || null : null;
      const payload = revision ? courseRevisionPayload(revision).course : recordPayload(record);
      return {
        id: record.id,
        status: record.status,
        version: Number.isInteger(record.version) ? record.version : 0,
        title: payload?.title || payload?.course?.title,
        sections: payload?.sections?.length || 0,
        ...(owner
          ? {
              sourceIds: payload?.sourceIds || recordPayload(record).sourceIds || [],
              hasPendingRevision: Boolean(revision),
            }
          : {}),
      };
    }),
  };
}

/**
 * What a section of the authoring draft still tells a learner once the draft is
 * no longer where their content comes from: the STRUCTURE, and nothing written.
 *
 * Approving a course releases a shape -- how many sections, in what order,
 * under what titles, grounded in which source. It does not release a single
 * sentence inside it: the materialiser writes every lesson, question and
 * scenario as a PENDING Item (see ./project-course.js) and an instructor
 * ratifies them one at a time. So the draft's `lesson`, `pre`, `post` and
 * `scenario` are, by definition, unratified text, and this response was handing
 * them to learners -- the reader stopped RENDERING the draft's questions when
 * checks moved onto the delivery rows, but they were still on the wire, and the
 * lesson prose was still being rendered. Both are removed here, at the
 * boundary, so the rule does not depend on which client is reading.
 *
 * Every one of those has a ratified counterpart on
 * `/api/learning/courses/:id/attempts`, which is where a learner's reader now
 * takes all of it from. Nothing an instructor can see is affected: `getCourse`
 * only reaches this function for a caller who is not the course's author.
 */
function learnerSectionStructure(section) {
  const source = section && typeof section === 'object' ? section : {};
  const projected = { ...source };
  // Everything a section TEACHES is ratified item by item and reaches a
  // learner only through the attempts route; the structure a learner may see
  // here is the title, its annex, and where it was grounded.
  // `itemsBeyondPages` is on this list for a sharper reason than the rest: it
  // names the items a section's pages cannot support, and it quotes their
  // STEMS -- post-test stems included. It is review evidence for the author
  // and an answer key sketch for anyone else.
  for (const authored of ['lesson', 'pre', 'post', 'scenario', 'questions', 'intro', 'pages', 'labels', 'diagram', 'flashcards', 'refusals', 'itemsBeyondPages', 'titleNotTaught', 'driftedTerms']) {
    delete projected[authored];
  }
  return projected;
}

export function learnerCourseProjection(course) {
  const fullCourse = course && typeof course === 'object' ? course : {};
  const projected = redactCourse(fullCourse);
  // Authoring metadata is not course content and must not reveal an
  // instructor's pending candidate or revision instructions to learners.
  delete projected.pendingRevisionId;
  delete projected.revisionHistory;
  delete projected.deliveryCourseId;
  // Which words of the course title no section delivers. Authoring evidence
  // for whoever is deciding whether to rename the course, and an odd thing to
  // hand a learner about the course they are taking.
  delete projected.titleNotTaught;
  // The course-level scenario is materialised as its own PENDING Item under a
  // trailing section, so it is unratified text exactly like a lesson is.
  delete projected.scenario;
  if (Array.isArray(projected.sections)) {
    projected.sections = projected.sections.map(learnerSectionStructure);
  }
  const plan = fullCourse.masteryPlan;
  if (
    plan &&
    typeof plan === 'object' &&
    plan.status === 'APPROVED' &&
    typeof plan.sourceId === 'string' &&
    plan.sourceId.trim() &&
    typeof plan.revision === 'string' &&
    plan.revision.trim()
  ) {
    projected.masteryPlan = {
      status: 'APPROVED',
      sourceId: plan.sourceId,
      revision: plan.revision,
    };
  } else {
    delete projected.masteryPlan;
  }
  return projected;
}

/**
 * The publication label for each of `sourceIds`, by source record id.
 *
 * A course's sections and mastery plan cite a source by its record id -- the
 * authenticated page-opening key -- never by a human-readable name, so naming
 * one for a citation line has always meant resolving that id against the
 * source record it points at. getCourse already has to authorize this course
 * for this viewer, and the sources those ids point at are the same records a
 * citation is built from elsewhere (see courseCitations below); reading them
 * again here and handing the label back on the course itself means a client
 * never has to ask for anything to print one, let alone the whole source
 * library the way this used to. An id that does not resolve -- unapproved,
 * removed, simply absent -- is left out of the map rather than failing the
 * course fetch: the citation it would have named is one no reader could
 * open anyway.
 */
async function coursePublicationLabels(identity, sourceIds) {
  const ids = [...new Set((sourceIds || []).filter((id) => typeof id === 'string' && id.trim()))];
  if (!ids.length) return {};
  const labels = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const payload = recordPayload(await sourceFor(identity, id, { approvedOnly: true }));
      const label = payload.sourceId || payload.title || '';
      if (label) labels[id] = label;
    } catch {
      // Not a source this viewer can resolve right now; no label for it.
    }
  }));
  return labels;
}

export async function getCourse(identity, { params }) {
  const record = await getLearningRecord(params.id);
  if (!canViewCourse(identity, record)) {
    throw notFound('Course not found');
  }
  const fullCourse = recordPayload(record);
  const canAuthor = hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id;
  const revision = canAuthor ? await pendingCourseRevision(record) : null;
  const pendingCourse = revision ? courseRevisionPayload(revision).course : null;
  const course = canAuthor
    ? pendingCourse || fullCourse
    : learnerCourseProjection(fullCourse);
  const sourcePublications = await coursePublicationLabels(identity, [
    ...(Array.isArray(course.sourceIds) ? course.sourceIds : []),
    course.masteryPlan?.sourceId,
  ]);
  return {
    json: courseEnvelope(record, { ...course, sourcePublications }, {
      owner: canAuthor,
      revision,
    }),
  };
}

/**
 * The approved rubrics that already answer this course's objectives.
 *
 * Only the instructor's own APPROVED rubric records count, and only those
 * written for THIS course, for an objective the draft actually teaches, and
 * from the same approved source the plan is grounded against. That last filter
 * is not fussiness: the plan's every criterion is checked against one source's
 * text, so a rubric written from a different document would import wording that
 * source never carried. An objective whose rubric fails any of these simply has
 * no ratified answer and falls through to the model, exactly as before.
 *
 * `flagged` is re-checked even though approveRubric refuses a flagged rubric,
 * because this is the last place before a learner's grading where the question
 * can still be asked.
 *
 * The stored `validation` and `traceability` travel with each entry for the
 * same reason. `status` is written by the generic record updater, so APPROVED
 * is not by itself proof that approveRubric ever agreed; the mapper re-asserts
 * approveRubric's own conditions against this evidence before a dimension
 * becomes something a learner is graded against.
 */
async function ratifiedRubricsForCourse(identity, course, sourceId) {
  const objectives = courseObjectiveTexts(course);
  if (objectives.length === 0) return [];
  const records = await listLearningRecords({
    ownerId: identity.id,
    type: 'RUBRIC',
    status: 'APPROVED',
  });
  const byObjective = new Map();
  // listLearningRecords is newest-first, so the first approved rubric found for
  // an objective is the one the instructor most recently signed for it.
  for (const record of records) {
    const payload = recordPayload(record);
    if (payload.courseId !== course.id || payload.sourceId !== sourceId) continue;
    if (payload.rubric?.flagged === true) continue;
    const objective = typeof payload.objective === 'string' ? payload.objective.trim() : '';
    if (!objective || !objectives.includes(objective) || byObjective.has(objective)) continue;
    byObjective.set(objective, {
      id: record.id,
      status: record.status,
      objective,
      rubric: payload.rubric,
      validation: payload.validation,
      traceability: payload.traceability,
    });
  }
  return objectives.map((objective) => byObjective.get(objective)).filter(Boolean);
}

/**
 * Generate the one shared rubric for a course. The course itself may still be
 * a draft; the selected source must already be approved and related to that
 * course. A plan is immutable after creation, so a second generation can
 * never silently fragment the competency labels.
 *
 * Objectives the instructor has already approved a rubric for are not asked of
 * a model again -- those rubrics ARE the criteria. Partial coverage is normal
 * and never blocks generation; the response says which criteria came from
 * whom.
 */
export async function generateMasteryPlan(identity, { params, body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const course = await ownedCourse(identity, params.id);
  const sourceId = body?.sourceId;
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new TypeError('sourceId is required');
  }
  const payload = recordPayload(course);
  if (Object.prototype.hasOwnProperty.call(payload, 'masteryPlan')) {
    throw masteryPlanError(
      'This course already has a mastery plan; approved revisions are immutable.',
    );
  }
  if (!courseSourceIds(course).includes(sourceId)) {
    throw notFound('Source is not part of the course');
  }
  const source = await sourceFor(identity, sourceId, { approvedOnly: true });
  const text = sourceText(source);
  if (!text.trim()) {
    throw masteryPlanError(
      'The approved source has no text for mastery-plan grounding.',
      'MASTERY_PLAN_INVALID',
      422,
    );
  }
  const plan = await deriveMasteryPlan({
    objectives: courseObjectives(course, source),
    source: text,
    sourceId,
    ratifiedRubrics: await ratifiedRubricsForCourse(identity, course, sourceId),
  });
  const expectedVersion = Number.isInteger(course.version) ? course.version : 0;
  const committed = await updateLearningRecordIfVersion(course.id, expectedVersion, {
    payload: { ...payload, masteryPlan: plan },
  });
  if (!committed) {
    throw masteryPlanError(
      'This course changed while the mastery plan was being generated; retry with the latest course.',
      'CONFLICT',
      409,
    );
  }
  return { status: 201, json: planResponse(course, plan) };
}

/**
 * Approve exactly the pending revision that the owner reviewed. The source is
 * checked again at the approval boundary and the embedded JSON is committed by
 * compare-and-set so two stale approvals cannot both win.
 */
export async function approveMasteryPlan(identity, { params, body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const course = await ownedCourse(identity, params.id);
  const revision = body?.revision;
  if (typeof revision !== 'string' || !revision.trim()) {
    throw new TypeError('revision is required');
  }
  const current = planFromCourse(course);
  if (!current || current.status !== 'PENDING') {
    throw masteryPlanError('The course has no pending mastery plan.');
  }
  if (current.revision !== revision) {
    throw masteryPlanError('The mastery plan revision is stale.');
  }
  if (typeof current.sourceId !== 'string' || !courseSourceIds(course).includes(current.sourceId)) {
    throw masteryPlanError(
      'The pending mastery plan source is no longer part of this course.',
      'MASTERY_PLAN_INVALID',
      422,
    );
  }
  const source = await sourceFor(identity, current.sourceId, { approvedOnly: true });
  const validation = validateMasteryPlan(current, {
    sourceId: current.sourceId,
    sourceText: sourceText(source),
  });
  if (!validation.valid) {
    const error = masteryPlanError(
      `Mastery plan cannot be approved: ${validation.issues.join('; ')}`,
      'MASTERY_PLAN_INVALID',
      422,
    );
    error.validation = validation;
    throw error;
  }
  const approved = {
    status: 'APPROVED',
    sourceId: current.sourceId,
    criteria: validation.criteria,
    // Recomputed from the criteria being persisted rather than copied off the
    // pending plan, so an approved plan can never carry a ratification summary
    // that disagrees with the criteria it actually holds.
    provenance: masteryPlanProvenance(validation.criteria),
    revision: current.revision,
  };
  const expectedVersion = Number.isInteger(course.version) ? course.version : 0;
  const committed = await updateLearningRecordIfVersion(course.id, expectedVersion, {
    payload: { ...recordPayload(course), masteryPlan: approved },
  });
  if (!committed) {
    throw masteryPlanError(
      'This course changed while the mastery plan was being approved; retry with the latest revision.',
      'CONFLICT',
      409,
    );
  }
  return { json: planResponse(course, approved) };
}

/**
 * Generate one targeted revision from approved persisted sources. The model
 * runs before the compare-and-set; a stale response is never silently saved.
 */
export async function reviseCourse(identity, { params, body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const request = parseRevisionRequest(body || {});
  const record = await ownedCourse(identity, params.id);
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  if (request.version !== expectedVersion) {
    throw courseConflict('This course changed; retry the revision against the latest version.');
  }

  const previousRevision = await pendingCourseRevision(record);
  const currentPayload = recordPayload(record);
  const baseCourse = previousRevision
    ? courseRevisionPayload(previousRevision).course
    : authoredCoursePayload(currentPayload);
  const sourceIds = Array.isArray(baseCourse?.sourceIds)
    ? [...new Set(baseCourse.sourceIds)]
    : Array.isArray(currentPayload.sourceIds)
      ? [...new Set(currentPayload.sourceIds)]
      : [];
  if (sourceIds.length === 0) {
    throw sourceApprovalError(
      'Course cannot be revised without persisted source relationships.',
      'COURSE_REVISION_NOT_APPROVABLE',
    );
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  const generated = await reviseCourseContent({
    course: normaliseCourseIds(baseCourse),
    ...request,
    sourceDocuments: sources.flatMap(sourceDocuments),
  });
  const revisedCourse = applyCourseRevision(
    { ...normaliseCourseIds(baseCourse), sourceIds },
    request,
    generated,
  );
  revisedCourse.sourceIds = sourceIds;
  const validation = validateCourseDraft(revisedCourse, { sources });
  if (!validation.valid) {
    const error = courseRevisionError(
      `Course revision failed grounding validation: ${validation.issues.join('; ')}`,
      'COURSE_REVISION_NOT_APPROVABLE',
      422,
    );
    error.validation = validation;
    throw error;
  }

  const revisionPayload = {
    courseId: record.id,
    baseVersion: expectedVersion,
    reviewedVersion: expectedVersion + 1,
    scope: request.scope,
    sectionId: request.sectionId,
    ...(request.phase ? { phase: request.phase } : {}),
    ...(request.questionId ? { questionId: request.questionId } : {}),
    instructions: request.instructions,
    sourceIds,
    course: revisedCourse,
    validation,
  };
  const committed = await createCourseRevisionAtomically({
    courseId: record.id,
    ownerId: identity.id,
    expectedVersion,
    expectedStatus: record.status,
    revisionPayload,
    revisionHistoryEntry: {
      scope: request.scope,
      sectionId: request.sectionId,
      ...(request.phase ? { phase: request.phase } : {}),
      ...(request.questionId ? { questionId: request.questionId } : {}),
      instructions: request.instructions,
      baseVersion: expectedVersion,
      version: expectedVersion + 1,
    },
  });
  if (!committed?.committed) {
    throw courseConflict('This course changed while the revision was being generated; retry.');
  }
  const revision = committed.revision;
  const history = committed.revisionHistory;
  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      version: expectedVersion + 1,
      course: revisedCourse,
      revisionHistory: history,
      hasPendingRevision: true,
      revision: revisionSummary(revision, revisionPayload),
    },
  };
}

/**
 * Approve exactly the owner-reviewed course version. Pending revisions are
 * separate LearningRecords, so an approved delivery snapshot remains intact
 * until this transaction creates the replacement release.
 */
export async function approveCourse(identity, { params, body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const record = await ownedCourse(identity, params.id);
  if (!Number.isInteger(body?.version) || body.version < 0) {
    throw new TypeError('version must be a non-negative integer');
  }
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  if (body.version !== expectedVersion) {
    throw courseConflict('The reviewed course version is stale; reload before approving.');
  }
  const pending = await pendingCourseRevision(record);
  if (record.status === 'APPROVED' && !pending) {
    throw courseConflict('The approved course has no pending revision to release.');
  }
  if (
    pending &&
    courseRevisionPayload(pending).reviewedVersion !== expectedVersion
  ) {
    throw courseConflict('The pending revision is stale; reload before approving.');
  }
  const currentPayload = recordPayload(record);
  const candidate = pending
    ? courseRevisionPayload(pending).course
    : authoredCoursePayload(currentPayload);
  const candidatePayload = normaliseCourseIds(candidate);
  const sourceIds = Array.isArray(candidatePayload.sourceIds)
    ? [...new Set(candidatePayload.sourceIds)]
    : Array.isArray(currentPayload.sourceIds)
      ? [...new Set(currentPayload.sourceIds)]
      : [];
  if (sourceIds.length === 0) {
    throw sourceApprovalError(
      'Course cannot be approved without persisted source relationships.',
      'COURSE_NOT_APPROVABLE',
    );
  }
  candidatePayload.sourceIds = sourceIds;
  /* A course is not approvable while a section has no lesson page.
   *
   * The builder offered "Approve and publish" beside its own status line
   * reading "Rewrite lesson pages (10/11 written)", and nothing refused it:
   * the checks here covered role, ownership, version staleness and pending
   * revisions, so a course could be published with a section a learner opens
   * and finds empty. Items are generated per section whether or not its page
   * was written, which is how a section ends up assessing text nobody was
   * shown.
   */
  const unwritten = (Array.isArray(candidatePayload.sections) ? candidatePayload.sections : [])
    .filter((section) => !Array.isArray(section?.pages) || section.pages.length === 0);
  if (unwritten.length > 0) {
    const named = unwritten.slice(0, 3).map((section, index) => section?.title || `section ${index + 1}`);
    const error = new Error(
      `${unwritten.length} section${unwritten.length === 1 ? ' has' : 's have'} no lesson page yet`
      + ` (${named.join('; ')}${unwritten.length > named.length ? ', and others' : ''}).`
      + ' Write the lesson pages before approving.',
    );
    error.code = 'COURSE_PAGES_UNWRITTEN';
    error.status = 422;
    error.validation = {
      valid: false,
      unwritten: unwritten.length,
      sections: unwritten.map((section) => section?.title || null),
    };
    throw error;
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  const validation = validateCourseDraft(candidatePayload, { sources });
  if (!validation.valid) {
    const error = sourceApprovalError(
      `Course cannot be approved: ${validation.issues.join('; ')}`,
      'COURSE_NOT_APPROVABLE',
    );
    error.validation = validation;
    throw error;
  }
  const sourcePayload = recordPayload(sources[0]);
  const sourceId = sourcePayload.sourceId || sourcePayload.title || sources[0].id || 'unknown';
  const deliveryCourseId =
    record.status === 'APPROVED' ||
    (typeof currentPayload.deliveryCourseId === 'string' && currentPayload.deliveryCourseId.trim())
      ? `${record.id}:release:${pending?.id || expectedVersion + 1}`
      : record.id;
  const history = revisionHistoryOf(currentPayload).map((entry) =>
    pending && entry.id === pending.id
      ? {
          ...entry,
          status: 'APPROVED',
          approvedVersion: expectedVersion + 1,
          deliveryCourseId,
        }
      : entry,
  );
  // The label -> passage text seam. These are the same approved-source
  // passages `validateCourseDraft` just graded this draft against, handed on
  // so the materialiser can cite each ITEM to the passage it came from
  // instead of stamping the section's primary label on all of them. Nothing
  // extra is loaded and nothing is copied into the draft: it is the
  // projection this request already has in hand.
  const passages = sourcePassageIndex(sources);

  /* Entailment verification happens HERE, before the transaction.
   *
   * The materialiser runs inside approveCourseAtomically's Prisma transaction,
   * and an HTTP call to a model on a board has no business inside one: it
   * would hold row locks open for the length of a model run. So the rows about
   * to be written are projected first -- the projection is pure and
   * deterministic, and `deliveryCourseId` is already computed above for the
   * revision history, so these are the same ids the transaction will write --
   * each item's own claim is scored against the passages its own citation
   * resolves to, and the measured scores are handed down.
   *
   * Nothing here can fail the approval. A verifier that is unconfigured, down,
   * slow or wrong yields an empty map, every item keeps `support: null`, and
   * the review panel says "not verified" -- which is then a true statement.
   */
  const support = await measureItemSupport(
    projectCourseRows(deliveryCourseId, candidatePayload, { sourceId, passages }).sections,
    passages,
  );

  const committed = await approveCourseAtomically({
    courseId: record.id,
    ownerId: identity.id,
    expectedVersion,
    candidatePayload,
    sourceId,
    sections: candidatePayload.sections,
    passages,
    // id -> measured HHEM support. Present only for items an entailment check
    // actually returned a score for; the transaction writes null for the rest
    // and never defaults.
    support,
    revisionId: pending?.id || null,
    revisionHistory: history,
  });
  if (!committed?.committed) {
    throw courseConflict('This course changed while it was being approved; reload and retry.');
  }
  return {
    json: {
      id: record.id,
      status: 'APPROVED',
      version: committed.version,
      course: candidatePayload,
      revisionHistory: history,
      hasPendingRevision: false,
      materialised: committed.materialised,
      deliveryCourseId: committed.deliveryCourseId,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Per-item ratification
 *
 * Approving a course releases a delivery snapshot; it does not release the
 * items inside it. The materialiser writes every Item PENDING (see
 * ./project-course.js) and the learner-facing queries in app/api/courses
 * filter `status: 'APPROVED'`, so generated content reaches a student only
 * after an instructor has ratified it one item at a time.
 *
 * The delivery course id is the addressing key, not the draft record id: on
 * every re-approval it becomes `${record.id}:release:${...}`, so a ratification
 * belongs to exactly the release it was made against.
 * ------------------------------------------------------------------------- */

function deliveryCourseIdOf(record) {
  const id = recordPayload(record).deliveryCourseId;
  return typeof id === 'string' && id.trim() ? id : record.id;
}

/** The owner-reviewable delivery course behind a COURSE_DRAFT, or 404. */
async function reviewableCourse(identity, courseId) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const record = await ownedCourse(identity, courseId);
  if (record.status !== 'APPROVED') {
    throw courseConflict('Approve the course before reviewing its items.');
  }
  return { record, deliveryCourseId: deliveryCourseIdOf(record) };
}

/**
 * Every item of the released course with its review state. Deliberately
 * unfiltered — PENDING items are precisely what the reviewer came for.
 */
export async function listCourseItems(identity, { params }) {
  const { record, deliveryCourseId } = await reviewableCourse(identity, params.id);
  const sections = await listDeliveryCourseItems(deliveryCourseId);
  const counts = itemReviewCounts(sections);
  return {
    json: {
      id: record.id,
      deliveryCourseId,
      sections,
      counts,
      total: counts.PENDING + counts.APPROVED + counts.REJECTED,
      readyForLearners: counts.PENDING === 0,
    },
  };
}

/**
 * Record one instructor decision against one materialised item.
 *
 * APPROVE releases it to learners, REJECT withholds it, REVISE edits the
 * authored content and ratifies in the same action — a reviewer who had to fix
 * an item has, by fixing it, reviewed it.
 */
export async function reviewCourseItem(identity, { params, body }) {
  const { record, deliveryCourseId } = await reviewableCourse(identity, params.id);
  const itemId = typeof params?.itemId === 'string' ? params.itemId.trim() : '';
  if (!itemId) throw new TypeError('itemId is required');
  const decision = normaliseDecision(body?.decision);

  const existing = await getDeliveryCourseItem(deliveryCourseId, itemId);
  if (!existing) throw notFound('Item not found');

  const item = await updateDeliveryCourseItem(
    deliveryCourseId,
    itemId,
    itemDecisionData(decision, body, existing),
  );
  if (!item) throw notFound('Item not found');

  const sections = await listDeliveryCourseItems(deliveryCourseId);
  const counts = itemReviewCounts(sections);
  return {
    json: {
      id: record.id,
      deliveryCourseId,
      item,
      counts,
      readyForLearners: counts.PENDING === 0,
    },
  };
}

/**
 * A rewritten version of one item, for a human to accept, edit or ignore.
 *
 * WHAT THIS IS NOT. It does not save anything, it does not touch the course,
 * and it does not create a revision. The item review screen ratifies items on
 * a course that is already APPROVED and may already have learners in it, so an
 * AI edit that applied itself would be changing a published course out from
 * under them. This hands a suggestion to the form instead: the instructor
 * reads it, edits it, and saves it through the path that already exists --
 * which is also the path that ratifies the item and records who did it.
 *
 * WHAT MAKES IT SAFE TO SUGGEST AT ALL. The same grounding rule as everything
 * else. The suggestion is written from the passage the item already cites and
 * checked against it, so an instructor cannot be handed fluent text that the
 * approved source does not support. A suggestion that fails that check is not
 * offered, and the reason is returned instead -- a refusal an instructor can
 * read beats a rewrite they have to catch.
 *
 * The citation and the support score are deliberately not part of this. They
 * are measurements of the item as it stands; a suggestion is not the item
 * until someone saves it, and re-measuring before that would be reporting a
 * score for something that does not exist yet.
 */
export async function suggestCourseItem(identity, { params, body }) {
  const { record, deliveryCourseId } = await reviewableCourse(identity, params.id);
  const itemId = typeof params?.itemId === 'string' ? params.itemId.trim() : '';
  if (!itemId) throw new TypeError('itemId is required');

  const existing = await getDeliveryCourseItem(deliveryCourseId, itemId);
  if (!existing) throw notFound('Item not found');
  if (existing.kind !== 'QUESTION') {
    const error = new Error('Only a question can be rewritten from here.');
    error.code = 'ITEM_SUGGESTION_UNSUPPORTED';
    error.status = 422;
    throw error;
  }

  const model = learningModelStatus();
  if (!model?.model?.ready) {
    const error = new Error(model?.model?.reason || 'No text model is configured.');
    error.code = 'NO_PROVIDER';
    throw error;
  }

  // The passage this item is cited to, resolved the same way the page pass
  // resolves one -- so a suggestion is grounded in exactly the text the item
  // claims to come from, and not in the corpus at large.
  const sourceIds = courseSourceIds(recordPayload(record));
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  const documents = sources.flatMap(sourceDocuments);
  const passage = passageForCitation(documents, existing.citation);
  if (!passage) {
    const error = new Error(
      `The passage this item cites (${existing.citation || 'none recorded'}) could not be resolved, `
      + 'so there is nothing to ground a rewrite in.',
    );
    error.code = 'ITEM_SUGGESTION_NOT_GROUNDABLE';
    error.status = 422;
    throw error;
  }

  const suggestion = await suggestQuestionRewrite(
    {
      question: {
        stem: existing.stem,
        options: Array.isArray(existing.options) ? existing.options : [],
        answer: existing.answer,
        rationale: existing.rationale,
      },
      passage,
      instructions: typeof body?.instructions === 'string' ? body.instructions.trim() : '',
    },
  );

  if (!suggestion) {
    const error = new Error(
      'The model would not write a grounded replacement for this item from its cited passage.',
    );
    error.code = 'ITEM_SUGGESTION_REFUSED';
    error.status = 422;
    throw error;
  }

  return { json: { id: record.id, itemId, suggestion } };
}

/**
 * Approve every item still PENDING on the released course. One human, one
 * deliberate click, stated count -- see approvePendingDeliveryCourseItems.
 */
export async function approvePendingCourseItems(identity, { params }) {
  const { record, deliveryCourseId } = await reviewableCourse(identity, params.id);
  const approved = await approvePendingDeliveryCourseItems(deliveryCourseId);
  const sections = await listDeliveryCourseItems(deliveryCourseId);
  const counts = itemReviewCounts(sections);
  return {
    json: {
      id: record.id,
      deliveryCourseId,
      approved,
      counts,
      readyForLearners: counts.PENDING === 0,
    },
  };
}

export async function attachSyllabus(identity, { params, body }) {
  const record = await ownedCourse(identity, params.id);
  if (!Array.isArray(body?.syllabus) || body.syllabus.length === 0) {
    throw new TypeError('syllabus must be a non-empty array');
  }
  for (const [index, item] of body.syllabus.entries()) {
    if (
      !item ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      typeof item.due !== 'string' ||
      !validIsoDate(item.due)
    ) {
      throw new TypeError(`syllabus[${index}] requires title and YYYY-MM-DD due`);
    }
    if (
      item.hours !== undefined &&
      (typeof item.hours !== 'number' || !Number.isFinite(item.hours) || item.hours <= 0)
    ) {
      throw new TypeError(`syllabus[${index}].hours must be positive`);
    }
  }
  const payload = recordPayload(record);
  const updated = await updateLearningRecord(record.id, {
    payload: {
      ...payload,
      syllabus: body.syllabus,
      ...(body.asOf ? { asOf: body.asOf } : {}),
      ...(body.availability !== undefined ? { availability: body.availability } : {}),
      ...(body.status ? { studyStatus: body.status } : {}),
    },
  });
  return { json: { id: updated.id, status: updated.status, syllabus: body.syllabus } };
}

/* ---------------- evidence authoring inputs ---------------- */

// Instructor authoring seam consumed by Hotwash. Critiques are persisted
// before the AAR route runs; no request may submit an ephemeral-only report.
export async function recordCritiques(identity, { body }) {
  const courseId = body?.courseId;
  if (typeof courseId !== 'string' || !courseId.trim()) throw new TypeError('courseId is required');
  if (!Array.isArray(body?.critiques) || body.critiques.length === 0) {
    throw new TypeError('critiques must be a non-empty array');
  }
  for (const [index, critique] of body.critiques.entries()) {
    if (!critique || typeof critique !== 'object' || Array.isArray(critique)) {
      throw new TypeError(`critiques[${index}] must be an object`);
    }
    const area = critique.area ?? critique.topic ?? critique.lesson ?? critique.module;
    if (typeof area !== 'string' || !area.trim()) {
      throw new TypeError(`critiques[${index}] requires area`);
    }
    if (critique.kind !== undefined && critique.kind !== 'sustain' && critique.kind !== 'improve') {
      throw new TypeError(`critiques[${index}].kind must be sustain or improve`);
    }
    if (critique.severity !== undefined) {
      if (typeof critique.severity === 'string' && !critique.severity.trim()) {
        throw new TypeError(`critiques[${index}].severity must be between 1 and 5`);
      }
      const severity =
        typeof critique.severity === 'string' ? Number(critique.severity.trim()) : critique.severity;
      if (!Number.isFinite(severity) || severity < 1 || severity > 5) {
        throw new TypeError(`critiques[${index}].severity must be between 1 and 5`);
      }
    }
    if (critique.weight !== undefined) {
      if (typeof critique.weight === 'string' && !critique.weight.trim()) {
        throw new TypeError(`critiques[${index}].weight must be finite and non-negative`);
      }
      const weight =
        typeof critique.weight === 'string' ? Number(critique.weight.trim()) : critique.weight;
      if (!Number.isFinite(weight) || weight < 0) {
        throw new TypeError(`critiques[${index}].weight must be finite and non-negative`);
      }
    }
  }
  const course = await ownedCourse(identity, courseId);
  // Accumulate: each recorded critique grows the running set instead of
  // replacing it. getAarInput (lib/db.js) reads only the LATEST CRITIQUE_SET, so
  // without this a course's AAR could never hold more than the single critique
  // most recently submitted. Merge the newest existing set's critiques ahead of
  // the ones submitted now, keyed to this course.
  const priorCritiqueSets = await listLearningRecords({ ownerId: identity.id, type: 'CRITIQUE_SET' });
  const latestPriorSet = priorCritiqueSets
    .filter((record) => recordPayload(record).courseId === courseId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const priorCritiques = latestPriorSet && Array.isArray(recordPayload(latestPriorSet).critiques)
    ? recordPayload(latestPriorSet).critiques
    : [];
  const mergedCritiques = [...priorCritiques, ...body.critiques];
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'CRITIQUE_SET',
    status: 'RECORDED',
    payload: {
      courseId,
      courseTitle: recordPayload(course).title || recordPayload(course).course?.title,
      critiques: mergedCritiques,
    },
  });
  return {
    status: 201,
    json: { id: record.id, courseId, critiques: mergedCritiques.length, persisted: true },
  };
}

// Instructor authoring seam consumed by the separate Understudy fidelity
// benchmark. Doctrine is selected from approved persisted sources, never
// copied from a request body.
export async function recordFidelityCases(identity, { body }) {
  const { courseId, sourceIds, persona, cases } = body || {};
  if (typeof courseId !== 'string' || !courseId.trim()) throw new TypeError('courseId is required');
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new TypeError('sourceIds must be a non-empty array');
  }
  if (typeof persona !== 'string' || !persona.trim()) throw new TypeError('persona is required');
  if (!Array.isArray(cases) || cases.length === 0) throw new TypeError('cases must be a non-empty array');
  await ownedCourse(identity, courseId);
  const sources = await Promise.all(sourceIds.map((id) => sourceFor(identity, id)));
  if (sources.some((source) => source.status !== 'APPROVED')) {
    const error = new Error('Fidelity doctrine sources must be approved');
    error.code = 'SOURCE_NOT_APPROVED';
    throw error;
  }
  for (const [index, item] of cases.entries()) {
    if (
      !item ||
      typeof item.situation !== 'string' ||
      !item.situation.trim() ||
      typeof item.expect !== 'string' ||
      !item.expect.trim()
    ) {
      throw new TypeError(`cases[${index}] requires situation and expect`);
    }
  }
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'FIDELITY_CASES',
    status: 'RECORDED',
    payload: {
      courseId,
      sourceIds,
      persona: persona.trim(),
      cases,
      ...(body.k !== undefined ? { k: body.k } : {}),
      ...(body.strict !== undefined ? { strict: Boolean(body.strict) } : {}),
      ...(body.groundingThreshold !== undefined
        ? { groundingThreshold: body.groundingThreshold }
        : {}),
    },
  });
  return {
    status: 201,
    json: { id: record.id, courseId, sourceIds, cases: cases.length, persisted: true },
  };
}

/* ---------------- rubrics ---------------- */

const MAX_SUGGESTED_TASKS = 10;

function slugCode(title, index) {
  const slug = String(title || 'task')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .filter((word) => word.length > 2)
    .slice(0, 3)
    .join('-');
  return `SC-${slug || 'TASK'}-${String(index + 1).padStart(2, '0')}`;
}

function suggestedTask(task, index) {
  const steps = Array.isArray(task?.performanceSteps) ? task.performanceSteps : [];
  return {
    // Quarry reads a real task code out of the document when the document has
    // one. A generated code is deliberately SC-prefixed rather than shaped like
    // an official MOS code, so nothing downstream reads as authoritative when
    // it was only derived from a title.
    code: typeof task?.code === 'string' && task.code.trim()
      ? task.code.trim()
      : slugCode(task?.title, index),
    codeGenerated: !(typeof task?.code === 'string' && task.code.trim()),
    title: String(task?.title || '').trim(),
    condition: String(task?.condition || '').trim(),
    standard: String(task?.standard || '').trim(),
    performanceSteps: steps.map((step) => String(step).trim()).filter(Boolean),
  };
}

/**
 * Quarry's ingest-time extraction of the source, ready for the rubric form, or
 * null when the document is not in a task-block format. Preferred over the
 * model: it is deterministic and quotes the document rather than paraphrasing
 * it. A task missing a condition or standard cannot fill the form, so it does
 * not count as extracted.
 */
export function extractedRubricTasks(payload) {
  const extracted = Array.isArray(payload?.tasks) ? payload.tasks : [];
  const usable = extracted.filter((task) => task?.title && task?.condition && task?.standard);
  return usable.length > 0
    ? { origin: 'quarry', tasks: usable.slice(0, MAX_SUGGESTED_TASKS).map(suggestedTask) }
    : null;
}

/**
 * Fill the rubric form from the source instead of making the instructor retype
 * a task that is already written down, falling back to the model only when the
 * document carries no task block.
 */
export async function suggestRubricTasks(identity, { body }) {
  const { sourceId } = body || {};
  // Same approved-source boundary as generation: the form these fields land in
  // is the one that generates the rubric, so a draft source must not be able to
  // write the task a grounded rubric is then built from.
  const source = await sourceFor(identity, sourceId, { approvedOnly: true });
  const payload = recordPayload(source);
  const extracted = extractedRubricTasks(payload);
  if (extracted) return { json: extracted };
  const drafted = await draftRubricTask({ sourceText: payload.text });
  return { json: { origin: 'model', tasks: [suggestedTask(drafted, 0)] } };
}

/**
 * The objectives a course teaches, as written on the draft.
 *
 * Deliberately narrower than courseObjectives above: that one falls back to the
 * source's task titles so a mastery plan always has something to derive from.
 * A rubric is claimed to judge *this course's* objective, so an objective that
 * is not on the course must not be accepted just because the source mentions
 * it.
 */
function courseObjectiveTexts(course) {
  const payload = recordPayload(course);
  const candidate = payload.objectives ?? payload.course?.objectives;
  return Array.isArray(candidate)
    ? candidate
        .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry?.objective || '').trim()))
        .filter(Boolean)
    : [];
}

/**
 * Optionally bind a rubric to the course objective it judges.
 *
 * A rubric with no course is still valid -- a standard can be turned into a
 * BARS scale on its own -- but a rubric that claims a course objective has to
 * prove it: the course must be the instructor's, the objective must be one the
 * draft actually teaches, and the source must already be related to that
 * course. Anything less would let the coverage map on the course screen report
 * an objective as judged by a rubric written from unrelated text.
 */
async function rubricCourseLink(identity, { courseId, objective, sourceId }) {
  if (courseId === undefined || courseId === null || courseId === '') return {};
  if (typeof courseId !== 'string' || !courseId.trim()) {
    throw new TypeError('courseId must be a non-empty string');
  }
  if (typeof objective !== 'string' || !objective.trim()) {
    throw new TypeError('objective is required when a rubric names a course');
  }
  const course = await ownedCourse(identity, courseId);
  if (!courseSourceIds(course).includes(sourceId)) {
    throw notFound('Source is not part of the course');
  }
  const text = objective.trim();
  if (!courseObjectiveTexts(course).includes(text)) {
    throw notFound('Objective is not part of the course');
  }
  return { courseId, objective: text };
}

export async function generateRubricRecord(identity, { body }) {
  const { task, sourceId, courseId, objective } = body || {};
  // Approved-only, like every other grounded generator here. The screen has
  // always offered approved sources alone, but the route accepted any source
  // its owner could read, so the guarantee lived in the UI rather than in the
  // server that enforces the rest of them.
  const source = await sourceFor(identity, sourceId, { approvedOnly: true });
  const link = await rubricCourseLink(identity, { courseId, objective, sourceId });
  const result = await generateRubric({ task, sourceText: recordPayload(source).text });
  const record = await createRecordWithSourceGuards({
    ownerId: identity.id,
    type: 'RUBRIC',
    status: 'PENDING',
    sources: [source],
    payload: { ...result, sourceId, ...link },
  });
  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      validation: result.validation,
      traceability: result.traceability,
      rubric: result.rubric,
    },
  };
}

/**
 * The owner's rubrics.
 *
 * There was no list endpoint at all, which is why the rubrics screen could
 * only ever show the one it had just generated -- and why a rubric could
 * neither be renamed nor removed. A rubric is owner-private (unlike a source,
 * which becomes readable once approved), so this never widens past the owner.
 *
 * `title` prefers an explicit rename, then the task it was generated for, so a
 * freshly generated rubric still has something meaningful to show.
 */
export async function listRubrics(identity) {
  const records = await listLearningRecords({ ownerId: identity.id, type: 'RUBRIC' });
  return {
    json: records.map((record) => {
      const payload = recordPayload(record);
      const task = payload.rubric?.task || payload.task || {};
      return {
        id: record.id,
        status: record.status,
        title: payload.title || task.title || task.code || 'Untitled rubric',
        taskCode: task.code || null,
        sourceId: payload.sourceId || null,
        // The course objective this rubric judges, when it was written for one.
        courseId: payload.courseId || null,
        objective: payload.objective || null,
        // Rubricon returns `dimensions`; nothing it produces has ever had a
        // `criteria` array, so this counted zero for every rubric ever written
        // and the list said "0 criteria" beside a full six-dimension BARS
        // scale. A flagged rubric genuinely has none, which is why the refusal
        // is reported separately rather than read off a count of nothing.
        dimensions: Array.isArray(payload.rubric?.dimensions) ? payload.rubric.dimensions.length : 0,
        flagged: payload.rubric?.flagged === true,
        createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : null,
      };
    }),
  };
}

async function ownedRubric(identity, id) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== 'RUBRIC' || record.ownerId !== identity.id) {
    throw notFound('Rubric not found');
  }
  return record;
}

export async function getRubric(identity, { params }) {
  const record = await ownedRubric(identity, params.id);
  return { json: { id: record.id, status: record.status, ...recordPayload(record) } };
}

export async function approveRubric(identity, { params }) {
  const record = await ownedRubric(identity, params.id);
  const { validation, traceability, rubric } = recordPayload(record);
  if (
    !validation ||
    validation.valid !== true ||
    rubric?.flagged === true ||
    !traceability ||
    traceability.grounded !== true ||
    (Array.isArray(traceability.ungrounded) && traceability.ungrounded.length > 0)
  ) {
    const error = new Error(
      'Rubric cannot be approved until validation, grounding, and traceability pass.',
    );
    error.code = 'RUBRIC_NOT_APPROVABLE';
    throw error;
  }
  const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
  return { json: { id: updated.id, status: updated.status } };
}

/* ---------------- tutor ---------------- */

/**
 * Learning-course visibility is currently authenticated-public after approval:
 * listCourses and the learner course reader expose every APPROVED
 * COURSE_DRAFT to a verified learning user. Roster enrollment is used for
 * messaging/roster operations, not delivery access, and there is no learner
 * enrollment check in either course delivery route. Keep tutor authorization
 * exactly aligned with this established course-view rule rather than inventing
 * a second enrollment convention. Pending courses remain owner-only.
 */
export function canViewCourse(identity, course) {
  if (!course || course.type !== 'COURSE_DRAFT') return false;
  return course.status === 'APPROVED' || (
    hasRole(identity?.role, INSTRUCTOR) && course.ownerId === identity?.id
  );
}

function tutorScopeError(message, code = 'TUTOR_SCOPE_REQUIRED', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Resolve the course rather than accepting a client-selected global source
 * list. This deliberately uses the same authenticated-public/owner-only
 * visibility rule as getCourse; see canViewCourse for why roster rows are not
 * a course delivery authorization boundary in the current product.
 */
async function courseForTutor(identity, courseId) {
  if (typeof courseId !== 'string' || !courseId.trim()) {
    throw tutorScopeError('courseId is required for grounded student chat');
  }
  const course = await getLearningRecord(courseId);
  if (!canViewCourse(identity, course)) {
    throw notFound('Course not found');
  }
  const sourceIds = [...new Set(courseSourceIds(course).filter(
    (id) => typeof id === 'string' && id.trim(),
  ))];
  if (!sourceIds.length) {
    throw tutorScopeError(
      'This course has no persisted approved source selection for student chat.',
      'TUTOR_SCOPE_INVALID',
      409,
    );
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: true })),
  );
  if (!sources.length || sources.some((source) => sourcePassages(source).length === 0)) {
    throw tutorScopeError(
      'This course has no addressable approved source passages for student chat.',
      'TUTOR_SCOPE_INVALID',
      409,
    );
  }
  return { course, sourceIds, sources };
}

function tutorHistory(records, courseId) {
  // History is a convenience for continuity, not evidence. It is reconstructed
  // from this identity's recorded turns so a request cannot inject another
  // learner's conversation or an arbitrary claim into the grounding prompt.
  const entries = records
    .filter((record) => {
      const payload = recordPayload(record);
      return payload.courseId === courseId && payload.failure !== true;
    })
    .reverse()
    .slice(-12)
    .flatMap((record) => {
      const payload = recordPayload(record);
      const entries = [];
      if (typeof payload.question === 'string' && payload.question.trim()) {
        entries.push({ role: 'user', text: payload.question });
      }
      if (
        typeof payload.answer === 'string' &&
        payload.answer.trim() &&
        payload.refused !== true &&
        payload.failure !== true
      ) {
        entries.push({ role: 'assistant', text: payload.answer });
      }
      return entries;
    });
  // The grounding boundary also enforces these limits. Apply them while
  // reconstructing history so an old long model answer cannot turn a new
  // learner question into an avoidable request failure.
  const bounded = [];
  let characters = 0;
  for (const entry of entries.reverse()) {
    if (bounded.length === MAX_TUTOR_HISTORY_TURNS || characters === MAX_TUTOR_HISTORY_CHARS) break;
    const text = Array.from(entry.text)
      .slice(0, Math.min(MAX_TUTOR_HISTORY_TURN_CHARS, MAX_TUTOR_HISTORY_CHARS - characters))
      .join('');
    if (!text) continue;
    characters += Array.from(text).length;
    bounded.unshift({ ...entry, text });
  }
  return bounded;
}

function citationSourceFor(citation, sources) {
  const match = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    return sources.find((source) => {
      const payload = recordPayload(source);
      return [source.id, payload.sourceId]
        .filter((alias) => typeof alias === 'string' && alias.trim())
        .some((alias) =>
          value === alias || value.startsWith(`${alias} `) || value.startsWith(`${alias}:`),
        );
    }) || null;
  };
  // The passage source is the model's immutable provenance field. A display
  // sourceId must never override it and redirect a citation to another source.
  return match(citation?.source) || match(citation?.sourceId) || match(citation?.source_id);
}

export function courseCitations(citations, sources) {
  if (!Array.isArray(citations)) return [];
  return citations.flatMap((citation) => {
    if (!citation || typeof citation !== 'object') return [];
    const source = citationSourceFor(citation, sources);
    // A citation without an authenticated, selected source cannot be opened,
    // and therefore cannot support a student-facing answer.
    if (!source) return [];
    const payload = recordPayload(source);
    // Name the publication here, where the approved source record has just been
    // resolved to authorize the citation. A tutor passage's `source` is the
    // LOCATOR "<record id> p.19" (see sourcePassages) because the record id is
    // the authenticated page-opening key -- but a primary key is not a citation
    // to the learner it exists for, and unlike a materialised Item this citation
    // carries no publication of its own. The alternative, resolving the id to a
    // title in the browser the way CourseReader must, costs a second request for
    // something already in hand and leaves the answer printing a cuid until it
    // lands. `pubId` is the same field the Item citation shape uses, so the chip
    // can go through the shared provenance helper. The locator is untouched.
    const pubId = payload.sourceId || payload.title || '';
    return [{ ...citation, sourceId: source.id, ...(pubId ? { pubId } : {}) }];
  });
}

function unavailableTutorFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'STUDENT_GROUNDING_ERROR';
  return {
    failure: true,
    code,
    // Never put provider response bodies, endpoint details, or raw stack
    // messages into a learner-visible record.
    reason: 'grounding_service_unavailable',
    stages: error?.stages && typeof error.stages === 'object'
      ? safeTutorStages(error.stages)
      : typeof error?.stage === 'string'
        ? { [error.stage]: { status: 'unavailable' } }
        : {},
  };
}

function safeTutorStages(stages) {
  if (!stages || typeof stages !== 'object' || Array.isArray(stages)) return {};
  const anchor = stages.anchor && typeof stages.anchor === 'object' ? stages.anchor : null;
  const sourcerer = stages.sourcerer && typeof stages.sourcerer === 'object'
    ? stages.sourcerer
    : null;
  const understudy = stages.understudy && typeof stages.understudy === 'object'
    ? stages.understudy
    : null;
  const model = stages.model && typeof stages.model === 'object' ? stages.model : null;
  return {
    // Carry the honest fallback marker through to the persisted turn and the UI:
    // when Anchor was unreachable, the configured model composed the answer over
    // the course passages (grounding integrity preserved by the downstream
    // stages). Whitelisted as a fixed string so no provider detail can leak.
    ...(stages.fallback === 'model-grounded' ? { fallback: 'model-grounded' } : {}),
    ...(anchor
      ? {
          anchor: {
            status: anchor.status || null,
            // Stage contracts carry counts, never selected passage text.
            count: Number.isInteger(anchor.count)
              ? anchor.count
              : Number.isInteger(anchor.selectedCount) ? anchor.selectedCount : 0,
            ...(Number.isInteger(anchor.authorizedCount)
              ? { authorizedCount: anchor.authorizedCount }
              : {}),
          },
        }
      : {}),
    ...(sourcerer
      ? {
          sourcerer: {
            status: sourcerer.status || null,
            reason: typeof sourcerer.reason === 'string' ? sourcerer.reason : null,
            faithful: sourcerer.faithfulness?.faithful === true,
          },
        }
      : {}),
    ...(understudy
      ? {
          understudy: {
            status: understudy.status || null,
            verdict: typeof understudy.verdict === 'string' ? understudy.verdict : null,
            conforms: understudy.conforms === true,
            grounded: understudy.grounding?.grounded === true,
          },
        }
      : {}),
    ...(model && (model.path === 'hosted' || model.path === 'local')
      ? {
          model: {
            path: model.path,
            fallback: model.fallback === true,
          },
        }
      : {}),
  };
}

/* Greetings and chit-chat are not questions. Running "hello" through the
 * grounding pipeline either burns a model call to abstain or, worse, tempts an
 * ungrounded reply -- so catch it up front and nudge the learner back to a real
 * question. Matches only when the WHOLE input is small talk (punctuation and
 * spacing stripped), so a genuine question that happens to open with "hi" is
 * never swallowed. */
const SMALL_TALK = new Set([
  'hi', 'hello', 'hey', 'heya', 'hiya', 'yo', 'sup', 'howdy', 'hi there', 'hey there',
  'good morning', 'good afternoon', 'good evening', 'good night', 'morning', 'evening',
  'greetings', 'bye', 'goodbye', 'good bye', 'cya', 'see ya', 'see you', 'later', 'farewell',
  'thanks', 'thank you', 'thx', 'ty', 'cheers', 'ok', 'okay', 'k', 'kk', 'cool', 'nice',
  'lol', 'lmao', 'haha', 'test', 'testing', 'ping', 'hello?', 'you there', 'are you there',
]);

function isSmallTalk(question) {
  const raw = String(question).toLowerCase();
  if (!/[a-z]/.test(raw)) return true; // nothing but punctuation / emoji / "??"
  const stripped = raw.replace(/[^a-z\s?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return true;
  if (SMALL_TALK.has(stripped)) return true;
  if (SMALL_TALK.has(stripped.replace(/\?/g, '').trim())) return true;
  return false;
}

export async function tutor(identity, { body }) {
  const { question, courseId } = body || {};
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > MAX_TUTOR_QUESTION
  ) {
    throw new TypeError(`question is required and must be at most ${MAX_TUTOR_QUESTION} characters`);
  }
  const scoped = await courseForTutor(identity, courseId);
  // A greeting is not a question. Nudge, don't ground -- and don't record it as
  // a tutor turn (it would pollute the history the next real question sees).
  if (isSmallTalk(question)) {
    return {
      json: {
        id: null,
        courseId: scoped.course.id,
        answer: "Focus, bro. Ask me something from the course and I'll answer with the passage it comes from.",
        refused: false,
        reason: 'small_talk',
        smallTalk: true,
        citations: [],
        stages: {},
        faithfulness: null,
      },
    };
  }
  const priorTurns = await listLearningRecords({
    ownerId: identity.id,
    type: 'TUTOR_TURN',
    take: TUTOR_HISTORY_RECORDS,
  });
  const history = tutorHistory(priorTurns, scoped.course.id);
  let result;
  try {
    result = await groundedStudentAnswer({
      question: question.trim(),
      passages: scoped.sources.flatMap(sourcePassages),
      history,
    });
  } catch (error) {
    const failure = unavailableTutorFailure(error);
    await createLearningRecord({
      ownerId: identity.id,
      type: 'TUTOR_TURN',
      status: 'FAILED',
      payload: {
        courseId: scoped.course.id,
        sourceIds: scoped.sourceIds,
        question: question.trim(),
        answer: null,
        refused: false,
        citations: [],
        ...failure,
      },
    });
    throw error;
  }
  // Every marker the delivered prose carries has to arrive with a citation of
  // that number. A citation whose source is not an approved, selected record is
  // dropped above; dropping only some of them would deliver an answer marked
  // [4] with no [4] to follow, which is the failure this numbering exists to
  // prevent. So a partial drop refuses the whole answer rather than half of it.
  // citedPassages' authorized-passage round-trip makes this unreachable today;
  // it stays because what the learner follows must not depend on that.
  const delivered = courseCitations(result?.citations, scoped.sources);
  const cited = Array.isArray(result?.citations) ? result.citations.length : 0;
  const citations = delivered.length === cited ? delivered : [];
  const refused = Boolean(result?.refused) || citations.length === 0;
  const reason = refused
    ? (result?.refused ? result.reason || null : 'citation_not_in_course_scope')
    : result?.reason || null;
  const answer = refused && !result?.refused
    ? 'I can’t provide a supported answer because the response did not cite an approved course source.'
    : result?.answer || null;
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'TUTOR_TURN',
    status: 'RECORDED',
    payload: {
      courseId: scoped.course.id,
      sourceIds: scoped.sourceIds,
      question: question.trim(),
      answer,
      refused,
      reason,
      citations,
      history,
      stages: safeTutorStages(result?.stages),
    },
  });
  return {
    json: {
      id: record.id,
      courseId: scoped.course.id,
      answer,
      refused,
      reason,
      citations,
      stages: safeTutorStages(result?.stages),
      faithfulness: result?.faithfulness || null,
    },
  };
}

/* ---------------- mastery (Whetstone) ---------------- */

export function savedMasteryView(record) {
  const state = recordPayload(record);
  const reportInput = state.report && typeof state.report === 'object'
    ? state.report
    : Array.isArray(state.criteria)
      ? { criteria: state.criteria }
      : null;
  const report = reportInput
    ? {
        ...(typeof reportInput.complete === 'boolean'
          ? { complete: reportInput.complete }
          : {}),
        ...(typeof reportInput.stalled === 'boolean' ? { stalled: reportInput.stalled } : {}),
        ...(Number.isFinite(reportInput.score) ? { score: reportInput.score } : {}),
        criteria: (Array.isArray(reportInput.criteria) ? reportInput.criteria : [])
          .filter((criterion) => criterion && typeof criterion === 'object')
          .map((criterion) => ({
            ...(typeof (criterion.competency ?? criterion.elo) === 'string'
              ? { competency: String(criterion.competency ?? criterion.elo) }
              : {}),
            ...(typeof criterion.verdict === 'string' ? { verdict: criterion.verdict } : {}),
          })),
        ...(Number.isInteger(reportInput.exchanges) ? { exchanges: reportInput.exchanges } : {}),
      }
    : null;
  const complete =
    record.status === 'COMPLETE' || state.complete === true || report?.complete === true;
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    courseId: state.courseId,
    ...(typeof state.releaseId === 'string' && state.releaseId.trim()
      ? { releaseId: state.releaseId }
      : {}),
    sourceId: state.sourceId,
    report,
    currentQuestion: complete ? null : state.currentQuestion,
    criteria: report?.criteria || [],
    /* How the session is going, which the learner could not see at all.
     *
     * Whetstone tracks every one of these and serialiseMasterySession stores
     * them; this view dropped all of them, so a learner faced a question with
     * no idea what it was testing, how much of the session was left, or that
     * their next attempt at a criterion was their last. See
     * lib/learning/mastery-progress.js.
     *
     * `rubric` is still deliberately absent. It is the grading material -- the
     * indicators a verdict is decided by -- and a learner shown those is a
     * learner writing to them instead of demonstrating what they know. The
     * criterion NAME is fine: it is a course objective they were taught from. */
    ...(Number.isInteger(state.eloIndex) ? { eloIndex: state.eloIndex } : {}),
    ...(Number.isInteger(state.exchanges) ? { exchanges: state.exchanges } : {}),
    ...(Number.isInteger(state.turns) ? { turns: state.turns } : {}),
    ...(Number.isInteger(state.maxTurns) ? { maxTurns: state.maxTurns } : {}),
    ...(Number.isInteger(state.maxAttemptsPerCriterion)
      ? { maxAttemptsPerCriterion: state.maxAttemptsPerCriterion }
      : {}),
    ...(state.attempts !== undefined && state.attempts !== null ? { attempts: state.attempts } : {}),
    ...(state.stalled === true ? { stalled: true } : {}),
    transcript: state.transcript || [],
    citations: state.citations || [],
    ...(typeof state.masteryPlanRevision === 'string' && state.masteryPlanRevision.trim()
      ? { masteryPlanRevision: state.masteryPlanRevision }
      : {}),
    // Present only once the owner has rated this session themselves. The
    // screen reads it to say "Re-rate" rather than "Rate"; it is the owner's
    // own input coming back to them, not another rater's.
    ...(Array.isArray(state.raterVerdicts) && state.raterVerdicts.length > 0
      ? { raterVerdicts: state.raterVerdicts }
      : {}),
  };
}

async function approvedCourseFor(identity, courseId, sourceId, releaseId) {
  const course = await getLearningRecord(courseId);
  if (
    !course ||
    course.type !== 'COURSE_DRAFT' ||
    course.status !== 'APPROVED' ||
    (identity.role === INSTRUCTOR && course.ownerId !== identity.id)
  ) {
    throw notFound('Approved course not found');
  }
  const courseSourceIds = recordPayload(course).sourceIds;
  if (!Array.isArray(courseSourceIds) || !courseSourceIds.includes(sourceId)) {
    throw notFound('Source is not part of the approved course');
  }
  const selectedReleaseId = selectedDeliveryId(course, releaseId);
  if (!selectedReleaseId) throw notFound('Approved course release not found');
  return { course, releaseId: selectedReleaseId };
}

export async function listMasterySessions(identity, { query }) {
  const records = await listLearningRecords({ ownerId: identity.id, type: 'MASTERY_SESSION' });
  return {
    json: records
      .filter((record) => {
        const payload = recordPayload(record);
        return (
          (!query.courseId || payload.courseId === query.courseId) &&
          (!query.releaseId || payload.releaseId === query.releaseId)
        );
      })
      .map(savedMasteryView),
  };
}

async function ownedSession(identity, id) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== 'MASTERY_SESSION' || record.ownerId !== identity.id) {
    throw notFound('Mastery session not found');
  }
  return record;
}

export async function getMasterySession(identity, { params }) {
  return { json: savedMasteryView(await ownedSession(identity, params.id)) };
}

/**
 * An instructor rating a finished mastery session themselves, so the agreement
 * between them and the grader can be measured rather than assumed.
 *
 * WHY THIS IS THE INSTRUCTOR'S OWN SESSION AND NOT A LEARNER'S. The obvious
 * design -- an instructor re-rates a Marine's session -- would hand them that
 * learner's written answers, and this platform's class views are aggregate by
 * construction precisely so that cannot happen. The reliability question does
 * not need it: what is being measured is whether the rubric plus the grader
 * reach the tier a qualified human reaches on the same answers, and an
 * instructor's own session answers that exactly as well. `ownedSession` is
 * unchanged, so the privacy boundary is not widened by a single row.
 *
 * WHAT IT IS FOR. "Rubric reliability is measured" is one of the four things
 * this platform claims to prove rather than assert, and until now nothing in
 * the repository had called any of Rubricon's reliability functions. This is
 * the call. It is also the check an assessment shop would insist on before
 * letting a model grade anybody: not a confidence score the model reports about
 * itself, but a chance-corrected agreement figure against a human.
 */
export async function rateMasterySession(identity, { params, body }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Mastery session not found');
  const record = await ownedSession(identity, params.id);
  const payload = recordPayload(record);
  const graded = Array.isArray(payload.report?.criteria) ? payload.report.criteria : [];
  if (record.status !== 'COMPLETE' || graded.length === 0) {
    const error = new Error('A session can only be rated once it has been graded.');
    error.code = 'SESSION_NOT_GRADED';
    error.status = 409;
    throw error;
  }
  const ratings = cleanRatings(graded, body?.criteria);
  if (ratings.length === 0) {
    const error = new Error('Rate at least one criterion this session assessed.');
    error.code = 'NO_RATINGS';
    error.status = 422;
    throw error;
  }
  const reliability = reliabilityOf(graded, ratings);
  const updated = await updateLearningRecord(record.id, {
    payload: {
      ...payload,
      // Stored beside the grade rather than replacing it. The model's verdict
      // is the evidence one half of this comparison rests on, and overwriting
      // it would destroy the measurement on the next read.
      raterVerdicts: ratings,
      ratedAt: new Date().toISOString(),
    },
  });
  return {
    json: {
      id: updated.id,
      criteria: ratings,
      reliability: reliabilityView(reliability),
    },
  };
}

/** The report as a screen reads it: no raw Rubricon block, no NaN. */
function reliabilityView(result) {
  if (!result) return null;
  const { report, ...rest } = result;
  return rest;
}

/**
 * How well the grader and this instructor agree across everything they have
 * rated on one course.
 *
 * Pooled rather than averaged -- see lib/learning/reliability.js on why a mean
 * of per-session kappas is the wrong figure.
 */
export async function courseReliability(identity, { params }) {
  if (!hasRole(identity?.role, INSTRUCTOR)) throw notFound('Course not found');
  const course = await ownedCourse(identity, params.id);
  const records = await listLearningRecords({ ownerId: identity.id, type: 'MASTERY_SESSION' });
  const pairs = [];
  let rated = 0;
  let unrated = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const payload = recordPayload(record);
    if (payload.courseId !== course.id) continue;
    const graded = Array.isArray(payload.report?.criteria) ? payload.report.criteria : [];
    if (graded.length === 0) continue;
    if (!Array.isArray(payload.raterVerdicts) || payload.raterVerdicts.length === 0) {
      unrated += 1;
      continue;
    }
    rated += 1;
    pairs.push({ model: graded, rater: payload.raterVerdicts });
  }
  return {
    json: {
      id: course.id,
      rated,
      // Sessions on this course that could be rated and have not been. Reported
      // because a kappa over one session is not a reliability claim, and an
      // instructor deciding whether to trust this number needs to know how much
      // of the evidence it rests on.
      unrated,
      reliability: reliabilityView(pooledReliability(pairs)),
    },
  };
}

export async function startMastery(identity, { body }) {
  const {
    sourceId,
    courseId,
    releaseId,
    objectives,
    maxTurns,
    maxAttemptsPerCriterion,
  } = body || {};
  if (typeof courseId !== 'string' || !courseId.trim()) throw new TypeError('courseId is required');
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new TypeError('sourceId is required');
  if (releaseId !== undefined && (typeof releaseId !== 'string' || !releaseId.trim())) {
    throw new TypeError('releaseId must be a non-empty string when provided');
  }
  const approved = await approvedCourseFor(identity, courseId, sourceId, releaseId);
  const course = approved.course;
  const source = await sourceFor(identity, sourceId, { approvedOnly: true });
  const payload = recordPayload(source);
  const plan = planFromCourse(course);
  let approvedCriteria;
  let masteryPlanRevision;
  if (plan) {
    if (plan.status === 'PENDING') {
      throw masteryPlanError('This course has a pending mastery plan and cannot start a session yet.');
    }
    if (plan.status !== 'APPROVED') {
      throw masteryPlanError(
        'This course has an invalid mastery plan.',
        'MASTERY_PLAN_INVALID',
        422,
      );
    }
    if (plan.sourceId !== sourceId) {
      throw notFound('Source is not the approved mastery-plan source');
    }
    const validation = validateMasteryPlan(plan, {
      sourceId,
      sourceText: sourceText(source),
    });
    if (!validation.valid) {
      const error = masteryPlanError(
        `Mastery plan is invalid: ${validation.issues.join('; ')}`,
        'MASTERY_PLAN_INVALID',
        422,
      );
      error.validation = validation;
      throw error;
    }
    approvedCriteria = validation.criteria;
    masteryPlanRevision = plan.revision;
  }
  const taskTitles = (payload.tasks || []).map((task) => task.title).filter(Boolean);
  const fallbackObjectives = taskTitles.length ? taskTitles : payload.title;
  // Once a course has an approved shared plan, request objectives are
  // untrusted and cannot fragment the course competency labels.
  const resolvedObjectives = approvedCriteria
    ? approvedCriteria.map((criterion) => criterion.elo)
    : objectives === undefined
      ? fallbackObjectives
      : objectives;
  const started = await startMasterySession({
    objectives: resolvedObjectives,
    source: sourceText(source),
    ...(approvedCriteria ? { approvedCriteria, masteryPlanRevision } : {}),
    ...(Number.isInteger(maxTurns) ? { maxTurns } : {}),
    ...(Number.isInteger(maxAttemptsPerCriterion) ? { maxAttemptsPerCriterion } : {}),
  });
  const state = serialiseMasterySession(started.session, sourceId, started.session.objectives);
  state.courseId = courseId;
  state.releaseId = approved.releaseId;
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'MASTERY_SESSION',
    status: 'ACTIVE',
    payload: { ...state, citations: sourceCitationPages(source) },
  });
  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      sourceId,
      releaseId: approved.releaseId,
      ...masteryView(started.session),
    },
  };
}

export async function masteryTurn(identity, { params, body }) {
  const record = await ownedSession(identity, params.id);
  const state = recordPayload(record);
  if (typeof state.courseId !== 'string' || !state.courseId.trim()) {
    throw notFound('Mastery session has no course relationship');
  }
  const approved = await approvedCourseFor(identity, state.courseId, state.sourceId, state.releaseId);
  const course = approved.course;
  const source = await sourceFor(identity, state.sourceId, { approvedOnly: true });
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  const plan = planFromCourse(course);
  let approvedCriteria;
  if (state.masteryPlanRevision) {
    if (
      !plan ||
      plan.status !== 'APPROVED' ||
      plan.revision !== state.masteryPlanRevision ||
      plan.sourceId !== state.sourceId
    ) {
      throw masteryPlanError(
        'The approved mastery plan changed; this session cannot continue.',
        'CONFLICT',
        409,
      );
    }
    const validation = validateMasteryPlan(plan, {
      sourceId: state.sourceId,
      sourceText: sourceText(source),
    });
    if (!validation.valid) {
      throw masteryPlanError(
        'The approved mastery plan is no longer valid.',
        'MASTERY_PLAN_INVALID',
        422,
      );
    }
    approvedCriteria = validation.criteria;
  }
  const session = await restoreMasterySession(
    state,
    approvedCriteria ? { approvedCriteria, masteryPlan: plan } : {},
  );
  const answer = body?.answer;
  const result = await answerMasterySession(session, answer);
  const nextState = serialiseMasterySession(session, state.sourceId, state.objectives);
  nextState.courseId = state.courseId;
  nextState.releaseId = approved.releaseId;
  if (state.masteryPlanRevision) nextState.masteryPlanRevision = state.masteryPlanRevision;
  const status = result.complete ? 'COMPLETE' : 'ACTIVE';
  nextState.version = expectedVersion + 1;
  const committed = await updateLearningRecordIfVersion(record.id, expectedVersion, {
    status,
    payload: { ...nextState, citations: sourceCitationPages(source) },
  });
  if (!committed) {
    const error = new Error(
      'This mastery session changed while the answer was being graded; retry with the latest state.',
    );
    error.code = 'CONFLICT';
    throw error;
  }
  await createLearningRecord({
    ownerId: identity.id,
    type: 'MASTERY_ATTEMPT',
    status: 'RECORDED',
    payload: {
      sessionId: record.id,
      courseId: state.courseId,
      releaseId: approved.releaseId,
      sourceId: state.sourceId,
      question: state.currentQuestion,
      answer,
      result,
      // Conversational mastery does not establish a correct/incorrect
      // pre/post assessment. Sextant must not receive invented fields.
      criteria: nextState.criteria,
      report: nextState.report,
      transcript: session.transcript,
      citations: sourceCitationPages(source),
    },
  });
  return {
    json: {
      id: record.id,
      status,
      result: {
        verdict: result.verdict,
        feedback: result.feedback,
        nextQuestion: result.nextQuestion,
        score: result.score,
        complete: result.complete,
        stalled: result.stalled,
      },
      ...masteryView(session),
    },
  };
}

/* ----------------------- editing and removing records ---------------------- */

/*
 * Rename and remove for sources, rubrics and courses -- the row actions the
 * instructor library previously had no way to perform at all.
 *
 * Two rules shape all of this:
 *
 *   Renaming is the only editing offered. Source text and generated course
 *   content are deliberately not free-text editable: #78 retired the manual
 *   editors, and content changes go through the grounded AI revision flow so
 *   every lesson keeps its citation. A label is metadata, so it is safe.
 *
 *   Deleting never destroys evidence. A typed Course cascades to Section ->
 *   Item -> Attempt/Schedule, so dropping a delivered course would silently
 *   erase learner work. Anything a learner has touched is archived instead,
 *   and anything still referenced by something else refuses with the reason.
 */

const ARCHIVED_STATUS = 'ARCHIVED';

function recordConflict(message, code = 'CONFLICT') {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

function renamedTitle(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    const error = new TypeError('A title is required.');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (title.length > 200) {
    const error = new TypeError('That title is too long.');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return title;
}

async function ownedRecordOfType(identity, id, type, label) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== type || record.ownerId !== identity.id) {
    throw notFound(label + ' not found');
  }
  return record;
}

/** Course drafts that still name this source in their grounding set. */
async function coursesUsingSource(sourceId) {
  const records = await listLearningRecords({ type: 'COURSE_DRAFT' });
  return records.filter((record) => {
    const ids = recordPayload(record).sourceIds;
    return Array.isArray(ids) && ids.includes(sourceId);
  });
}

export async function renameSource(identity, { params, body }) {
  const record = await ownedRecordOfType(identity, params.id, 'SOURCE', 'Source');
  const title = renamedTitle(body);
  const payload = recordPayload(record);
  await updateLearningRecord(record.id, { payload: { ...payload, title } });
  // Deliberately not sourceSummary: that shape reads pages.length and
  // chunks.length, so a rename would depend on the whole ingest payload being
  // present. A rename only ever changes the label, so it answers with one.
  return { json: { id: record.id, status: record.status, title, sourceId: payload.sourceId } };
}

export async function deleteSource(identity, { params }) {
  const record = await ownedRecordOfType(identity, params.id, 'SOURCE', 'Source');
  // A source is the grounding behind every citation drawn from it. Removing one
  // a course still cites would leave lessons pointing at nothing, so refuse and
  // name the courses instead of quietly breaking provenance.
  const users = await coursesUsingSource(record.id);
  if (users.length) {
    const names = users.map((c) => recordPayload(c).title || c.id).slice(0, 5);
    const more = users.length > names.length ? ', and others' : '';
    throw recordConflict(
      'This source is still used by ' + users.length + ' course'
      + (users.length === 1 ? '' : 's') + ' (' + names.join(', ') + more
      + '). Remove it from those courses first.',
      'SOURCE_IN_USE',
    );
  }
  // The original bytes live in a separate SOURCE_PDF row (lib/source/library.js)
  // keyed off this record, so they have to go with it. Leaving it behind would
  // strand up to 10 MiB of base64 per source with nothing able to reach it.
  // sourcePdfMap selects ids only, so this never pulls the base64 into memory.
  const storedPdf = (await sourcePdfMap([record.id])).get(record.id);
  await deleteLearningRecords([record.id, ...(storedPdf ? [storedPdf.id] : [])]);
  return { json: { id: record.id, deleted: true } };
}

export async function renameRubric(identity, { params, body }) {
  const record = await ownedRubric(identity, params.id);
  const title = renamedTitle(body);
  await updateLearningRecord(record.id, { payload: { ...recordPayload(record), title } });
  return { json: { id: record.id, status: record.status, title } };
}

export async function deleteRubric(identity, { params }) {
  const record = await ownedRubric(identity, params.id);
  // A mastery session grades against the rubric it started with; dropping that
  // rubric would make a completed session unexplainable after the fact.
  const sessions = await listLearningRecords({ type: 'MASTERY_SESSION' });
  const inUse = sessions.filter((s) => recordPayload(s).rubricId === record.id);
  if (inUse.length) {
    throw recordConflict(
      'This rubric is in use by ' + inUse.length + ' mastery session'
      + (inUse.length === 1 ? '' : 's') + '. It cannot be removed while they exist.',
      'RUBRIC_IN_USE',
    );
  }
  await deleteLearningRecords([record.id]);
  return { json: { id: record.id, deleted: true } };
}

export async function renameCourse(identity, { params, body }) {
  const record = await ownedRecordOfType(identity, params.id, 'COURSE_DRAFT', 'Course');
  const title = renamedTitle(body);
  const payload = recordPayload(record);
  // The generated document carries its own title too; keep both in step so the
  // library and the reader cannot disagree about what the course is called.
  const course = payload.course && typeof payload.course === 'object'
    ? { ...payload.course, title }
    : null;
  await updateLearningRecord(record.id, {
    payload: { ...payload, title, ...(course ? { course } : {}) },
  });
  return { json: { id: record.id, status: record.status, title } };
}

/**
 * Remove a course, or archive it when learners have already worked in it.
 *
 * An unapproved draft has no delivery rows and nobody has seen it, so it goes
 * outright along with its revision history. An approved course is archived
 * unless it is provably untouched -- there is no undo for cascaded attempts, so
 * this refuses to offer a force flag at all.
 *
 * "Untouched" is whatever `courseEvidenceCount` can see, which is the whole
 * strength of the promise this makes: while it read only the typed Attempt and
 * Schedule tables it read zero for every generated course in the product,
 * because a learner's answer is recorded as a MASTERY_ATTEMPT record. Adding a
 * store a learner can write to without adding it there is how this silently
 * becomes a hard delete again.
 */
export async function deleteCourse(identity, { params, query }) {
  const record = await ownedRecordOfType(identity, params.id, 'COURSE_DRAFT', 'Course');
  const payload = recordPayload(record);
  const revisionIds = (Array.isArray(payload.revisionHistory) ? payload.revisionHistory : [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string');
  if (typeof payload.pendingRevisionId === 'string' && payload.pendingRevisionId.trim()) {
    revisionIds.push(payload.pendingRevisionId.trim());
  }

  if (record.status !== 'APPROVED') {
    await deleteLearningRecords([record.id, ...revisionIds]);
    return { json: { id: record.id, deleted: true, archived: false } };
  }

  const releaseIds = approvedReleaseIds(record);
  const counts = await Promise.all(releaseIds.map((id) => courseEvidenceCount(id)));
  const attempts = counts.reduce((total, c) => total + c.attempts, 0);
  const schedules = counts.reduce((total, c) => total + c.schedules, 0);
  // Answers a learner recorded against this release. They are where an answer
  // to a generated course's check actually lands, and nothing in the product
  // writes the typed Attempt table, so before this was counted every course
  // looked untouched and the archive promise could not be kept. Defaulted
  // rather than assumed, so an evidence store that does not report it counts as
  // zero instead of NaN.
  const recorded = counts.reduce((total, c) => total + (c.recorded || 0), 0);
  const evidence = attempts + schedules + recorded;
  const archiveOnly = query?.archive === '1' || query?.archive === 'true';
  const permanent = query?.permanent === '1' || query?.permanent === 'true';

  // Permanent removal is a second, separate decision. It is never what a first
  // click does: the caller has to come back having been told the counts, and
  // echo the exact title. That confirmation is checked here rather than only in
  // the UI, so a stray scripted DELETE cannot cascade away learner work.
  if (permanent && evidence > 0) {
    const confirmation = typeof query?.confirm === 'string' ? query.confirm.trim() : '';
    const title = (payload.title || payload.course?.title || '').trim();
    if (!title || confirmation !== title) {
      throw recordConflict(
        'Permanent removal needs the exact course title as confirmation. This destroys '
        + attempts + ' learner attempt' + (attempts === 1 ? '' : 's') + ' and '
        + schedules + ' scheduled item' + (schedules === 1 ? '' : 's') + '.'
        // Said separately because it is a different fate. Recorded answers are
        // LearningRecords, so they are not cascaded -- but every read that
        // surfaces them starts from the approved course record this is about to
        // remove, so they survive unreachable. Calling that "destroyed" would
        // overstate it and calling it nothing would understate it.
        + (recorded
          ? ' It also leaves ' + recorded + ' recorded answer' + (recorded === 1 ? '' : 's')
            + ' with no course to read them back from.'
          : ''),
        'CONFIRMATION_REQUIRED',
      );
    }
    await deleteLearningRecords([record.id, ...revisionIds], { courseIds: releaseIds });
    return {
      json: {
        id: record.id,
        deleted: true,
        archived: false,
        permanent: true,
        destroyed: { attempts, schedules },
        ...(recorded ? { orphaned: { recorded } } : {}),
      },
    };
  }

  if (evidence > 0 || archiveOnly) {
    await updateLearningRecord(record.id, { status: ARCHIVED_STATUS });
    return {
      json: {
        id: record.id,
        deleted: false,
        archived: true,
        // The counts come back so the caller can offer permanent removal
        // truthfully, naming what it would destroy instead of asking for a
        // blind confirmation.
        evidence: { attempts, schedules, recorded, total: evidence },
        canDeletePermanently: evidence > 0,
        reason: evidence > 0
          ? 'Archived rather than deleted: learners have ' + evidence
            + ' recorded attempt or scheduled item in this course. Their work is kept.'
          : 'Archived on request. Learner work is kept.',
      },
    };
  }

  await deleteLearningRecords([record.id, ...revisionIds], { courseIds: releaseIds });
  return { json: { id: record.id, deleted: true, archived: false } };
}
