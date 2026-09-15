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
  draftCourse,
  generateRubric,
  ingestSource,
  learningModelStatus,
  masteryView,
  redactCourse,
  restoreMasterySession,
  serialiseMasterySession,
  startMasterySession,
  tutorAnswer,
} from '../arsenal-core.js';
import { authReadiness } from '../auth.js';
import {
  createLearningRecord,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecord,
  updateLearningRecordIfVersion,
} from '../db.js';
import { notFound } from './http.js';

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

function sourcePassages(record) {
  const payload = recordPayload(record);
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
  if (chunks.length) {
    return chunks.map((chunk) => ({
      text: chunk.text,
      // The record id is the authenticated page-opening key. Keep the
      // human-readable source id alongside it without making it authoritative.
      source: `${record.id} p.${chunk.page || 1}`,
      sourceId: payload.sourceId || null,
    }));
  }
  return (payload.pages || []).map((page) => ({
    text: page.text,
    source: `${record.id} p.${page.page || 1}`,
    sourceId: payload.sourceId || null,
  }));
}

function sourceCitationPages(record) {
  return (recordPayload(record).pages || []).map((page) => ({
    source: record.id,
    sourceId: recordPayload(record).sourceId || null,
    page: page.page,
  }));
}

async function ownedCourse(identity, courseId, message = 'Course not found') {
  const record = await getLearningRecord(courseId);
  if (!record || record.type !== 'COURSE_DRAFT' || record.ownerId !== identity.id) {
    throw notFound(message);
  }
  return record;
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
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('file is required');
  const quarry = await new Function('specifier', 'return import(specifier)')('quarry/pdf');
  const parsed = await quarry.pdfText(new Uint8Array(await file.arrayBuffer()));
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
          (identity.role === INSTRUCTOR && record.ownerId === identity.id),
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
    approvedOnly: identity.role === LEARNER,
  });
  const payload = { ...recordPayload(record) };
  delete payload.ownerId;
  return { json: { id: record.id, status: record.status, ...payload } };
}

export async function approveSource(identity, { params }) {
  const record = await sourceFor(identity, params.id);
  if (record.ownerId !== identity.id) throw notFound('Source not found');
  const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
  return { json: { id: updated.id, status: updated.status } };
}

/* ---------------- courses ---------------- */

export async function draftCourseRecord(identity, { body }) {
  const { title, objectives, sourceIds, diagrams = false } = body || {};
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new TypeError('sourceIds must be a non-empty array');
  }
  const sources = await Promise.all(sourceIds.map((id) => sourceFor(identity, id)));
  const documents = sources.map((source) => ({
    text: recordPayload(source).text,
    source: recordPayload(source).sourceId || recordPayload(source).title,
  }));
  const course = await draftCourse({ title, objectives, documents, diagrams });
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'COURSE_DRAFT',
    status: 'PENDING',
    payload: { ...course, sourceIds, objectives, title },
  });
  return {
    status: 201,
    json: {
      id: record.id,
      status: record.status,
      title: course.title || title,
      sections: course.sections?.length || 0,
      sourceIds,
    },
  };
}

export async function listCourses(identity) {
  const records = await listLearningRecords({ type: 'COURSE_DRAFT' });
  return {
    json: records
      .filter(
        (record) =>
          record.status === 'APPROVED' ||
          (identity.role === INSTRUCTOR && record.ownerId === identity.id),
      )
      .map((record) => ({
        id: record.id,
        status: record.status,
        title: recordPayload(record).title || recordPayload(record).course?.title,
        sections: recordPayload(record).sections?.length || 0,
        ...(identity.role === INSTRUCTOR && record.ownerId === identity.id
          ? { sourceIds: recordPayload(record).sourceIds || [] }
          : {}),
      })),
  };
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
  const course =
    identity.role === LEARNER ? redactCourse(recordPayload(record)) : recordPayload(record);
  return { json: { id: record.id, status: record.status, course } };
}

export async function approveCourse(identity, { params }) {
  const record = await ownedCourse(identity, params.id);
  const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
  return { json: { id: updated.id, status: updated.status } };
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
    sourceIds.map((id) => sourceFor(identity, id, { approvedOnly: identity.role === LEARNER })),
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

function savedMasteryView(record) {
  const state = recordPayload(record);
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    courseId: state.courseId,
    sourceId: state.sourceId,
    report: state.report || null,
    currentQuestion: state.complete ? null : state.currentQuestion,
    criteria: (state.report?.criteria || []).map(({ elo, verdict }) => ({ elo, verdict })),
    transcript: state.transcript || [],
    citations: state.citations || [],
  };
}

async function approvedCourseFor(identity, courseId, sourceId) {
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
  return course;
}

export async function listMasterySessions(identity, { query }) {
  const records = await listLearningRecords({ ownerId: identity.id, type: 'MASTERY_SESSION' });
  return {
    json: records
      .filter((record) => !query.courseId || recordPayload(record).courseId === query.courseId)
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
  const { sourceId, courseId, objectives, maxTurns, maxAttemptsPerCriterion } = body || {};
  if (typeof courseId !== 'string' || !courseId.trim()) throw new TypeError('courseId is required');
  await approvedCourseFor(identity, courseId, sourceId);
  const source = await sourceFor(identity, sourceId, { approvedOnly: true });
  const payload = recordPayload(source);
  const taskTitles = (payload.tasks || []).map((task) => task.title).filter(Boolean);
  const fallbackObjectives = taskTitles.length ? taskTitles : payload.title;
  const resolvedObjectives = objectives === undefined ? fallbackObjectives : objectives;
  const started = await startMasterySession({
    objectives: resolvedObjectives,
    source: payload.text,
    ...(Number.isInteger(maxTurns) ? { maxTurns } : {}),
    ...(Number.isInteger(maxAttemptsPerCriterion) ? { maxAttemptsPerCriterion } : {}),
  });
  const state = serialiseMasterySession(started.session, sourceId, started.session.objectives);
  state.courseId = courseId;
  const record = await createLearningRecord({
    ownerId: identity.id,
    type: 'MASTERY_SESSION',
    status: 'ACTIVE',
    payload: { ...state, citations: sourceCitationPages(source) },
  });
  return {
    status: 201,
    json: { id: record.id, status: record.status, sourceId, ...masteryView(started.session) },
  };
}

export async function masteryTurn(identity, { params, body }) {
  const record = await ownedSession(identity, params.id);
  const state = recordPayload(record);
  if (typeof state.courseId !== 'string' || !state.courseId.trim()) {
    throw notFound('Mastery session has no course relationship');
  }
  await approvedCourseFor(identity, state.courseId, state.sourceId);
  const source = await sourceFor(identity, state.sourceId, { approvedOnly: true });
  const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
  const session = await restoreMasterySession(state);
  const answer = body?.answer;
  const result = await answerMasterySession(session, answer);
  const nextState = serialiseMasterySession(session, state.sourceId, state.objectives);
  nextState.courseId = state.courseId;
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
