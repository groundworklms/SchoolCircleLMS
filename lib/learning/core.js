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
  generateRubric,
  ingestSource,
  learningModelStatus,
  masteryView,
  redactCourse,
  restoreMasterySession,
  reviseCourseContent,
  serialiseMasterySession,
  startMasterySession,
  tutorAnswer,
  validateCourseDraft,
  validateMasteryPlan,
} from '../arsenal-core.js';
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
} from '../db.js';
import { notFound } from './http.js';
import { readPdfUpload } from '../pdf-upload.js';
import { selectedDeliveryId } from './delivery.js';
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

async function sourceFor(identity, id, { approvedOnly = false } = {}) {
  const record = await getLearningRecord(id);
  if (!record || record.type !== 'SOURCE') throw notFound('Source not found');
  if (approvedOnly && record.status !== 'APPROVED') throw notFound('Source not found');
  if (record.ownerId !== identity.id && record.status !== 'APPROVED') {
    throw notFound('Source not found');
  }
  return record;
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
      text: chunk.text,
      // The record id is the authenticated page-opening key. Keep the
      // human-readable source id alongside it without making it authoritative.
      source: `${record.id} p.${pageNumber(chunk.page, index)}`,
      sourceId: payload.sourceId || null,
    }));
  if (chunkPassages.length) return chunkPassages;
  return (payload.pages || [])
    .filter((page) => typeof page?.text === 'string' && page.text.trim())
    .map((page, index) => ({
      text: page.text,
      source: `${record.id} p.${pageNumber(page.page, index)}`,
      sourceId: payload.sourceId || null,
    }));
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

function sourceSummary(record, payload) {
  return {
    id: record.id,
    status: record.status,
    title: payload.title,
    sourceId: payload.sourceId,
    pages: payload.pages.length,
    chunks: payload.chunks.length,
  };
}

export async function createSource(identity, { body }) {
  const payload = await ingestSource(body || {});
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload,
  });
  return {
    status: 201,
    json: { ...sourceSummary(record, payload), tasks: payload.tasks.length },
  };
}

// The existing /api/ingest upload remains a parse-only seam; this persists a
// Quarry page-preserving source without replacing that response.
export async function createSourceFromPdf(identity, { body: form }) {
  const file = form?.get?.('file');
  const bytes = await readPdfUpload(file);
  const quarry = await new Function('specifier', 'return import(specifier)')('quarry/pdf');
  const parsed = await quarry.pdfText(bytes);
  const title = form.get('title');
  const sourceId = form.get('sourceId');
  const payload = await ingestSource({
    title: String(title || file.name || 'Uploaded source'),
    sourceId: sourceId || file.name,
    text: parsed.text,
    pages: parsed.pageTexts.map((text, index) => ({ page: index + 1, text })),
  });
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload,
  });
  return { status: 201, json: sourceSummary(record, payload) };
}

export async function listSources(identity) {
  const records = await listLearningRecords({ type: 'SOURCE' });
  return {
    json: records
      .filter(
        (record) =>
          record.status === 'APPROVED' ||
          (hasRole(identity.role, INSTRUCTOR) && record.ownerId === identity.id),
      )
      .map((record) => ({
        id: record.id,
        status: record.status,
        title: recordPayload(record).title,
        sourceId: recordPayload(record).sourceId,
        pages: recordPayload(record).pages?.length || 0,
      })),
  };
}

export async function getSource(identity, { params }) {
  const record = await sourceFor(identity, params.id, {
    approvedOnly: hasRole(identity.role, LEARNER) && !hasRole(identity.role, INSTRUCTOR),
  });
  const payload = { ...recordPayload(record) };
  delete payload.ownerId;
  return { json: { id: record.id, status: record.status, ...payload } };
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
  const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
  return { json: { id: updated.id, status: updated.status } };
}

/* ---------------- courses ---------------- */

export async function draftCourseRecord(identity, { body }) {
  const { title, objectives, sourceIds, diagrams = false } = body || {};
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
  const course = await draftCourse({ title, objectives, documents, diagrams });
  const normalizedCourse = normaliseCourseIds(course);
  const validation = validateCourseDraft(normalizedCourse, { sources });
  if (!validation.valid) {
    const error = new Error(`Course generation failed validation: ${validation.issues.join('; ')}`);
    error.code = 'COURSE_GENERATION_INVALID';
    error.status = 422;
    error.validation = validation;
    throw error;
  }
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'COURSE_DRAFT',
    status: 'PENDING',
    payload: {
      ...normalizedCourse,
      sourceIds: uniqueSourceIds,
      objectives: Array.isArray(normalizedCourse.objectives)
        ? normalizedCourse.objectives
        : objectives,
      title: normalizedCourse.title || title,
    },
  });
  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      version: Number.isInteger(record.version) ? record.version : 0,
      title: normalizedCourse.title || title,
      sections: normalizedCourse.sections?.length || 0,
      sourceIds: uniqueSourceIds,
    },
  };
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

export function learnerCourseProjection(course) {
  const fullCourse = course && typeof course === 'object' ? course : {};
  const projected = redactCourse(fullCourse);
  // Authoring metadata is not course content and must not reveal an
  // instructor's pending candidate or revision instructions to learners.
  delete projected.pendingRevisionId;
  delete projected.revisionHistory;
  delete projected.deliveryCourseId;
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

export async function getCourse(identity, { params }) {
  const record = await getLearningRecord(params.id);
  if (
    !record ||
    record.type !== 'COURSE_DRAFT' ||
    (record.status !== 'APPROVED' && record.ownerId !== identity.id)
  ) {
    throw notFound('Course not found');
  }
  const fullCourse = recordPayload(record);
  const canAuthor = hasRole(identity?.role, INSTRUCTOR) && record.ownerId === identity.id;
  const revision = canAuthor ? await pendingCourseRevision(record) : null;
  const pendingCourse = revision ? courseRevisionPayload(revision).course : null;
  const course = canAuthor
    ? pendingCourse || fullCourse
    : learnerCourseProjection(fullCourse);
  return {
    json: courseEnvelope(record, course, {
      owner: canAuthor,
      revision,
    }),
  };
}

/**
 * Generate the one shared rubric for a course. The course itself may still be
 * a draft; the selected source must already be approved and related to that
 * course. A plan is immutable after creation, so a second generation can
 * never silently fragment the competency labels.
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
  const committed = await approveCourseAtomically({
    courseId: record.id,
    ownerId: identity.id,
    expectedVersion,
    candidatePayload,
    sourceId,
    sections: candidatePayload.sections,
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
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'CRITIQUE_SET',
    status: 'RECORDED',
    payload: {
      courseId,
      courseTitle: recordPayload(course).title || recordPayload(course).course?.title,
      critiques: body.critiques,
    },
  });
  return {
    status: 201,
    json: { id: record.id, courseId, critiques: body.critiques.length, persisted: true },
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

export async function generateRubricRecord(identity, { body }) {
  const { task, sourceId } = body || {};
  const source = await sourceFor(identity, sourceId);
  const result = await generateRubric({ task, sourceText: recordPayload(source).text });
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'RUBRIC',
    status: 'PENDING',
    payload: { ...result, sourceId },
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

export async function tutor(identity, { body }) {
  const { question, sourceIds, history = [], minScore } = body || {};
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new TypeError('sourceIds must be a non-empty array');
  }
  const sources = await Promise.all(
    sourceIds.map((id) => sourceFor(identity, id, {
      approvedOnly: hasRole(identity.role, LEARNER) && !hasRole(identity.role, INSTRUCTOR),
    })),
  );
  const result = await tutorAnswer({
    question,
    passages: sources.flatMap(sourcePassages),
    history,
    ...(typeof minScore === 'number' ? { minScore } : {}),
  });
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'TUTOR_TURN',
    status: 'RECORDED',
    payload: {
      sourceIds,
      question,
      answer: result.answer,
      refused: Boolean(result.refused),
      reason: result.reason || null,
      citations: result.citations || [],
      history,
    },
  });
  return {
    json: {
      id: record.id,
      answer: result.answer,
      refused: Boolean(result.refused),
      reason: result.reason || null,
      citations: result.citations || [],
      faithfulness: result.faithfulness || null,
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
    transcript: state.transcript || [],
    citations: state.citations || [],
    ...(typeof state.masteryPlanRevision === 'string' && state.masteryPlanRevision.trim()
      ? { masteryPlanRevision: state.masteryPlanRevision }
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
