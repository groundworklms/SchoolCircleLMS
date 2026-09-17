import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const records = new Map();
let nextId = 1;
let draftGate = null;
let rubricGate = null;
let versionUpdateBarrier = null;

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function seedRecord({ ownerId, type, status = 'PENDING', payload, id = `memory-${nextId++}` }) {
  const now = new Date();
  const record = {
    id,
    ownerId,
    type,
    status,
    payload: clone(payload),
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
  records.set(id, record);
  return clone(record);
}

const dbAdapter = { sourcePdfTestAdapter: 'memory' };
const dbMock = {
  db: dbAdapter,
  async createLearningRecord(input) {
    return seedRecord(input);
  },
  async getLearningRecord(id) {
    return clone(records.get(id) || null);
  },
  async getLearningRecordsByIds(ids) {
    return new Map((ids || [])
      .map((id) => [id, clone(records.get(id) || null)])
      .filter(([, record]) => record));
  },
  async listLearningRecords({ ownerId, type, status } = {}) {
    return [...records.values()]
      .filter((record) => !ownerId || record.ownerId === ownerId)
      .filter((record) => !type || record.type === type)
      .filter((record) => !status || record.status === status)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(clone);
  },
  async updateLearningRecord(id, data) {
    const record = records.get(id);
    if (!record) throw new Error(`missing record ${id}`);
    Object.assign(record, data);
    record.updatedAt = new Date();
    return clone(record);
  },
  async updateLearningRecordIfVersion(id, version, data) {
    const barrier = versionUpdateBarrier;
    if (barrier && !barrier.released) {
      barrier.waiting += 1;
      if (barrier.waiting === 2) barrier.started();
      await barrier.promise;
    }
    const record = records.get(id);
    if (!record || record.version !== version) return false;
    Object.assign(record, data);
    record.version += 1;
    record.updatedAt = new Date();
    return true;
  },
  async deleteLearningRecords(ids) {
    let deleted = 0;
    for (const id of [...new Set(ids || [])]) {
      if (records.delete(id)) deleted += 1;
    }
    return { records: deleted, courses: 0 };
  },
  // Per-item ratification (#863f724) reaches Item rows through db.js. These
  // suites never exercise that path, so the seams answer empty rather than
  // the module failing to link.
  async listDeliveryCourseItems() { return []; },
  async getDeliveryCourseItem() { return null; },
  async updateDeliveryCourseItem() { return null; },
  async courseEvidenceCount() {
    return { attempts: 0, schedules: 0, total: 0 };
  },
  async createCourseRevisionAtomically() {
    throw new Error('not used in source library tests');
  },
  async approveCourseAtomically() {
    throw new Error('not used in source library tests');
  },
};

mock.module('../lib/db.js', { namedExports: dbMock });
mock.module('../lib/model-settings.js', {
  namedExports: { async primeModelSettings() {} },
});
mock.module('../lib/doctrine-settings.js', {
  namedExports: { async primeDoctrineSettings() {} },
});
mock.module('../lib/auth.js', {
  namedExports: {
    authReadiness: () => ({ ready: true }),
    hasRole(role, required) {
      return role === required || (role === 'BOTH' && ['INSTRUCTOR', 'LEARNER'].includes(required));
    },
    // lib/learning/http.js imports this, so the mock has to offer it or the
    // module fails to link and the suite reports one error with no assertion.
    // Same behaviour as the real one: an instructor asking for the learner view
    // keeps their id and drops to LEARNER; everyone else is unchanged.
    learnerScopedIdentity(identity) {
      if (!identity || !(identity.role === 'INSTRUCTOR' || identity.role === 'BOTH')) return identity;
      return { ...identity, role: 'LEARNER', learnerScoped: true };
    },
    async requireAnyRole(request, roles) {
      const role = request.headers.get('x-test-role') || 'LEARNER';
      if (!roles.some((required) => role === required || (role === 'BOTH' && ['INSTRUCTOR', 'LEARNER'].includes(required)))) {
        const error = new Error('Forbidden');
        error.code = 'FORBIDDEN';
        error.status = 403;
        throw error;
      }
      return {
        id: request.headers.get('x-test-user') || 'anonymous',
        role,
      };
    },
  },
});
mock.module('../lib/arsenal-core.js', {
  namedExports: {
    answerMasterySession: async () => null,
    sourcePassageIndex: () => null,
    masteryPlanProvenance: () => null,
    deriveMasteryPlan: async () => null,
    draftRubricTask: async () => ({ task: 'Generated task' }),
    draftCourse: async () => {
      if (draftGate) {
        const gate = draftGate;
        gate.started();
        await gate.promise;
        draftGate = null;
      }
      return { title: 'Generated course', objectives: [], sections: [] };
    },
    generateRubric: async () => {
      if (rubricGate) {
        const gate = rubricGate;
        gate.started();
        await gate.promise;
        rubricGate = null;
      }
      return {
        validation: { valid: true },
        traceability: { grounded: true, ungrounded: [] },
        rubric: { flagged: false, criteria: [] },
      };
    },
    ingestSource: async ({ title, sourceId, text, pages }) => ({
      title: String(title).trim(),
      sourceId: String(sourceId || title).trim(),
      text,
      pages,
      chunks: pages.map((page) => ({ ...page })),
      outline: [],
      sections: [],
      tasks: [],
    }),
    learningModelStatus: () => ({ model: { ready: false } }),
    masteryView: () => null,
    redactCourse: (course) => clone(course),
    restoreMasterySession: async () => null,
    reviseCourseContent: async () => null,
    serialiseMasterySession: () => null,
    startMasterySession: async () => null,
    tutorAnswer: async () => null,
    validateCourseDraft: () => ({ valid: true, issues: [] }),
    validateMasteryPlan: () => ({ valid: true, criteria: [] }),
  },
});

const core = await import('../lib/learning/core.js');
const sourceLibrary = await import('../lib/source/library.js');
const sourceCollectionRoute = await import('../app/api/learning/sources/route.js');
const sourceRoute = await import('../app/api/learning/sources/[id]/route.js');
const sourcePdfRoute = await import('../app/api/learning/sources/[id]/pdf/route.js');
const pdfUploadRoute = await import('../app/api/learning/sources/pdf/route.js');
const batchApproveRoute = await import('../app/api/learning/sources/approve/route.js');
const { errorStatus } = await import('../lib/learning/http.js');

const OWNER = { id: 'hermetic-owner', role: 'INSTRUCTOR' };
const OTHER_INSTRUCTOR = { id: 'hermetic-other', role: 'INSTRUCTOR' };
const LEARNER = { id: 'hermetic-learner', role: 'LEARNER' };

function makePdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length + 34} >>\nstream\nBT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output));
}

function headers(identity) {
  return { 'x-test-user': identity.id, 'x-test-role': identity.role };
}

async function jsonResponse(response) {
  return { status: response.status, body: await response.json() };
}

async function formRequest(url, identity, bytes, filename = 'original.pdf', fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(url, { method: 'POST', headers: headers(identity), body: form });
}

function jsonRequest(url, identity, body) {
  return new Request(url, {
    method: 'POST',
    headers: { ...headers(identity), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function statusOf(operation) {
  try {
    await operation();
    return 200;
  } catch (error) {
    return errorStatus(error);
  }
}

function modelGate() {
  let release;
  let started;
  const promise = new Promise((resolve) => { release = resolve; });
  const startedPromise = new Promise((resolve) => { started = resolve; });
  return {
    promise,
    startedPromise,
    started,
    release,
  };
}

test('source catalog uses targeted metadata-only PDF queries', async () => {
  const calls = [];
  dbAdapter.learningRecord = {
    async findUnique(args) {
      calls.push({ method: 'findUnique', args });
      return args.select ? null : {
        id: 'source-target:pdf',
        payload: { sourceRecordId: 'source-target', bytesBase64: 'not-loaded-by-catalog' },
      };
    },
    async findFirst(args) {
      calls.push({ method: 'findFirst', args });
      return { id: 'legacy-pdf-row' };
    },
  };
  try {
    const result = await sourceLibrary.sourcePdfMap(['source-target']);
    assert.equal(result.get('source-target').id, 'legacy-pdf-row');
    assert.ok(calls.every((call) => call.args.select?.id === true));
    assert.equal(calls.some((call) => call.args.select?.payload), false);
    assert.equal(
      calls.some((call) => call.args.where?.type && call.args.where.type !== 'SOURCE_PDF'),
      false,
    );
    const loaded = await sourceLibrary.sourcePdfFor('source-target');
    assert.equal(loaded.payload.bytesBase64, 'not-loaded-by-catalog');
  } finally {
    delete dbAdapter.learningRecord;
  }
});

test('concurrent approvals of one source resolve through a version CAS', async () => {
  const source = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload: {
      title: 'Concurrent source',
      sourceId: 'concurrent-source',
      text: 'Concurrent source text.',
      pages: [{ page: 1, text: 'Concurrent source text.' }],
    },
  });
  let release;
  let resolveStarted;
  const started = new Promise((resolve) => { resolveStarted = resolve; });
  const barrier = {
    waiting: 0,
    released: false,
    promise: new Promise((resolve) => { release = resolve; }),
    started: resolveStarted,
  };
  versionUpdateBarrier = barrier;
  const first = core.approveSource(OWNER, { params: { id: source.id } });
  const second = core.approveSource(OWNER, { params: { id: source.id } });
  await started;
  barrier.released = true;
  versionUpdateBarrier = null;
  release();
  const results = await Promise.allSettled([first, second]);
  const stored = await dbMock.getLearningRecord(source.id);
  assert.equal(stored.status, 'APPROVED');
  // Exactly one writer may win the CAS; the loser is told the source moved
  // rather than silently double-applying the transition.
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const loser = results.find((result) => result.status === 'rejected');
  assert.equal(loser.reason.code, 'SOURCE_TRANSITION_CONFLICT');
  assert.equal(stored.version, 1);
});

test('source guards reject deletion during course/rubric generation', async () => {
  const courseSource = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Course source',
      sourceId: 'course-source',
      text: 'Course source text.',
      pages: [{ page: 1, text: 'Course source text.' }],
    },
  });
  const courseGate = modelGate();
  draftGate = courseGate;
  const coursePromise = core.draftCourseRecord(OWNER, {
    body: { title: 'Guarded course', objectives: [], sourceIds: [courseSource.id] },
  });
  await courseGate.startedPromise;
  await core.deleteSource(OWNER, { params: { id: courseSource.id } });
  courseGate.release();
  await assert.rejects(coursePromise, (error) => error.code === 'SOURCE_GUARD_CONFLICT');
  assert.equal(
    (await dbMock.listLearningRecords({ type: 'COURSE_DRAFT' }))
      .some((record) => record.payload.title === 'Guarded course'),
    false,
  );

  const rubricSource = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    // generateRubricRecord now resolves the source approved-only: the screen
    // always offered approved sources alone, but the route used to accept any
    // source its owner could read. This test is about the deletion guard during
    // generation, so it needs a source generation will actually start from.
    status: 'APPROVED',
    payload: {
      title: 'Rubric source',
      sourceId: 'rubric-source',
      text: 'Rubric source text.',
      pages: [{ page: 1, text: 'Rubric source text.' }],
    },
  });
  const rubricGenerationGate = modelGate();
  rubricGate = rubricGenerationGate;
  const rubricPromise = core.generateRubricRecord(OWNER, {
    body: { task: 'Guarded rubric', sourceId: rubricSource.id },
  });
  await rubricGenerationGate.startedPromise;
  await core.deleteSource(OWNER, { params: { id: rubricSource.id } });
  rubricGenerationGate.release();
  await assert.rejects(rubricPromise, (error) => error.code === 'SOURCE_GUARD_CONFLICT');
  assert.equal(
    (await dbMock.listLearningRecords({ type: 'RUBRIC' }))
      .some((record) => record.payload.sourceId === rubricSource.id),
    false,
  );
});

test('source guard transaction rolls back version touches when record creation fails', async () => {
  const source = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: { title: 'Transactional source', text: 'Transactional text.' },
  });
  const originalTransaction = dbAdapter.$transaction;
  let failCreate = false;
  dbAdapter.$transaction = async (callback) => {
    const before = records.get(source.id).version;
    const tx = {
      learningRecord: {
        async updateMany({ where }) {
          const current = records.get(where.id);
          if (
            !current ||
            current.type !== where.type ||
            current.status !== where.status ||
            current.version !== where.version
          ) return { count: 0 };
          current.version += 1;
          return { count: 1 };
        },
        async create({ data }) {
          if (failCreate) throw new Error('simulated create failure');
          return dbMock.createLearningRecord(data);
        },
      },
    };
    try {
      return await callback(tx);
    } catch (error) {
      records.get(source.id).version = before;
      throw error;
    }
  };
  try {
    const created = await sourceLibrary.createRecordWithSourceGuards({
      ownerId: OWNER.id,
      type: 'COURSE_DRAFT',
      payload: { title: 'Transactional draft' },
      sources: [source],
    });
    assert.equal(created.type, 'COURSE_DRAFT');
    assert.equal((await dbMock.getLearningRecord(source.id)).version, 1);

    failCreate = true;
    const beforeFailure = await dbMock.getLearningRecord(source.id);
    await assert.rejects(
      sourceLibrary.createRecordWithSourceGuards({
        ownerId: OWNER.id,
        type: 'RUBRIC',
        payload: { sourceId: source.id },
        sources: [beforeFailure],
      }),
      /simulated create failure/,
    );
    assert.equal((await dbMock.getLearningRecord(source.id)).version, beforeFailure.version);
    assert.equal(
      (await dbMock.listLearningRecords({ type: 'RUBRIC' }))
        .some((record) => record.payload.sourceId === source.id),
      false,
    );
  } finally {
    if (originalTransaction === undefined) delete dbAdapter.$transaction;
    else dbAdapter.$transaction = originalTransaction;
  }
});

test('duplicate deterministic PDF attachment maps a unique conflict to 409', async () => {
  const source = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Duplicate PDF source',
      text: 'Duplicate PDF text.',
      pages: [{ page: 1, text: 'Duplicate PDF text.' }],
    },
  });
  const before = await dbMock.getLearningRecord(source.id);
  const originalTransaction = dbAdapter.$transaction;
  dbAdapter.$transaction = async (callback) => callback({
    learningRecord: {
      async findUnique() { return null; },
      async findFirst() { return null; },
      async create({ data }) {
        assert.equal(data.id, sourceLibrary.sourcePdfRecordId(source.id));
        const error = new Error('duplicate deterministic PDF id');
        error.code = 'P2002';
        throw error;
      },
    },
  });
  try {
    await assert.rejects(
      sourceLibrary.attachSourcePdf(source, {
        ownerId: OWNER.id,
        bytes: new TextEncoder().encode('%PDF-1.7\nduplicate'),
        file: { name: 'duplicate.pdf' },
        extractedPages: ['Duplicate PDF text.'],
      }),
      (error) => error.code === 'SOURCE_PDF_EXISTS' && error.status === 409,
    );
    const after = await dbMock.getLearningRecord(source.id);
    assert.equal(after.status, before.status);
    assert.deepEqual(after.payload, before.payload);
  } finally {
    if (originalTransaction === undefined) delete dbAdapter.$transaction;
    else dbAdapter.$transaction = originalTransaction;
  }
});

test('delete route enforces ownership, refuses a cited source, and takes its PDF with it', async () => {
  const source = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Removable source',
      sourceId: 'removable-1',
      text: 'Approved source text.',
      pages: [{ page: 1, text: 'Approved source text.' }],
      chunks: [{ page: 1, text: 'Approved source text.' }],
    },
  });
  const citingCourse = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
    payload: { title: 'Existing approved course', sourceIds: [source.id] },
  });
  const bytes = makePdf('Approved source text.');
  const storedPdf = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE_PDF',
    status: 'STORED',
    id: sourceLibrary.sourcePdfRecordId(source.id),
    payload: {
      sourceRecordId: source.id,
      filename: 'removable.pdf',
      bytesBase64: Buffer.from(bytes).toString('base64'),
    },
  });
  const pending = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload: {
      title: 'Pending private source',
      sourceId: 'pending-private',
      text: 'Private pending text.',
      pages: [{ page: 1, text: 'Private pending text.' }],
      chunks: [{ page: 1, text: 'Private pending text.' }],
    },
  });
  await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE_PDF',
    status: 'STORED',
    id: sourceLibrary.sourcePdfRecordId(pending.id),
    payload: {
      sourceRecordId: pending.id,
      filename: 'pending.pdf',
      bytesBase64: Buffer.from(makePdf('Private pending text.')).toString('base64'),
    },
  });

  // Another instructor is not the owner: the source is simply not there.
  const denied = await sourceRoute.DELETE(
    new Request(`http://localhost/api/learning/sources/${source.id}`, {
      method: 'DELETE',
      headers: headers(OTHER_INSTRUCTOR),
    }),
    { params: { id: source.id } },
  );
  assert.equal(denied.status, 404);

  const learnerDenied = await sourceRoute.DELETE(
    new Request(`http://localhost/api/learning/sources/${source.id}`, {
      method: 'DELETE',
      headers: headers(LEARNER),
    }),
    { params: { id: source.id } },
  );
  assert.equal(learnerDenied.status, 403);

  // The owner is refused too while a course still cites the source: provenance
  // wins over tidiness, and the refusal names the course.
  const inUse = await sourceRoute.DELETE(
    new Request(`http://localhost/api/learning/sources/${source.id}`, {
      method: 'DELETE',
      headers: headers(OWNER),
    }),
    { params: { id: source.id } },
  );
  assert.equal(inUse.status, 409);
  const inUseBody = await inUse.json();
  assert.equal(inUseBody.code, 'SOURCE_IN_USE');
  assert.match(inUseBody.error, /Existing approved course/);
  assert.ok(await dbMock.getLearningRecord(source.id));

  // Rename is the one edit a row action offers, and it only touches the label.
  const renamed = await sourceRoute.PATCH(
    new Request(`http://localhost/api/learning/sources/${source.id}`, {
      method: 'PATCH',
      headers: { ...headers(OWNER), 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed source' }),
    }),
    { params: { id: source.id } },
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).title, 'Renamed source');
  assert.equal((await dbMock.getLearningRecord(source.id)).payload.text, 'Approved source text.');

  // Drop the citation and the same request now succeeds, taking the stored
  // original with it rather than stranding megabytes of base64.
  await dbMock.updateLearningRecord(citingCourse.id, { payload: { title: 'Existing approved course', sourceIds: [] } });
  const removed = await sourceRoute.DELETE(
    new Request(`http://localhost/api/learning/sources/${source.id}`, {
      method: 'DELETE',
      headers: headers(OWNER),
    }),
    { params: { id: source.id } },
  );
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).deleted, true);
  assert.equal(await dbMock.getLearningRecord(source.id), null);
  assert.equal(await dbMock.getLearningRecord(storedPdf.id), null);
  assert.equal(await statusOf(() => core.getSource(LEARNER, { params: { id: source.id } })), 404);
  assert.equal(await statusOf(() => core.getSourcePdf(LEARNER, { params: { id: source.id } })), 404);

  // A pending source stays private to its owner throughout: not listed, not
  // readable, and its original is not downloadable.
  const listed = await core.listSources(LEARNER);
  assert.equal(listed.json.some((entry) => entry.id === source.id), false);
  assert.equal(listed.json.some((entry) => entry.id === pending.id), false);
  const collectionResponse = await sourceCollectionRoute.GET(
    new Request('http://localhost/api/learning/sources', { headers: headers(LEARNER) }),
  );
  assert.equal(collectionResponse.status, 200);
  assert.equal((await collectionResponse.json()).some((entry) => entry.id === pending.id), false);
  assert.equal(await statusOf(() => core.getSource(LEARNER, { params: { id: pending.id } })), 404);
  assert.equal(
    await statusOf(() => core.getSourcePdf(LEARNER, { params: { id: pending.id } })),
    404,
  );

  // The owner can still read their own pending original, with private headers.
  const ownerPdf = await sourcePdfRoute.GET(
    new Request(`http://localhost/api/learning/sources/${pending.id}/pdf`, { headers: headers(OWNER) }),
    { params: { id: pending.id } },
  );
  assert.equal(ownerPdf.status, 200);
  assert.equal(ownerPdf.headers.get('cache-control'), 'private, no-store');
  assert.match(ownerPdf.headers.get('content-disposition'), /^inline; filename="/);

  assert.equal(
    await statusOf(() => core.draftCourseRecord(OWNER, {
      body: { title: 'New draft', objectives: [], sourceIds: [source.id] },
    })),
    404,
  );
  assert.equal(
    await statusOf(() => core.generateRubricRecord(OWNER, {
      body: { task: 'New rubric', sourceId: source.id },
    })),
    404,
  );
});

test('source PDF ingest stores bytes, attach validates pages, and keeps metadata private', async () => {
  const bytes = makePdf('Original text');
  const uploadRequest = await formRequest(
    'http://localhost/api/learning/sources/pdf',
    OWNER,
    bytes,
    'unsafe name.pdf',
  );
  const uploadFile = (await uploadRequest.clone().formData()).get('file');
  assert.equal(uploadFile.size, bytes.length);
  const uploaded = await pdfUploadRoute.POST(uploadRequest);
  assert.equal(uploaded.status, 201);
  const uploadedBody = await uploaded.json();
  assert.equal(uploadedBody.hasPdf, true);
  assert.equal(JSON.stringify(uploadedBody).includes('JVBER'), false);
  const uploadedRecord = await dbMock.getLearningRecord(uploadedBody.id);
  assert.equal(uploadedRecord.status, 'PENDING');
  const storedPdf = (await dbMock.listLearningRecords({ type: 'SOURCE_PDF' }))
    .find((record) => record.payload.sourceRecordId === uploadedBody.id);
  assert.ok(storedPdf);
  assert.equal(storedPdf.payload.bytesBase64, Buffer.from(bytes).toString('base64'));

  const original = await sourcePdfRoute.GET(
    new Request(`http://localhost/api/learning/sources/${uploadedBody.id}/pdf`, {
      headers: headers(OWNER),
    }),
    { params: { id: uploadedBody.id } },
  );
  assert.deepEqual([...new Uint8Array(await original.arrayBuffer())], [...bytes]);
  const sourceView = await sourceRoute.GET(
    new Request(`http://localhost/api/learning/sources/${uploadedBody.id}`, {
      headers: headers(OWNER),
    }),
    { params: { id: uploadedBody.id } },
  );
  assert.equal(JSON.stringify(await sourceView.json()).includes('JVBER'), false);

  const legacy = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Legacy source',
      sourceId: 'legacy-attach',
      text: 'Original text',
      pages: [{ page: 1, text: 'Original text' }],
      chunks: [{ page: 1, text: 'Original text' }],
    },
  });
  const before = await dbMock.getLearningRecord(legacy.id);
  const attached = await sourcePdfRoute.POST(
    await formRequest(`http://localhost/api/learning/sources/${legacy.id}/pdf`, OWNER, bytes),
    { params: { id: legacy.id } },
  );
  assert.equal(attached.status, 200);
  assert.equal((await attached.json()).hasPdf, true);
  const after = await dbMock.getLearningRecord(legacy.id);
  assert.equal(after.status, before.status);
  assert.deepEqual(after.payload, before.payload);

  const mismatch = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Mismatched source',
      sourceId: 'legacy-mismatch',
      text: 'Different text',
      pages: [{ page: 1, text: 'Different text' }],
      chunks: [{ page: 1, text: 'Different text' }],
    },
  });
  const rejected = await sourcePdfRoute.POST(
    await formRequest(`http://localhost/api/learning/sources/${mismatch.id}/pdf`, OWNER, bytes),
    { params: { id: mismatch.id } },
  );
  const rejectedBody = await jsonResponse(rejected);
  assert.equal(rejectedBody.status, 409);
  assert.equal(rejectedBody.body.code, 'SOURCE_PDF_MISMATCH');
  assert.equal(
    (await dbMock.listLearningRecords({ type: 'SOURCE_PDF' }))
      .some((record) => record.payload.sourceRecordId === mismatch.id),
    false,
  );
});
test('a zipped upload carries its collection and a collection-scoped citation label', async () => {
  const bytes = makePdf('Lesson one');
  const uploaded = await pdfUploadRoute.POST(await formRequest(
    'http://localhost/api/learning/sources/pdf',
    OWNER,
    bytes,
    'lesson-01.pdf',
    { title: 'lesson-01', collection: '  Lesson   plans ' },
  ));
  assert.equal(uploaded.status, 201);
  const body = await uploaded.json();
  assert.equal(body.collection, 'Lesson plans');
  assert.equal(body.title, 'lesson-01');
  // Two collections can both hold a lesson-01.pdf; the default label keeps
  // their citations apart.
  assert.equal(body.sourceId, 'Lesson plans/lesson-01.pdf');
  const stored = await dbMock.getLearningRecord(body.id);
  assert.equal(stored.payload.collection, 'Lesson plans');

  // An explicit sourceId still wins, and an over-long collection reads as none.
  const plain = await pdfUploadRoute.POST(await formRequest(
    'http://localhost/api/learning/sources/pdf',
    OWNER,
    bytes,
    'lesson-01.pdf',
    { sourceId: 'FM-1', collection: 'x'.repeat(81) },
  ));
  const plainBody = await plain.json();
  assert.equal(plainBody.sourceId, 'FM-1');
  assert.equal(plainBody.collection, null);

  const text = await sourceCollectionRoute.POST(jsonRequest(
    'http://localhost/api/learning/sources',
    OWNER,
    { title: 'Pasted notes', text: 'Some text', pages: [{ page: 1, text: 'Some text' }], collection: 'Student material' },
  ));
  assert.equal(text.status, 201);
  assert.equal((await text.json()).collection, 'Student material');
  const listed = await core.listSources(OWNER);
  assert.ok(listed.json.some((item) => item.id === body.id && item.collection === 'Lesson plans'));
});

test('batch approval applies the single-source gate per id and reports partial failure', async () => {
  const good = await Promise.all([1, 2, 3].map((n) => dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload: {
      title: `Batch ${n}`,
      sourceId: `batch-${n}`,
      collection: 'Batch',
      text: `Text ${n}`,
      pages: [{ page: 1, text: `Text ${n}` }],
      chunks: [{ page: 1, text: `Text ${n}` }],
    },
  })));
  // A scanned PDF: pages exist but hold no text, so it is not approvable.
  const scanned = await dbMock.createLearningRecord({
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload: { title: 'Scanned', sourceId: 'scan', collection: 'Batch', text: '', pages: [{ page: 1, text: '' }], chunks: [] },
  });
  // Someone else's pending source: not found, never approved.
  const foreign = await dbMock.createLearningRecord({
    ownerId: OTHER_INSTRUCTOR.id,
    type: 'SOURCE',
    status: 'PENDING',
    payload: { title: 'Foreign', sourceId: 'foreign', text: 'Text', pages: [{ page: 1, text: 'Text' }], chunks: [] },
  });

  const response = await batchApproveRoute.POST(jsonRequest(
    'http://localhost/api/learning/sources/approve',
    OWNER,
    { ids: [...good.map((record) => record.id), good[0].id, scanned.id, foreign.id] },
  ));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(
    result.approved.map((item) => item.id).sort(),
    good.map((record) => record.id).sort(),
    'each owned, approvable id is approved exactly once',
  );
  assert.deepEqual(
    result.failed.map((item) => [item.id, item.code]).sort(),
    [[scanned.id, 'SOURCE_NOT_APPROVABLE'], [foreign.id, 'NOT_FOUND']].sort(),
  );
  for (const record of good) {
    assert.equal((await dbMock.getLearningRecord(record.id)).status, 'APPROVED');
  }
  assert.equal((await dbMock.getLearningRecord(scanned.id)).status, 'PENDING');
  assert.equal((await dbMock.getLearningRecord(foreign.id)).status, 'PENDING');

  // Learners cannot batch-approve; a malformed body is a 400, not a partial result.
  const forbidden = await batchApproveRoute.POST(jsonRequest(
    'http://localhost/api/learning/sources/approve',
    LEARNER,
    { ids: [good[0].id] },
  ));
  assert.equal(forbidden.status, 403);
  for (const body of [{}, { ids: [] }, { ids: 'nope' }, { ids: [''] }, { ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) }]) {
    const bad = await batchApproveRoute.POST(jsonRequest('http://localhost/api/learning/sources/approve', OWNER, body));
    assert.equal(bad.status, 400, JSON.stringify(body).slice(0, 40));
  }
});
