import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLearningRecord,
  createLearningEvidenceStore,
  db,
  getLearningRecord,
  updateLearningRecordIfVersion,
} from '../lib/db.js';
import {
  approveCourse,
  approveMasteryPlan,
  approveRubric,
  generateMasteryPlan,
  getMasterySession,
  getCourse,
  getSource,
  listCourseItems,
  listCourses,
  listMasterySessions,
  listSources,
  masteryTurn,
  reviewCourseItem,
} from '../lib/learning/core.js';
import { createEvidenceHandlers } from '../lib/learning/evidence.js';
import { errorStatus } from '../lib/learning/http.js';

// Opt in explicitly: CI sets a placeholder DATABASE_URL for prisma generate only.
const databaseReady = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);

async function status(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return errorStatus(error);
  }
}

test(
  'labelled route fixture scopes pending visibility and learner denial',
  { skip: !databaseReady },
  async () => {
    const suffix = `${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Fixture Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `fixture-i-${suffix}` },
    });
    const learnerRow = await db.user.create({
      data: { name: `Fixture Learner ${suffix}`, role: 'LEARNER', externalId: `fixture-l-${suffix}` },
    });
    // What lib/auth.js hands the handlers after verifying a bearer token.
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const learner = { id: learnerRow.id, name: learnerRow.name, role: 'LEARNER' };
    const records = [];
    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      payload: {
        title: `Fixture source ${suffix}`,
        sourceId: `fixture-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(source);
    const approvedSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Approved fixture source ${suffix}`,
        sourceId: `fixture-approved-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(approvedSource);
    const pendingCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Pending ${suffix}`,
        sourceIds: [approvedSource.id],
        sections: [{
          title: 'Source text',
          cite: `${approvedSource.id} p.1`,
          lesson: 'Approved fixture source text.',
          pre: [{ stem: 'Which approved fixture source text applies?', options: ['Approved fixture source text.', 'Unapproved reference.'], answer: 0 }],
          post: [{ stem: 'Identify the approved fixture source text.', options: ['Approved fixture source text.', 'Unapproved reference.'], answer: 0 }],
        }],
      },
    });
    records.push(pendingCourse);
    const approvedCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: `Approved ${suffix}`,
        sourceIds: [approvedSource.id],
        sections: [
          {
            title: 'Lesson',
            lesson: 'A cited lesson.',
            cite: 'fixture-approved-source',
            pre: [{ stem: 'Before?', options: ['A', 'B'], answer: 0 }],
            post: [{ stem: 'After?', options: ['A', 'B'], answer: 0 }],
          },
        ],
      },
    });
    records.push(approvedCourse);
    const invalidRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      payload: {
        rubric: { flagged: true },
        validation: { valid: true, flagged: true },
        traceability: { grounded: false, coverage: 0, ungrounded: [{ source: 'missing' }] },
      },
    });
    records.push(invalidRubric);
    const savedSession = await createLearningRecord({
      ownerId: learner.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: approvedCourse.id,
        sourceId: approvedSource.id,
        complete: true,
        source: 'Private grading context',
        rubric: [{ indicators: { mastered: 'Private indicator' } }],
        report: { criteria: [{ elo: 'Fixture objective', verdict: 'mastered' }] },
        transcript: ['Fixture saved answer'],
      },
    });
    records.push(savedSession);

    try {
      const store = createLearningEvidenceStore();
      const approvedProjection = await store.getApprovedCourse({ courseId: approvedCourse.id });
      assert.equal(approvedProjection.sections[0].lesson, 'A cited lesson.');
      assert.equal(approvedProjection.sections[0].items, undefined);
      assert.equal(approvedProjection.sections[0].pre[0].stem, 'Before?');

      const instructorSources = await listSources(instructor);
      assert.ok(instructorSources.json.some((entry) => entry.id === source.id));

      const instructorCourses = await listCourses(instructor);
      assert.ok(instructorCourses.json.some((entry) => entry.id === pendingCourse.id));

      const learnerCourses = await listCourses(learner);
      assert.deepEqual(
        learnerCourses.json.filter((entry) => entry.id === approvedCourse.id || entry.id === pendingCourse.id).map((entry) => entry.id),
        [approvedCourse.id],
      );

      assert.equal(await status(getSource(learner, { params: { id: source.id } })), 404);
      assert.equal(await status(approveRubric(instructor, { params: { id: invalidRubric.id } })), 409);

      const ownSession = await getMasterySession(learner, { params: { id: savedSession.id } });
      assert.equal(ownSession.json.report.criteria[0].verdict, 'mastered');
      assert.equal(ownSession.json.currentQuestion, null);
      assert.equal(ownSession.json.rubric, undefined);
      assert.equal(ownSession.json.source, undefined);
      assert.equal(await status(getMasterySession(instructor, { params: { id: savedSession.id } })), 404);

      const ownSessions = await listMasterySessions(learner, { query: { courseId: approvedCourse.id } });
      assert.deepEqual(ownSessions.json.map((entry) => entry.id), [savedSession.id]);

      // SCORM export through the real Prisma store: the export is recorded under the instructor.
      const evidence = createEvidenceHandlers({ store });
      const exported = await evidence.exportScorm(instructor, { query: { courseId: approvedCourse.id, version: '1.2' } });
      assert.equal(exported.headers['content-type'], 'application/zip');
      assert.ok(exported.body.length > 0);
      const exportRows = await db.learningRecord.findMany({ where: { ownerId: instructor.id, type: 'SCORM_EXPORT' } });
      records.push(...exportRows);
      assert.equal(exportRows.length, 1);
      assert.equal(exportRows[0].payload.courseId, approvedCourse.id);
      assert.equal(await status(evidence.exportScorm(learner, { query: { courseId: approvedCourse.id } })), 403);

      // Approval materialises the draft into Course/Section/Item, keyed by the
      // record id, with the source's Anchor id on every citation. Twice is safe.
      for (let pass = 0; pass < 2; pass += 1) {
        const approved = await approveCourse(instructor, { params: { id: pendingCourse.id } });
        assert.equal(approved.json.status, 'APPROVED');
        assert.deepEqual(approved.json.materialised, { courseId: pendingCourse.id, sections: 1, items: 3 });
      }
      const typed = await db.course.findUnique({
        where: { id: pendingCourse.id },
        include: { sections: { include: { items: { orderBy: { id: 'asc' } } } } },
      });
      assert.equal(typed.sourceId, `fixture-approved-source-${suffix}`);
      assert.equal(typed.sections.length, 1);
      // Materialised PENDING: approving the course releases the snapshot, not
      // the items in it. Each one still needs an instructor's decision.
      assert.deepEqual(typed.sections[0].items.map((item) => [item.kind, item.status]), [['LESSON', 'PENDING'], ['QUESTION', 'PENDING'], ['QUESTION', 'PENDING']]);
      assert.equal(typed.sections[0].items[0].citation.pubId, `fixture-approved-source-${suffix}`);
      assert.equal(await status(approveCourse(learner, { params: { id: pendingCourse.id } })), 404);
    } finally {
      await db.course.deleteMany({ where: { id: pendingCourse.id } });
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((entry) => entry.id) } } });
      await db.user.deleteMany({ where: { id: { in: [instructorRow.id, learnerRow.id] } } });
    }
  },
);

test(
  'shared plan handlers enforce owner/source/duplicate/CAS and revision guards',
  { skip: !databaseReady },
  async () => {
    const suffix = `${Date.now()}-plan-${process.pid}`;
    const users = await Promise.all([
      db.user.create({
        data: { name: `Plan Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `plan-i-${suffix}` },
      }),
      db.user.create({
        data: { name: `Other Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `plan-o-${suffix}` },
      }),
      db.user.create({
        data: { name: `Plan Learner ${suffix}`, role: 'LEARNER', externalId: `plan-l-${suffix}` },
      }),
    ]);
    const [instructorRow, otherInstructorRow, learnerRow] = users;
    const instructor = { id: instructorRow.id, role: 'INSTRUCTOR' };
    const otherInstructor = { id: otherInstructorRow.id, role: 'INSTRUCTOR' };
    const learner = { id: learnerRow.id, role: 'LEARNER' };
    const records = [];
    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Plan source ${suffix}`,
        sourceId: `plan-source-${suffix}`,
        text: 'Safety check before operation.',
        pages: [{ page: 1, text: 'Safety check before operation.' }],
        chunks: [{ page: 1, text: 'Safety check before operation.' }],
      },
    });
    const secondSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Second plan source ${suffix}`,
        sourceId: `second-plan-source-${suffix}`,
        text: 'Operation sequence follows the safety check.',
        pages: [{ page: 1, text: 'Operation sequence follows the safety check.' }],
        chunks: [{ page: 1, text: 'Operation sequence follows the safety check.' }],
      },
    });
    const pendingSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'PENDING',
      payload: {
        title: `Pending plan source ${suffix}`,
        sourceId: `pending-plan-source-${suffix}`,
        text: 'Pending source text.',
        pages: [{ page: 1, text: 'Pending source text.' }],
        chunks: [{ page: 1, text: 'Pending source text.' }],
      },
    });
    records.push(source, secondSource, pendingSource);
    const approvedPlan = {
      status: 'APPROVED',
      sourceId: secondSource.id,
      revision: 'approved-plan-revision',
      criteria: [
        {
          elo: 'Operation',
          indicators: {
            developing: 'Names operation',
            competent: 'Explains operation',
            mastered: 'Performs operation',
          },
        },
        {
          elo: 'Safety check',
          indicators: {
            developing: 'Names safety check',
            competent: 'Explains safety check',
            mastered: 'Uses safety check',
          },
        },
      ],
    };
    const course = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: `Plan course ${suffix}`,
        sourceIds: [source.id, secondSource.id],
        masteryPlan: { ...approvedPlan, status: 'PENDING' },
      },
    });
    const noPlanCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: `No plan ${suffix}`, sourceIds: [source.id] },
    });
    const pendingCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: `Pending source ${suffix}`, sourceIds: [pendingSource.id] },
    });
    records.push(course, noPlanCourse, pendingCourse);
    const mismatchedSession = await createLearningRecord({
      ownerId: learner.id,
      type: 'MASTERY_SESSION',
      status: 'ACTIVE',
      payload: {
        courseId: course.id,
        sourceId: secondSource.id,
        masteryPlanRevision: 'stale-plan-revision',
        complete: true,
        currentQuestion: null,
        rubric: approvedPlan.criteria,
        criteria: [],
        report: { complete: true, criteria: [] },
        transcript: [],
      },
    });
    records.push(mismatchedSession);
    try {
      assert.equal(
        await status(generateMasteryPlan(otherInstructor, { params: { id: course.id }, body: { sourceId: source.id } })),
        404,
      );
      assert.equal(
        await status(generateMasteryPlan(instructor, { params: { id: noPlanCourse.id }, body: { sourceId: secondSource.id } })),
        404,
      );
      assert.equal(
        await status(generateMasteryPlan(instructor, { params: { id: pendingCourse.id }, body: { sourceId: pendingSource.id } })),
        404,
      );
      assert.equal(
        await status(generateMasteryPlan(instructor, { params: { id: course.id }, body: { sourceId: source.id } })),
        409,
      );

      const before = await getLearningRecord(noPlanCourse.id);
      assert.equal(
        await updateLearningRecordIfVersion(noPlanCourse.id, before.version, {
          payload: { ...before.payload, touched: true },
        }),
        true,
      );
      assert.equal(
        await updateLearningRecordIfVersion(noPlanCourse.id, before.version, {
          payload: before.payload,
        }),
        false,
      );

      const pendingView = await getCourse(learner, { params: { id: course.id } });
      assert.equal(pendingView.json.course.masteryPlan, undefined);
      await updateLearningRecordIfVersion(course.id, (await getLearningRecord(course.id)).version, {
        payload: { ...course.payload, masteryPlan: approvedPlan },
      });
      const approvedView = await getCourse(learner, { params: { id: course.id } });
      assert.deepEqual(approvedView.json.course.masteryPlan, {
        status: 'APPROVED',
        sourceId: secondSource.id,
        revision: approvedPlan.revision,
      });

      assert.equal(
        await status(
          masteryTurn(learner, { params: { id: mismatchedSession.id }, body: { answer: 'ignored' } }),
        ),
        409,
      );
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    }
  },
);

test(
  'BOTH owners keep authoring access while cross-owner views stay learner-safe',
  { skip: !databaseReady },
  async () => {
    const suffix = `${Date.now()}-both-plan-${process.pid}`;
    const users = await Promise.all([
      db.user.create({
        data: { name: `Both Plan Owner ${suffix}`, role: 'BOTH', externalId: `both-plan-owner-${suffix}` },
      }),
      db.user.create({
        data: { name: `Other Both Viewer ${suffix}`, role: 'BOTH', externalId: `both-plan-viewer-${suffix}` },
      }),
    ]);
    const [ownerRow, otherRow] = users;
    const owner = { id: ownerRow.id, role: 'BOTH' };
    const other = { id: otherRow.id, role: 'BOTH' };
    const records = [];
    const source = await createLearningRecord({
      ownerId: owner.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Both plan source ${suffix}`,
        sourceId: `both-plan-source-${suffix}`,
        text: 'Operation follows the safety check before operation.',
        pages: [{ page: 1, text: 'Operation follows the safety check before operation.' }],
        chunks: [{ page: 1, text: 'Operation follows the safety check before operation.' }],
      },
    });
    records.push(source);
    const pendingPlan = {
      status: 'PENDING',
      sourceId: source.id,
      revision: `both-plan-revision-${suffix}`,
      criteria: [
        {
          elo: 'Operation',
          indicators: {
            developing: 'Names the operation.',
            competent: 'Explains the operation.',
            mastered: 'Performs the operation.',
          },
        },
        {
          elo: 'Safety check',
          indicators: {
            developing: 'Names the safety check.',
            competent: 'Explains the safety check.',
            mastered: 'Uses the safety check.',
          },
        },
      ],
    };
    const course = await createLearningRecord({
      ownerId: owner.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: `Both plan course ${suffix}`,
        sourceIds: [source.id],
        sections: [{
          title: 'Operation',
          lesson: 'Operation follows the safety check.',
          pre: [{
            stem: 'What follows the safety check?',
            options: ['Operation', 'Nothing'],
            answer: 0,
            indicators: { mastered: 'Performs operation.' },
          }],
        }],
        masteryPlan: pendingPlan,
      },
    });
    records.push(course);

    try {
      // The duplicate guard proves an owning BOTH identity reaches generation
      // without making a paid model call.
      assert.equal(
        await status(
          generateMasteryPlan(owner, {
            params: { id: course.id },
            body: { sourceId: source.id },
          }),
        ),
        409,
      );

      const approved = await approveMasteryPlan(owner, {
        params: { id: course.id },
        body: { revision: pendingPlan.revision },
      });
      assert.equal(approved.json.masteryPlan.status, 'APPROVED');

      const ownView = await getCourse(owner, { params: { id: course.id } });
      assert.equal(ownView.json.course.sections[0].pre[0].answer, 0);
      assert.equal(
        ownView.json.course.masteryPlan.criteria[0].indicators.mastered,
        'Performs the operation.',
      );

      const crossOwnerView = await getCourse(other, { params: { id: course.id } });
      assert.deepEqual(crossOwnerView.json.course.masteryPlan, {
        status: 'APPROVED',
        sourceId: source.id,
        revision: pendingPlan.revision,
      });
      assert.equal(crossOwnerView.json.course.sections[0].pre[0].answer, undefined);
      assert.equal(crossOwnerView.json.course.sections[0].pre[0].indicators, undefined);
      assert.equal(JSON.stringify(crossOwnerView).includes('Performs the operation.'), false);
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    }
  },
);

// The gate end to end against real rows: approving a course materialises
// items PENDING, only an explicit per-item decision moves one to APPROVED, and
// only APPROVED items reach the learner-facing delivery query. The decision
// rules themselves are unit-tested in test/item-review.test.mjs; what is
// proved here is the wiring -- ownership, persistence and the learner read.
test(
  'per-item ratification gates what a learner can see',
  { skip: !databaseReady },
  async () => {
    const suffix = `items-${Date.now()}-${process.pid}`;
    const ownerRow = await db.user.create({
      data: { name: `Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `owner-${suffix}` },
    });
    const otherRow = await db.user.create({
      data: { name: `Other ${suffix}`, role: 'INSTRUCTOR', externalId: `other-${suffix}` },
    });
    const owner = { id: ownerRow.id, name: ownerRow.name, role: 'INSTRUCTOR' };
    const other = { id: otherRow.id, name: otherRow.name, role: 'INSTRUCTOR' };
    const records = [];
    const source = await createLearningRecord({
      ownerId: owner.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Source ${suffix}`,
        sourceId: `source-${suffix}`,
        text: 'Sight alignment is the relationship between the post and the aperture.',
        pages: [{ page: 1, text: 'Sight alignment is the relationship between the post and the aperture.' }],
        chunks: [{ page: 1, text: 'Sight alignment is the relationship between the post and the aperture.' }],
      },
    });
    records.push(source);
    const course = await createLearningRecord({
      ownerId: owner.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Aiming ${suffix}`,
        sourceIds: [source.id],
        sections: [{
          title: 'Aiming',
          cite: `${source.id} p.1`,
          lesson: 'Sight alignment is the relationship between the post and the aperture.',
          pre: [{ stem: 'Where does the post sit?', options: ['Left of the aperture', 'Centred in the aperture'], answer: 1 }],
          post: [{ stem: 'Why does alignment matter?', options: ['It does not', 'Angular error grows with range'], answer: 1 }],
        }],
      },
    });
    records.push(course);

    try {
      // Items cannot be reviewed before there are any.
      assert.equal(await status(listCourseItems(owner, { params: { id: course.id } })), 409);

      const approved = await approveCourse(owner, { params: { id: course.id }, body: { version: course.version } });
      const deliveryCourseId = approved.json.deliveryCourseId;

      const listed = await listCourseItems(owner, { params: { id: course.id } });
      assert.equal(listed.json.deliveryCourseId, deliveryCourseId);
      assert.deepEqual(listed.json.counts, { PENDING: 3, APPROVED: 0, REJECTED: 0 });
      assert.equal(listed.json.readyForLearners, false);
      const [lesson, pre, post] = listed.json.sections[0].items;
      assert.deepEqual(listed.json.sections[0].items.map((i) => i.status), ['PENDING', 'PENDING', 'PENDING']);

      // Another instructor owns neither the draft nor its items.
      assert.equal(await status(listCourseItems(other, { params: { id: course.id } })), 404);
      assert.equal(
        await status(reviewCourseItem(other, { params: { id: course.id, itemId: pre.id }, body: { decision: 'APPROVE' } })),
        404,
      );
      // Nor can an item from elsewhere be written through a course the caller owns.
      assert.equal(
        await status(reviewCourseItem(owner, { params: { id: course.id, itemId: 'not-an-item' }, body: { decision: 'APPROVE' } })),
        404,
      );

      await reviewCourseItem(owner, { params: { id: course.id, itemId: lesson.id }, body: { decision: 'APPROVE' } });
      await reviewCourseItem(owner, { params: { id: course.id, itemId: post.id }, body: { decision: 'REJECT' } });

      // A revision rewrites the wording and ratifies -- and leaves the evidence alone.
      const revised = await reviewCourseItem(owner, {
        params: { id: course.id, itemId: pre.id },
        body: {
          decision: 'REVISE',
          stem: 'Where does the front sight post sit?',
          options: ['Left of the aperture', 'Centred in the aperture', 'Below the aperture'],
          answer: 1,
          citation: { citation: 'FABRICATED p.99', pubId: 'FABRICATED', page: '99' },
          support: 1,
        },
      });
      assert.equal(revised.json.item.status, 'APPROVED');
      assert.equal(revised.json.item.stem, 'Where does the front sight post sit?');
      assert.equal(revised.json.item.options.length, 3);
      assert.deepEqual(revised.json.item.citation, pre.citation, 'citation is evidence, not content');
      assert.equal(revised.json.item.support, pre.support, 'support is measured, never rewritten');
      assert.deepEqual(revised.json.counts, { PENDING: 0, APPROVED: 2, REJECTED: 1 });
      assert.equal(revised.json.readyForLearners, true);

      // The learner-facing delivery read returns only what was ratified.
      const delivered = await db.course.findUnique({
        where: { id: deliveryCourseId },
        include: { sections: { include: { items: { where: { status: 'APPROVED' }, orderBy: { createdAt: 'asc' } } } } },
      });
      assert.deepEqual(delivered.sections[0].items.map((item) => item.id), [lesson.id, pre.id]);
    } finally {
      await db.course.deleteMany({ where: { id: { startsWith: course.id } } });
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((entry) => entry.id) } } });
      await db.learningRecord.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } });
      await db.user.deleteMany({ where: { id: { in: [ownerRow.id, otherRow.id] } } });
    }
  },
);

test('evidence handlers enforce the store seam and instructor gates without a database', async () => {
  const saved = [];
  const store = {
    async getStudyPlanInput() {
      return { syllabus: [{ id: 'l1', title: 'Land navigation', due: '2026-02-05', hours: 1 }], asOf: '2026-02-01' };
    },
    async saveStudyPlan(args) {
      saved.push(args);
    },
    async getLearnerProfile() {
      return null;
    },
  };
  const handlers = createEvidenceHandlers({ store });
  const learner = { id: 'learner-1', name: 'Learner', role: 'LEARNER' };

  const plan = await handlers.createStudyPlan(learner, { body: { courseId: 'c1', ics: { dtstamp: '20260101T000000Z' } } });
  assert.equal(plan.status, 201);
  assert.equal(plan.json.persisted, true);
  assert.equal(saved[0].learnerId, 'learner-1');
  assert.match(saved[0].ics, /BEGIN:VCALENDAR/);

  assert.equal(await status(handlers.getProfile(learner)), 404);
  assert.equal(await status(handlers.getAar(learner, { query: { courseId: 'c1' } })), 403);
  assert.equal(await status(handlers.getAnalytics(learner, { query: { scope: 'cohort' } })), 403);
  assert.equal(await status(handlers.getAnalytics(learner, { query: {} })), 501); // seam missing
  assert.equal(await status(handlers.createStudyPlan(learner, { body: {} })), 400);
});

test('cohort handler unions learner membership across attempts and mastery records', async () => {
  const attempts = ['a', 'b', 'c', 'd'].flatMap((learnerId) => [
    { learnerId, objective: 'movement', phase: 'pre', correct: false },
    { learnerId, objective: 'movement', phase: 'post', correct: true },
  ]);
  const sessions = [
    { learnerId: 'd', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
    { learnerId: 'e', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
  ];
  const handlers = createEvidenceHandlers({
    store: {
      async listCohortAttempts() {
        return attempts;
      },
      async listCohortMasteryReports() {
        return sessions;
      },
    },
  });
  const result = await handlers.getAnalytics(
    { id: 'instructor-1', role: 'INSTRUCTOR' },
    { query: { scope: 'cohort', courseId: 'course-1' } },
  );

  assert.equal(result.json.privacy.observedLearners, 5);
  assert.equal(result.json.gain.status, 'insufficient_evidence');
  assert.equal(result.json.gain.observedContributors, 4);
  assert.equal(result.json.mastery.status, 'insufficient_evidence');
  assert.equal(result.json.mastery.observedContributors, 2);
});

test('count-only cohort seam responses fail closed instead of adding unknown counts', async () => {
  const handlers = createEvidenceHandlers({
    store: {
      async listCohortAttempts() {
        return {
          attempts: [
            { objective: 'movement', phase: 'pre', correct: false },
            { objective: 'movement', phase: 'post', correct: true },
          ],
          distinctLearnerCount: 4,
        };
      },
      async listCohortMasteryReports() {
        return {
          sessions: [],
          // This is the same four-person population, but the seam has no IDs
          // with which to prove that overlap.
          distinctLearnerCount: 4,
        };
      },
    },
  });
  const result = await handlers.getAnalytics(
    { id: 'instructor-1', role: 'INSTRUCTOR' },
    { query: { scope: 'cohort', courseId: 'course-1' } },
  );

  assert.equal(result.json.privacy.observedLearners, 0);
  assert.equal(result.json.gain.status, 'insufficient_evidence');
  assert.equal(result.json.mastery.status, 'insufficient_evidence');
});
