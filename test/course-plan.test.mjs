import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const realArsenal = await import('../lib/arsenal-core.js');
const {
  cleanPlanOutline,
  lessonCodeOf,
  outlineFromLessonCodes,
  passageIndex,
  rankPassages,
  sampleSourceText,
  surveyBatches,
} = realArsenal;

/* ---------------- pure pieces ---------------- */

test('sampleSourceText keeps a small source whole and samples a large one evenly within budget', () => {
  const small = [{ text: 'Page one.', source: 's p.1' }, { text: 'Page two.', source: 's p.2' }];
  assert.equal(sampleSourceText(small), 'Page one.\n\nPage two.');
  const big = Array.from({ length: 200 }, (_, i) => ({ text: `Page ${i + 1} ${'x'.repeat(3000)}`, source: `s p.${i + 1}` }));
  const sample = sampleSourceText(big, { budget: 20000, perPage: 1500 });
  assert.ok(sample.length <= 20000 + 200);
  assert.match(sample, /^Page 1 /);
  assert.match(sample, /Page 2 /);
  // Reaches into the back of the document, not just the front.
  assert.ok(/Page 1[0-9]{2} /.test(sample));
});

test('surveyBatches packs samples by character budget without splitting one', () => {
  const samples = [{ id: 'a', text: 'x'.repeat(30000) }, { id: 'b', text: 'x'.repeat(30000) }, { id: 'c', text: 'x'.repeat(10) }];
  const batches = surveyBatches(samples, { budget: 60000 });
  assert.deepEqual(batches.map((b) => b.map((s) => s.id)), [['a'], ['b', 'c']]);
  assert.deepEqual(surveyBatches([]), []);
});

test('cleanPlanOutline numbers lessons by annex, keeps only known sources, and names what it drops', () => {
  const out = cleanPlanOutline({
    title: 'Basic Electronics',
    annexes: [
      { title: 'Circuits', lessons: [
        { title: 'Ohm', objective: 'Apply Ohm\'s law to a series circuit.', sourceIds: ['src1', 'nope'] },
        { title: 'Blank', objective: '' },
        { title: 'Long', objective: `${'Explain '.repeat(60)}.` },
        { title: 'Two sentences', objective: `State the turns ratio. ${'Then also derive the impedance ratio from first principles and show every step for a matching transformer. '.repeat(3)}` },
      ] },
      { title: 'Empty', lessons: [] },
    ],
  }, { knownSourceIds: ['src1'] });
  assert.equal(out.title, 'Basic Electronics');
  assert.equal(out.annexes.length, 1);
  assert.equal(out.annexes[0].letter, 'A');
  assert.deepEqual(out.annexes[0].lessons.map((l) => l.id), ['A.01', 'A.02']);
  assert.deepEqual(out.annexes[0].lessons[0].suggestedSourceIds, ['src1']);
  assert.equal(out.annexes[0].lessons[1].objective, 'State the turns ratio.');
  assert.deepEqual(out.dropped.map((d) => d.reason), ['no objective', 'objective longer than 240 characters', 'no lessons with an objective']);
});

test('rankPassages finds the passages that cover an objective across sources and names their source', () => {
  const documents = [
    { text: 'A transformer moves electrical energy between circuits through a shared magnetic field. The turns ratio sets the voltage ratio.', source: 'srcA p.3' },
    { text: 'Subnet masks divide an IPv4 address into network and host bits. A /24 has 254 usable hosts.', source: 'srcB p.1' },
    { text: 'The transformer turns ratio also sets the current ratio inversely, and the impedance ratio as its square.', source: 'srcA p.4' },
  ];
  const index = passageIndex(documents);
  const hits = rankPassages('Explain how the transformer turns ratio sets the voltage and current ratio.', index);
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((hit) => hit.source.startsWith('srcA')));
  assert.deepEqual(rankPassages('Describe how a diesel engine compresses air before injection.', index), []);
});

test('lessonCodeOf reads a schoolhouse file name: course prefix, annex, lesson, name, role, exam', () => {
  assert.deepEqual(lessonCodeOf('BE0603 Cabling Performance Exam LP'), { code: 'BE0603', prefix: 'BE', annex: 6, lesson: 3, name: 'Cabling Performance Exam', role: 'LP', exam: true });
  assert.deepEqual(lessonCodeOf('BE0405_DCtoDCConverters_SHO'), { code: 'BE0405', prefix: 'BE', annex: 4, lesson: 5, name: 'DC to DC Converters', role: 'SHO', exam: false });
  assert.deepEqual(lessonCodeOf('BE0209_ACFundamentalsWX_LP'), { code: 'BE0209', prefix: 'BE', annex: 2, lesson: 9, name: 'AC Fundamentals WX', role: 'LP', exam: true });
  assert.equal(lessonCodeOf('BE0310_IntroToRegulators_ LP').name, 'Intro To Regulators');
  assert.equal(lessonCodeOf('BE0502 Network Switches  LP').name, 'Network Switches');
  assert.equal(lessonCodeOf('BASIC ELECTRONICS COURSE Formula Sheet (New)'), null);
  assert.equal(lessonCodeOf('AY27_8670_Prerequisite_Coursebook.pdf'), null);
});

test('outlineFromLessonCodes builds annexes and lessons from coded titles, pairs plan with handout, keeps exams in place unbuilt', () => {
  const survey = [
    { id: 'lp-0101', title: 'BE0101_IntroToBEC_LP', kind: 'lesson-plan', summary: 'Course intro.', topics: ['orientation'] },
    { id: 'sho-0101', title: 'BE0101_IntroToBEC_SHO', kind: 'student-material', summary: 'Handout.', topics: [] },
    { id: 'lp-0103', title: 'BE0103_DCTheory_LP', kind: 'lesson-plan', summary: 'DC theory.', topics: ['voltage', 'current'] },
    { id: 'lp-0111', title: 'BE0111_DCFundamentalsWX_LP', kind: 'poi', summary: 'Written exam.', topics: [] },
    { id: 'sho-0204', title: 'BE0204_Transformers_SHO', kind: 'student-material', summary: 'Transformers handout.', topics: ['turns ratio'] },
    { id: 'lp-0204', title: 'BE0204_Transformers_LP', kind: 'lesson-plan', summary: 'Transformers.', topics: ['turns ratio'] },
    { id: 'lp-0209', title: 'BE0209_ACFundamentalsWX_LP', kind: 'lesson-plan', summary: 'Exam.', topics: [] },
    { id: 'ref', title: 'BASIC ELECTRONICS COURSE Formula Sheet (New)', kind: 'reference', summary: 'Formulas.', topics: [] },
  ];
  const out = outlineFromLessonCodes(survey);
  assert.equal(out.coded, 5);
  assert.deepEqual(out.annexes.map((a) => [a.letter, a.number, a.title, a.lessons.length]), [['A', 1, 'DC Fundamentals', 3], ['B', 2, 'AC Fundamentals', 2]]);
  const [intro, dc, wx] = out.annexes[0].lessons;
  assert.deepEqual([intro.id, intro.code, intro.title, intro.kind, intro.status], ['A.01', 'BE0101', 'Intro To BEC', 'lesson', 'planned']);
  // The lesson plan first, then the handout -- the same code, one lesson.
  assert.deepEqual(intro.suggestedSourceIds, ['lp-0101', 'sho-0101']);
  assert.equal(dc.code, 'BE0103');
  assert.deepEqual([wx.kind, wx.status], ['exam', 'skipped']);
  assert.match(wx.reason, /not generated/);
  // Handout listed before its plan in the survey still yields plan-first.
  assert.deepEqual(out.annexes[1].lessons[0].suggestedSourceIds, ['lp-0204', 'sho-0204']);
  assert.equal(out.annexes[1].lessons[0].title, 'Transformers');
  // An uncoded corpus keeps the model outline.
  assert.equal(outlineFromLessonCodes([{ id: 'a', title: 'Manual.pdf' }, { id: 'b', title: 'BE0101 x' }]), null);
});

/* ---------------- handlers, against in-memory stores ---------------- */

const records = new Map();
let nextId = 1;
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function seed({ id, ownerId, type, status = 'PENDING', version = 0, payload }) {
  const record = { id, ownerId, type, status, version, payload: clone(payload), createdAt: new Date(), updatedAt: new Date() };
  records.set(id, record);
  return clone(record);
}

const dbMock = {
  db: {},
  async createLearningRecord({ ownerId, type, status = 'PENDING', payload }) {
    return seed({ id: `rec-${nextId++}`, ownerId, type, status, payload });
  },
  async getLearningRecord(id) { return clone(records.get(id)) ?? null; },
  async getLearningRecordsByIds(ids) { return ids.map((id) => clone(records.get(id))).filter(Boolean); },
  async listLearningRecords({ ownerId, type } = {}) {
    return [...records.values()].filter((r) => (!ownerId || r.ownerId === ownerId) && (!type || r.type === type)).map(clone);
  },
  async updateLearningRecord(id, data) { const r = records.get(id); Object.assign(r, data); return clone(r); },
  async updateLearningRecordIfVersion(id, version, data) {
    const r = records.get(id);
    if (!r || r.version !== version) return false;
    Object.assign(r, data);
    r.version += 1;
    return true;
  },
  async deleteLearningRecords(ids) { let n = 0; for (const id of ids) n += records.delete(id) ? 1 : 0; return { records: n, courses: 0 }; },
  async courseEvidenceCount() { return 0; },
  async createCourseRevisionAtomically() { return null; },
  async approveCourseAtomically() { return null; },
  async materialiseCourse() { return null; },
  async approvePendingDeliveryCourseItems() { return 0; },
  async listDeliveryCourseItems() { return []; },
  async getDeliveryCourseItem() { return null; },
  async updateDeliveryCourseItem() { return null; },
  matchesApprovedMasteryPlan: () => false,
  createLearningEvidenceStore: () => ({}),
  classGaps: async () => [],
};

const OWNER = { id: 'owner', role: 'INSTRUCTOR' };
const modelCalls = [];

mock.module('../lib/db.js', { namedExports: dbMock });
mock.module('../lib/source/library.js', {
  namedExports: {
    async sourceFor(identity, id, { approvedOnly = false } = {}) {
      const r = records.get(id);
      if (!r || r.type !== 'SOURCE' || (approvedOnly && r.status !== 'APPROVED')) {
        const e = new Error('Source not found'); e.code = 'NOT_FOUND'; throw e;
      }
      return clone(r);
    },
    async createRecordWithSourceGuards({ ownerId, type, status, payload }) {
      return seed({ id: `rec-${nextId++}`, ownerId, type, status, payload });
    },
    attachSourcePdf: async () => null, createSourceWithPdf: async () => null, normaliseCollection: (v) => v,
    publicSourcePayload: (p) => p, sourcePdfMap: async () => new Map(), sourcePdfResponse: () => null,
    sourceSummary: (r) => ({ id: r.id }), updateSourceStatusIfVersion: async () => null,
    validatePdfPages: () => ({ valid: true }),
  },
});
mock.module('../lib/arsenal-core.js', {
  namedExports: {
    ...realArsenal,
    async surveySourceBatch({ samples }) {
      modelCalls.push('survey');
      return samples.map((s) => ({
        id: s.id, kind: s.id === 'poi' ? 'poi' : 'student-material',
        summary: `About ${s.title}`, topics: ['transformers'],
        lessons: s.id === 'poi' ? [{ code: 'BE.02.04', title: 'Transformers' }, { code: 'TI.01.02', title: 'Subnetting' }] : [],
      }));
    },
    async outlineCoursePlan({ survey }) {
      modelCalls.push('outline');
      return realArsenal.cleanPlanOutline({
        title: 'Planned course',
        annexes: [
          { title: 'Electronics', lessons: [{ title: 'Transformers', objective: 'Explain how the transformer turns ratio sets the voltage ratio.', sourceIds: ['s-elec'] }] },
          { title: 'Networks', lessons: [
            { title: 'Subnetting', objective: 'Describe how a subnet mask divides an address into network and host bits.', sourceIds: ['s-net'] },
            { title: 'Diesel', objective: 'Describe how a diesel engine compresses air before injection.', sourceIds: [] },
          ] },
        ],
      }, { knownSourceIds: survey.map((s) => s.id) });
    },
    async writeLessonObjectives({ lessons }) {
      modelCalls.push(`objectives:${lessons.filter((l) => l.kind !== 'exam').length}`);
      return new Map(lessons.filter((l) => l.kind !== 'exam').map((l) => [l.id, /Transformers/.test(l.title)
        ? { objective: 'Explain how the transformer turns ratio sets the voltage ratio.', fallback: false }
        : { objective: `Explain ${l.title}.`, fallback: true }]));
    },
    async draftCourse({ title, objectives, documents }) {
      modelCalls.push(`build:${title}`);
      if (/turns ratio/.test(objectives[0]) && documents.some((d) => /transformer/i.test(d.text))) {
        return { title, sections: [{ title, cite: documents[0].source, lesson: 'The turns ratio sets the voltage ratio.', pre: [], post: [], pages: [{ title: 'Ratio', blocks: [{ type: 'p', text: 'x' }] }] }] };
      }
      return { title, sections: [], skippedObjectives: [{ objective: objectives[0], reason: 'no approved passage covers this objective' }] };
    },
  },
});

const plan = await import('../lib/learning/course-plan.js');

function seedSources() {
  seed({ id: 'poi', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'POI', pages: [{ page: 1, text: 'BE.02.04 Transformers. TI.01.02 Subnetting. Lesson list.' }] } });
  seed({ id: 's-elec', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'Electronics book', pages: [{ page: 3, text: 'A transformer moves electrical energy between circuits through a shared magnetic field. The turns ratio sets the voltage ratio.' }] } });
  seed({ id: 's-net', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'Network book', pages: [{ page: 1, text: 'Subnet masks divide an IPv4 address into network and host bits. A /24 has 254 usable hosts.' }] } });
}

async function runUntil(fn, id, predicate, max = 20) {
  let view;
  for (let i = 0; i < max; i += 1) {
    view = (await fn(OWNER, { params: { id }, body: {} })).json;
    if (predicate(view)) return view;
  }
  throw new Error(`did not reach state after ${max} steps: ${view?.status}`);
}

test('a plan surveys in batches, outlines, maps by retrieval, and builds one lesson per step into one draft', async () => {
  records.clear(); modelCalls.length = 0; nextId = 1;
  seedSources();
  const created = (await plan.createPlan(OWNER, { body: { title: '', sourceIds: ['poi', 's-elec', 's-net'] } })).json;
  assert.equal(created.status, 'survey');

  const surveyed = await runUntil(plan.surveyPlanStep, created.id, (v) => v.status === 'outline');
  assert.equal(surveyed.surveyed, 3);
  assert.equal(surveyed.survey.find((s) => s.id === 'poi').kind, 'poi');

  const outlined = (await plan.outlinePlanStep(OWNER, { params: { id: created.id }, body: {} })).json;
  assert.equal(outlined.status, 'map');
  assert.equal(outlined.title, 'Planned course');
  assert.equal(outlined.lessons, 3);

  const mapped = (await plan.mapPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.equal(mapped.status, 'build');
  const lessons = plan.planLessons(mapped);
  assert.deepEqual(lessons.map((l) => [l.id, l.status]), [['A.01', 'planned'], ['B.01', 'planned'], ['B.02', 'ungrounded']]);
  // Retrieval, not the model's suggestion, decides the sources -- and it is
  // the content book, never the POI that merely lists the lesson.
  assert.deepEqual(lessons[0].sourceIds, ['s-elec']);
  assert.deepEqual(lessons[1].sourceIds, ['s-net']);

  const first = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.equal(first.built.id, 'A.01');
  assert.equal(first.built.ok, true);
  assert.equal(first.status, 'build');
  assert.ok(first.courseId);
  const draftAfterOne = records.get(first.courseId);
  assert.equal(draftAfterOne.type, 'COURSE_DRAFT');
  assert.equal(draftAfterOne.status, 'PENDING');
  assert.equal(draftAfterOne.payload.sections.length, 1);
  assert.equal(draftAfterOne.payload.sections[0].id, 'A.01');
  assert.deepEqual(draftAfterOne.payload.sections[0].annex, { letter: 'A', title: 'Electronics' });
  assert.equal(draftAfterOne.payload.planId, created.id);

  const second = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.equal(second.built.id, 'B.01');
  assert.equal(second.built.ok, false);
  assert.match(second.built.reason, /no approved passage/);
  // Only the planned lessons were sent to the model; the ungrounded one was not.
  assert.equal(second.status, 'complete');
  assert.equal(second.counts.drafted, 1);
  assert.equal(second.counts.failed, 1);
  assert.equal(second.counts.ungrounded, 1);
  assert.deepEqual(modelCalls.filter((c) => c.startsWith('build')), ['build:Transformers', 'build:Subnetting']);
  // The draft is one course with the lessons that built; the failed one is
  // named on the plan, not silently absent.
  assert.equal(records.get(first.courseId).payload.sections.length, 1);

  // A retried lesson goes back in the queue and the plan reopens.
  const retried = (await plan.retryPlanLesson(OWNER, { params: { id: created.id }, body: { lessonId: 'B.01' } })).json;
  assert.equal(retried.status, 'build');
  assert.equal(retried.counts.planned, 1);
});

test('plans are owner-only', async () => {
  records.clear(); nextId = 1;
  seedSources();
  const created = (await plan.createPlan(OWNER, { body: { sourceIds: ['s-elec'] } })).json;
  const other = { id: 'other', role: 'INSTRUCTOR' };
  await assert.rejects(plan.getPlan(other, { params: { id: created.id } }), /Plan not found/);
  await assert.rejects(plan.surveyPlanStep({ id: 'l', role: 'LEARNER' }, { params: { id: created.id } }), /Plan not found/);
  assert.deepEqual((await plan.listPlans(other)).json, []);
  assert.equal((await plan.listPlans(OWNER)).json.length, 1);
  await assert.rejects(plan.createPlan(OWNER, { body: { sourceIds: ['missing'] } }), /Source not found/);
});

test('deleting a plan removes the plan and leaves the draft it built alone', async () => {
  records.clear(); nextId = 1;
  seedSources();
  const created = (await plan.createPlan(OWNER, { body: { sourceIds: ['poi', 's-elec', 's-net'] } })).json;
  await runUntil(plan.surveyPlanStep, created.id, (v) => v.status === 'outline');
  await plan.outlinePlanStep(OWNER, { params: { id: created.id }, body: {} });
  await plan.mapPlanStep(OWNER, { params: { id: created.id } });
  const built = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.ok(built.courseId);

  await assert.rejects(plan.deletePlan({ id: 'other', role: 'INSTRUCTOR' }, { params: { id: created.id } }), /Plan not found/);
  const gone = (await plan.deletePlan(OWNER, { params: { id: created.id } })).json;
  assert.deepEqual(gone, { id: created.id, deleted: true, courseId: built.courseId });
  assert.equal(records.get(created.id), undefined);
  assert.equal(records.get(built.courseId).type, 'COURSE_DRAFT');
  await assert.rejects(plan.getPlan(OWNER, { params: { id: created.id } }), /Plan not found/);
});

test('a coded corpus is outlined from its lesson codes; the model writes only objectives; exams are kept and never built', async () => {
  records.clear(); modelCalls.length = 0; nextId = 1;
  seed({ id: 'lp-0204', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'BE0204_Transformers_LP', pages: [{ page: 1, text: 'A transformer moves electrical energy between circuits through a shared magnetic field. The turns ratio sets the voltage ratio.' }] } });
  seed({ id: 'sho-0204', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'BE0204_Transformers_SHO', pages: [{ page: 1, text: 'Student handout: the transformer turns ratio and the voltage ratio it sets.' }] } });
  seed({ id: 'lp-0205', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'BE0205_Capacitors_LP', pages: [{ page: 1, text: 'A capacitor stores charge on two plates separated by a dielectric.' }] } });
  seed({ id: 'lp-0209', ownerId: OWNER.id, type: 'SOURCE', status: 'APPROVED', payload: { title: 'BE0209_ACFundamentalsWX_LP', pages: [{ page: 1, text: 'Written examination administration instructions.' }] } });
  const created = (await plan.createPlan(OWNER, { body: { title: 'BEC', sourceIds: ['lp-0204', 'sho-0204', 'lp-0205', 'lp-0209'] } })).json;
  await runUntil(plan.surveyPlanStep, created.id, (v) => v.status === 'outline');
  const outlined = (await plan.outlinePlanStep(OWNER, { params: { id: created.id }, body: {} })).json;
  assert.equal(outlined.outlinedFrom, 'lesson-codes');
  assert.equal(outlined.lessons, 3);
  assert.deepEqual(outlined.annexes.map((a) => a.title), ['AC Fundamentals']);
  // No model outline call: the codes decided the structure.
  assert.ok(!modelCalls.includes('outline'));
  assert.deepEqual(modelCalls.filter((c) => c.startsWith('objectives')), ['objectives:2']);
  const lessons = plan.planLessons(outlined);
  assert.deepEqual(lessons.map((l) => [l.code, l.kind, l.status]), [['BE0204', 'lesson', 'planned'], ['BE0205', 'lesson', 'planned'], ['BE0209', 'exam', 'skipped']]);
  assert.equal(lessons[1].objectiveFallback, true);

  const mapped = (await plan.mapPlanStep(OWNER, { params: { id: created.id } })).json;
  const m = plan.planLessons(mapped);
  // Its own plan and handout, in that order, ahead of anything else.
  assert.deepEqual(m[0].sourceIds.slice(0, 2), ['lp-0204', 'sho-0204']);
  assert.equal(m[2].status, 'skipped');

  const built = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.equal(built.built.id, 'A.01');
  const section = records.get(built.courseId).payload.sections[0];
  assert.equal(section.code, 'BE0204');
  await plan.buildPlanStep(OWNER, { params: { id: created.id } });
  const done = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.equal(done.status, 'complete');
  assert.equal(done.counts.skipped, 1);
  assert.ok(!modelCalls.some((c) => /WX/.test(c)));

  // Outlining again after a build leaves the old draft alone and starts a new one.
  const again = (await plan.outlinePlanStep(OWNER, { params: { id: created.id }, body: { again: true } })).json;
  assert.equal(again.status, 'map');
  assert.equal(again.courseId, null);
  assert.equal(records.get(built.courseId).type, 'COURSE_DRAFT');
  await plan.mapPlanStep(OWNER, { params: { id: created.id } });
  const rebuilt = (await plan.buildPlanStep(OWNER, { params: { id: created.id } })).json;
  assert.ok(rebuilt.courseId && rebuilt.courseId !== built.courseId);
});
