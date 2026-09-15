import { Router } from 'express';
import multer from 'multer';
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
} from '../lib/arsenal-core.js';
import { currentIdentity, requireAnyRole, requireRole } from '../lib/auth.js';
import { authReadiness } from '../lib/auth-boundary.js';
import {
  createLearningRecord,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecord,
  updateLearningRecordIfVersion,
} from '../lib/db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const instructorOnly = requireRole('INSTRUCTOR');
const authenticated = requireAnyRole('LEARNER', 'INSTRUCTOR');

function sendError(res, error) {
  const code = error?.code || 'ERROR';
  const status =
    code === 'BAD_REQUEST' || error instanceof TypeError
      ? 400
      : code === 'AUTH_REQUIRED'
        ? 401
        : code === 'FORBIDDEN'
          ? 403
          : code === 'NOT_FOUND'
            ? 404
            : code === 'NO_PROVIDER' ||
                code === 'MODEL_UNAVAILABLE' ||
                code === 'MODEL_BAD_RESPONSE' ||
                code === 'NO_RUBRICON' ||
                code === 'RUBRICON_UNAVAILABLE' ||
                code === 'NO_WHETSTONE' ||
                code === 'WHETSTONE_UNAVAILABLE' ||
                code === 'ARSENAL_UNAVAILABLE' ||
                code === 'NO_DOCTRINE_SERVICE' ||
                code === 'AUTH_UNAVAILABLE'
              ? 503
              : code === 'RUBRIC_NOT_APPROVABLE'
                ? 409
              : code === 'CONFLICT'
                ? 409
              : 500;
  res.status(status).json({ error: error?.message || 'Request failed', code });
}

function notFound(message) {
  const error = new Error(message || 'Learning record not found');
  error.code = 'NOT_FOUND';
  return error;
}

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

router.get('/status', (_req, res) => {
  res.json({
    auth: authReadiness(),
    persistence: {
      provider: 'prisma-postgresql',
      learningRecord: true,
      destructiveMigrationPerformed: false,
    },
    arsenal: learningModelStatus(),
  });
});

router.post('/sources', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const payload = await ingestSource(req.body || {});
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'SOURCE',
      status: 'PENDING',
      payload,
    });
    res.status(201).json({
      id: record.id,
      status: record.status,
      title: payload.title,
      sourceId: payload.sourceId,
      pages: payload.pages.length,
      chunks: payload.chunks.length,
      tasks: payload.tasks.length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Existing PDF upload remains a parse seam; this route adds Quarry page
// persistence without replacing the legacy /api/ingest response.
router.post('/sources/pdf', ...instructorOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) throw new TypeError('file is required');
    const identity = currentIdentity(req);
    const quarry = await new Function(
      'specifier',
      'return import(specifier)',
    )('quarry/pdf');
    const parsed = await quarry.pdfText(new Uint8Array(req.file.buffer));
    const payload = await ingestSource(
      {
        title: String(req.body?.title || req.file.originalname || 'Uploaded source'),
        sourceId: req.body?.sourceId || req.file.originalname,
        text: parsed.text,
        pages: parsed.pageTexts.map((text, index) => ({ page: index + 1, text })),
      },
    );
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'SOURCE',
      status: 'PENDING',
      payload,
    });
    res.status(201).json({
      id: record.id,
      status: record.status,
      title: payload.title,
      sourceId: payload.sourceId,
      pages: payload.pages.length,
      chunks: payload.chunks.length,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/sources', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const records = await listLearningRecords({ type: 'SOURCE' });
    res.json(
      records
        .filter(
          (record) =>
            record.status === 'APPROVED' ||
            (identity.role === 'INSTRUCTOR' && record.ownerId === identity.id),
        )
        .map((record) => ({
          id: record.id,
          status: record.status,
          title: recordPayload(record).title,
          sourceId: recordPayload(record).sourceId,
          pages: recordPayload(record).pages?.length || 0,
        })),
    );
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/sources/:id', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await sourceFor(identity, req.params.id, {
      approvedOnly: identity.role === 'LEARNER',
    });
    const payload =
      identity.role === 'LEARNER'
        ? { ...recordPayload(record), ownerId: undefined }
        : recordPayload(record);
    delete payload.ownerId;
    res.json({ id: record.id, status: record.status, ...payload });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/sources/:id/approve', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await sourceFor(identity, req.params.id);
    if (record.ownerId !== identity.id) throw notFound('Source not found');
    const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/courses/draft', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const { title, objectives, sourceIds, diagrams = false } = req.body || {};
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new TypeError('sourceIds must be a non-empty array');
    }
    const sources = await Promise.all(
      sourceIds.map((id) => sourceFor(identity, id)),
    );
    const documents = sources.map((source) => ({
      text: recordPayload(source).text,
      source: recordPayload(source).sourceId || recordPayload(source).title,
    }));
    const course = await draftCourse(
      { title, objectives, documents, diagrams },
    );
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'COURSE_DRAFT',
      status: 'PENDING',
      payload: { ...course, sourceIds, objectives, title },
    });
    res.status(201).json({
      id: record.id,
      status: record.status,
      title: course.title || title,
      sections: course.sections?.length || 0,
      sourceIds,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/courses', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const records = await listLearningRecords({ type: 'COURSE_DRAFT' });
    res.json(
      records
        .filter(
          (record) =>
            record.status === 'APPROVED' ||
            (identity.role === 'INSTRUCTOR' && record.ownerId === identity.id),
        )
        .map((record) => ({
          id: record.id,
          status: record.status,
          title: recordPayload(record).title || recordPayload(record).course?.title,
          sections: recordPayload(record).sections?.length || 0,
          ...(identity.role === 'INSTRUCTOR' && record.ownerId === identity.id
            ? { sourceIds: recordPayload(record).sourceIds || [] }
            : {}),
        })),
    );
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/courses/:id', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (
      !record ||
      record.type !== 'COURSE_DRAFT' ||
      (record.status !== 'APPROVED' && record.ownerId !== identity.id)
    ) {
      throw notFound('Course not found');
    }
    const course =
      identity.role === 'LEARNER' ? redactCourse(recordPayload(record)) : recordPayload(record);
    res.json({ id: record.id, status: record.status, course });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/courses/:id/approve', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (!record || record.type !== 'COURSE_DRAFT' || record.ownerId !== identity.id) {
      throw notFound('Course not found');
    }
    const updated = await updateLearningRecord(record.id, { status: 'APPROVED' });
    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/courses/:id/syllabus', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (!record || record.type !== 'COURSE_DRAFT' || record.ownerId !== identity.id) {
      throw notFound('Course not found');
    }
    if (!Array.isArray(req.body?.syllabus) || req.body.syllabus.length === 0) {
      throw new TypeError('syllabus must be a non-empty array');
    }
    for (const [index, item] of req.body.syllabus.entries()) {
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
        syllabus: req.body.syllabus,
        ...(req.body.asOf ? { asOf: req.body.asOf } : {}),
        ...(req.body.availability !== undefined
          ? { availability: req.body.availability }
          : {}),
        ...(req.body.status ? { studyStatus: req.body.status } : {}),
      },
    });
    res.json({
      id: updated.id,
      status: updated.status,
      syllabus: req.body.syllabus,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Instructor authoring seam consumed by Hotwash. Critiques are persisted
// before the AAR route runs; no request may submit an ephemeral-only report.
router.post('/aar/critiques', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const courseId = req.body?.courseId;
    if (typeof courseId !== 'string' || !courseId.trim()) {
      throw new TypeError('courseId is required');
    }
    if (!Array.isArray(req.body?.critiques) || req.body.critiques.length === 0) {
      throw new TypeError('critiques must be a non-empty array');
    }
    for (const [index, critique] of req.body.critiques.entries()) {
      if (!critique || typeof critique !== 'object' || Array.isArray(critique)) {
        throw new TypeError(`critiques[${index}] must be an object`);
      }
      const area = critique.area ?? critique.topic ?? critique.lesson ?? critique.module;
      if (typeof area !== 'string' || !area.trim()) {
        throw new TypeError(`critiques[${index}] requires area`);
      }
      if (
        critique.kind !== undefined &&
        critique.kind !== 'sustain' &&
        critique.kind !== 'improve'
      ) {
        throw new TypeError(`critiques[${index}].kind must be sustain or improve`);
      }
      if (critique.severity !== undefined) {
        if (typeof critique.severity === 'string' && !critique.severity.trim()) {
          throw new TypeError(`critiques[${index}].severity must be between 1 and 5`);
        }
        const severity =
          typeof critique.severity === 'string'
            ? Number(critique.severity.trim())
            : critique.severity;
        if (!Number.isFinite(severity) || severity < 1 || severity > 5) {
          throw new TypeError(`critiques[${index}].severity must be between 1 and 5`);
        }
      }
      if (critique.weight !== undefined) {
        if (typeof critique.weight === 'string' && !critique.weight.trim()) {
          throw new TypeError(`critiques[${index}].weight must be finite and non-negative`);
        }
        const weight =
          typeof critique.weight === 'string'
            ? Number(critique.weight.trim())
            : critique.weight;
        if (!Number.isFinite(weight) || weight < 0) {
          throw new TypeError(`critiques[${index}].weight must be finite and non-negative`);
        }
      }
    }
    const course = await getLearningRecord(courseId);
    if (
      !course ||
      course.type !== 'COURSE_DRAFT' ||
      course.ownerId !== identity.id
    ) {
      throw notFound('Course not found');
    }
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'CRITIQUE_SET',
      status: 'RECORDED',
      payload: {
        courseId,
        courseTitle: recordPayload(course).title || recordPayload(course).course?.title,
        critiques: req.body.critiques,
      },
    });
    res.status(201).json({
      id: record.id,
      courseId,
      critiques: req.body.critiques.length,
      persisted: true,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// Instructor authoring seam consumed by the separate Understudy fidelity
// benchmark. Doctrine is selected from approved persisted sources, never
// copied from a request body.
router.post('/fidelity/cases', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const { courseId, sourceIds, persona, cases } = req.body || {};
    if (typeof courseId !== 'string' || !courseId.trim()) {
      throw new TypeError('courseId is required');
    }
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new TypeError('sourceIds must be a non-empty array');
    }
    if (typeof persona !== 'string' || !persona.trim()) {
      throw new TypeError('persona is required');
    }
    if (!Array.isArray(cases) || cases.length === 0) {
      throw new TypeError('cases must be a non-empty array');
    }
    const course = await getLearningRecord(courseId);
    if (
      !course ||
      course.type !== 'COURSE_DRAFT' ||
      course.ownerId !== identity.id
    ) {
      throw notFound('Course not found');
    }
    const sources = await Promise.all(
      sourceIds.map((id) => sourceFor(identity, id)),
    );
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
        ...(req.body.k !== undefined ? { k: req.body.k } : {}),
        ...(req.body.strict !== undefined ? { strict: Boolean(req.body.strict) } : {}),
        ...(req.body.groundingThreshold !== undefined
          ? { groundingThreshold: req.body.groundingThreshold }
          : {}),
      },
    });
    res.status(201).json({
      id: record.id,
      courseId,
      sourceIds,
      cases: cases.length,
      persisted: true,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/rubrics/generate', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const { task, sourceId } = req.body || {};
    const source = await sourceFor(identity, sourceId);
    const result = await generateRubric({
      task,
      sourceText: recordPayload(source).text,
    });
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'RUBRIC',
      status: 'PENDING',
      payload: { ...result, sourceId },
    });
    res.status(201).json({
      id: record.id,
      status: record.status,
      validation: result.validation,
      traceability: result.traceability,
      rubric: result.rubric,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/rubrics/:id', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (!record || record.type !== 'RUBRIC' || record.ownerId !== identity.id) {
      throw notFound('Rubric not found');
    }
    res.json({ id: record.id, status: record.status, ...recordPayload(record) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/rubrics/:id/approve', ...instructorOnly, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (!record || record.type !== 'RUBRIC' || record.ownerId !== identity.id) {
      throw notFound('Rubric not found');
    }
    const payload = recordPayload(record);
    const validation = payload.validation;
    const traceability = payload.traceability;
    const rubric = payload.rubric;
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
    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/tutor', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const { question, sourceIds, history = [], minScore } = req.body || {};
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new TypeError('sourceIds must be a non-empty array');
    }
    const sources = await Promise.all(
      sourceIds.map((id) =>
        sourceFor(identity, id, { approvedOnly: identity.role === 'LEARNER' }),
      ),
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
    res.json({
      id: record.id,
      answer: result.answer,
      refused: Boolean(result.refused),
      reason: result.reason || null,
      citations: result.citations || [],
      faithfulness: result.faithfulness || null,
    });
  } catch (error) {
    sendError(res, error);
  }
});

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

router.get('/mastery/sessions', ...authenticated, async (req, res) => {
  try {
    const records = await listLearningRecords({
      ownerId: currentIdentity(req).id,
      type: 'MASTERY_SESSION',
    });
    res.json(records
      .filter((record) => !req.query.courseId || recordPayload(record).courseId === req.query.courseId)
      .map(savedMasteryView));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/mastery/sessions/:id', ...authenticated, async (req, res) => {
  try {
    const record = await getLearningRecord(req.params.id);
    if (!record || record.type !== 'MASTERY_SESSION' || record.ownerId !== currentIdentity(req).id) {
      throw notFound('Mastery session not found');
    }
    res.json(savedMasteryView(record));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/mastery/sessions', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const { sourceId, courseId, objectives, maxTurns, maxAttemptsPerCriterion } =
      req.body || {};
    if (typeof courseId !== 'string' || !courseId.trim()) {
      throw new TypeError('courseId is required');
    }
    const course = await getLearningRecord(courseId);
    if (
      !course ||
      course.type !== 'COURSE_DRAFT' ||
      course.status !== 'APPROVED' ||
      (identity.role === 'INSTRUCTOR' && course.ownerId !== identity.id)
    ) {
      throw notFound('Approved course not found');
    }
    const courseSourceIds = recordPayload(course).sourceIds;
    if (!Array.isArray(courseSourceIds) || !courseSourceIds.includes(sourceId)) {
      throw notFound('Source is not part of the approved course');
    }
    const source = await sourceFor(identity, sourceId, { approvedOnly: true });
    const payload = recordPayload(source);
    const fallbackObjectives =
      payload.tasks?.map((task) => task.title).filter(Boolean).length
        ? payload.tasks.map((task) => task.title).filter(Boolean)
        : payload.title;
    const resolvedObjectives = objectives === undefined ? fallbackObjectives : objectives;
    const started = await startMasterySession({
      objectives: resolvedObjectives,
      source: payload.text,
      ...(Number.isInteger(maxTurns) ? { maxTurns } : {}),
      ...(Number.isInteger(maxAttemptsPerCriterion) ? { maxAttemptsPerCriterion } : {}),
    });
    const state = serialiseMasterySession(
      started.session,
      sourceId,
      started.session.objectives,
    );
    state.courseId = courseId;
    const record = await createLearningRecord({
      ownerId: identity.id,
      type: 'MASTERY_SESSION',
      status: 'ACTIVE',
      payload: { ...state, citations: sourceCitationPages(source) },
    });
    res.status(201).json({
      id: record.id,
      status: record.status,
      sourceId,
      ...masteryView(started.session),
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/mastery/sessions/:id/turn', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const record = await getLearningRecord(req.params.id);
    if (
      !record ||
      record.type !== 'MASTERY_SESSION' ||
      record.ownerId !== identity.id
    ) {
      throw notFound('Mastery session not found');
    }
    const state = recordPayload(record);
    if (typeof state.courseId !== 'string' || !state.courseId.trim()) {
      throw notFound('Mastery session has no course relationship');
    }
    const course = await getLearningRecord(state.courseId);
    if (
      !course ||
      course.type !== 'COURSE_DRAFT' ||
      course.status !== 'APPROVED' ||
      (identity.role === 'INSTRUCTOR' && course.ownerId !== identity.id) ||
      !Array.isArray(recordPayload(course).sourceIds) ||
      !recordPayload(course).sourceIds.includes(state.sourceId)
    ) {
      throw notFound('Approved course not found');
    }
    const source = await sourceFor(identity, state.sourceId, {
      approvedOnly: true,
    });
    const expectedVersion = Number.isInteger(record.version) ? record.version : 0;
    const session = await restoreMasterySession(state);
    const answer = req.body?.answer;
    const result = await answerMasterySession(session, answer);
    const nextState = serialiseMasterySession(
      session,
      state.sourceId,
      state.objectives,
    );
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
    res.json({
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
    });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;