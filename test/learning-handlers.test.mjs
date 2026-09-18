import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLearningRecord,
  createLearningEvidenceStore,
  db,
  getLearningRecord,
  listLearningRecords,
  updateLearningRecord,
  updateLearningRecordIfVersion,
} from '../lib/db.js';
import {
  approveCourse,
  approveMasteryPlan,
  approveRubric,
  buildCourseRubricsRecord,
  courseReliability,
  generateMasteryPlan,
  getMasterySession,
  getCourse,
  getSource,
  listCourseItems,
  listCourses,
  listMasterySessions,
  listSources,
  masteryTurn,
  rateMasterySession,
  reviewCourseItem,
} from '../lib/learning/core.js';
import { createEvidenceHandlers } from '../lib/learning/evidence.js';
import { errorStatus } from '../lib/learning/http.js';
// A stored RUBRIC record keeps whatever Rubricon's validators said about it,
// and the mastery mapper reads that evidence rather than the status column, so
// the fixtures below produce it with the real validators.
import { validateRubric, verifyTraceability } from 'rubricon';

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
          // approveCourse refuses a section with no lesson page. This fixture
          // predates that gate and was never run, because the Postgres cases in
          // this file had no CI job until the rubric pass needed one.
          pages: [{ title: 'Source text', blocks: [{ type: 'text', text: 'Approved fixture source text.' }] }],
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

      // SCORM export through the real Prisma store. This record was set
      // APPROVED without ever being materialised, so `getApprovedCourse` falls
      // back to the draft payload asserted above -- lesson/pre/post with no
      // item status anywhere in it. Packaging that shipped unratified prose and
      // questions into another LMS; the export now reads the delivery rows, and
      // this release has none, so there is nothing ratified to send.
      const evidence = createEvidenceHandlers({ store });
      assert.equal(
        await status(evidence.exportScorm(instructor, { query: { courseId: approvedCourse.id, version: '1.2' } })),
        409,
      );
      assert.equal(await status(evidence.exportScorm(learner, { query: { courseId: approvedCourse.id } })), 403);

      // Approval materialises the reviewed draft into Course/Section/Item with
      // the source's Anchor id on every citation. It is an optimistic-concurrency
      // write: the reviewed version has to be named, and a version that is not
      // the one on record is refused before any typed row is created.
      const draftVersion = (await getLearningRecord(pendingCourse.id)).version;
      assert.equal(await status(approveCourse(instructor, { params: { id: pendingCourse.id } })), 400);
      assert.equal(
        await status(
          approveCourse(instructor, { params: { id: pendingCourse.id }, body: { version: draftVersion + 1 } }),
        ),
        409,
      );

      const approved = await approveCourse(instructor, {
        params: { id: pendingCourse.id },
        body: { version: draftVersion },
      });
      assert.equal(approved.json.status, 'APPROVED');
      // Only the first release reuses the record id as its delivery course id;
      // every later release mints a new one (below), so the typed rows are read
      // through the id the handler reports rather than the record id.
      assert.equal(approved.json.deliveryCourseId, pendingCourse.id);
      assert.deepEqual(approved.json.materialised, {
        courseId: approved.json.deliveryCourseId,
        sections: 1,
        items: 3,
      });

      // Approving twice is no longer idempotent. Once a release exists there is
      // nothing left to release until a revision is pending, and re-running the
      // materialisation over a live release is exactly what the delivery model
      // forbids -- Attempts and Schedules point at the rows it would rewrite.
      assert.equal(
        await status(
          approveCourse(instructor, { params: { id: pendingCourse.id }, body: { version: approved.json.version } }),
        ),
        409,
      );

      const typed = await db.course.findUnique({
        where: { id: approved.json.deliveryCourseId },
        include: { sections: { include: { items: { orderBy: { id: 'asc' } } } } },
      });
      assert.equal(typed.sourceId, `fixture-approved-source-${suffix}`);
      assert.equal(typed.sections.length, 1);
      // Materialised PENDING: approving the course releases the snapshot, not
      // the items in it. Each one still needs an instructor's decision.
      assert.deepEqual(typed.sections[0].items.map((item) => [item.kind, item.status]), [['LESSON', 'PENDING'], ['QUESTION', 'PENDING'], ['QUESTION', 'PENDING']]);
      assert.equal(typed.sections[0].items[0].citation.pubId, `fixture-approved-source-${suffix}`);

      // The export against the real Prisma read, over a release that has rows.
      // Untouched, every row is PENDING and the export refuses and says so.
      const beforeRatification = await status(
        evidence.exportScorm(instructor, { query: { courseId: pendingCourse.id, version: '1.2' } }),
      );
      assert.equal(beforeRatification, 409);
      // Ratify the lesson and one question, leaving one question PENDING: the
      // subset only leaves the system when it is asked for deliberately.
      await db.item.updateMany({
        where: { id: { in: [typed.sections[0].items[0].id, typed.sections[0].items[1].id] } },
        data: { status: 'APPROVED' },
      });
      assert.equal(
        await status(evidence.exportScorm(instructor, { query: { courseId: pendingCourse.id } })),
        409,
      );
      const partial = await evidence.exportScorm(instructor, {
        query: { courseId: pendingCourse.id, version: '1.2', partial: 'true' },
      });
      assert.equal(partial.headers['content-type'], 'application/zip');
      assert.match(partial.headers['content-disposition'], /PARTIAL-RELEASE\.zip/);
      // What the withheld item's absence looks like on the record; the bytes
      // themselves are asserted zip-level in test/scorm-export.test.mjs.
      const exportRows = await db.learningRecord.findMany({ where: { ownerId: instructor.id, type: 'SCORM_EXPORT' } });
      records.push(...exportRows);
      assert.equal(exportRows.length, 1);
      assert.equal(exportRows[0].payload.courseId, pendingCourse.id);
      assert.equal(exportRows[0].payload.partial, true);
      assert.equal(exportRows[0].payload.ratified.awaiting.total, 1);

      // The replacement release. A pending revision is what makes a second
      // approval legal, and it is materialised on a NEW delivery course id
      // BESIDE the first release -- the id does not persist across releases,
      // deliberately, so an Attempt or Schedule earned against the first
      // release keeps pointing at the rows it was earned against.
      const revision = await createLearningRecord({
        ownerId: instructor.id,
        type: 'COURSE_REVISION',
        status: 'PENDING',
        payload: {
          courseId: pendingCourse.id,
          baseVersion: approved.json.version,
          reviewedVersion: approved.json.version + 1,
          sourceIds: [approvedSource.id],
          course: { ...pendingCourse.payload, title: `Pending ${suffix} v2` },
        },
      });
      records.push(revision);
      const released = await getLearningRecord(pendingCourse.id);
      assert.equal(
        await updateLearningRecordIfVersion(pendingCourse.id, released.version, {
          payload: { ...released.payload, pendingRevisionId: revision.id },
        }),
        true,
      );
      const rereleased = await approveCourse(instructor, {
        params: { id: pendingCourse.id },
        body: { version: released.version + 1 },
      });
      assert.equal(rereleased.json.deliveryCourseId, `${pendingCourse.id}:release:${revision.id}`);
      assert.notEqual(rereleased.json.deliveryCourseId, approved.json.deliveryCourseId);
      assert.equal(rereleased.json.materialised.courseId, rereleased.json.deliveryCourseId);
      assert.ok(await db.course.findUnique({ where: { id: approved.json.deliveryCourseId } }));
      const rereleasedItems = await db.item.findMany({
        where: { section: { courseId: rereleased.json.deliveryCourseId } },
      });
      // A new release re-derives its item ids from the new delivery id, so the
      // whole release starts unratified again rather than inheriting approvals
      // made against content that has since been rewritten.
      assert.deepEqual([...new Set(rereleasedItems.map((item) => item.status))], ['PENDING']);

      assert.equal(
        await status(
          approveCourse(learner, { params: { id: pendingCourse.id }, body: { version: rereleased.json.version } }),
        ),
        404,
      );
    } finally {
      await db.course.deleteMany({ where: { id: { startsWith: pendingCourse.id } } });
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
      // A cross-owner reader is a learner here, and the learner projection no
      // longer redacts the answer key out of a question it still ships -- it does
      // not ship the question. Course approval releases a shape; every sentence
      // inside it stays a PENDING Item until a human ratifies it, so the draft's
      // lesson/pre/post never cross this boundary at all. Asserting the absence of
      // the containers, not of a field inside them, is what pins that.
      assert.equal(crossOwnerView.json.course.sections[0].pre, undefined);
      assert.equal(crossOwnerView.json.course.sections[0].post, undefined);
      assert.equal(crossOwnerView.json.course.sections[0].lesson, undefined);
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
        // Every load-bearing claim has to clear the same deterministic
        // token-grounding floor approveCourse applies (validateCourseDraft),
        // so the stems are worded from the cited passage rather than around it.
        sections: [{
          title: 'Aiming',
          cite: `${source.id} p.1`,
          lesson: 'Sight alignment is the relationship between the post and the aperture.',
          // Same gate, same reason as the fixture above: approveCourse refuses
          // a section with no lesson page.
          pages: [{
            title: 'Aiming',
            blocks: [{ type: 'text', text: 'Sight alignment is the relationship between the post and the aperture.' }],
          }],
          pre: [{
            stem: 'Sight alignment describes the relationship between the post and what?',
            options: ['The stock', 'The aperture'],
            answer: 1,
          }],
          post: [{
            stem: 'Which relationship does sight alignment describe between the post and the aperture?',
            options: ['Trigger to sear', 'Post to aperture'],
            answer: 1,
          }],
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
      // Addressed by what they are, not by position: every item of a release is
      // written in one transaction, so their createdAt values tie and the read
      // order of equal timestamps is not a contract.
      const items = listed.json.sections[0].items;
      const lesson = items.find((item) => item.kind === 'LESSON');
      const pre = items.find((item) => item.stem.startsWith('Sight alignment describes'));
      const post = items.find((item) => item.stem.startsWith('Which relationship'));
      assert.ok(lesson && pre && post);
      assert.deepEqual(items.map((i) => i.status), ['PENDING', 'PENDING', 'PENDING']);

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
      assert.deepEqual(
        delivered.sections[0].items.map((item) => item.id).sort(),
        [lesson.id, pre.id].sort(),
      );
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

/* An instructor's approved rubric is the plan their learners are graded
 * against. Everything below is the wiring between the rubrics screen and the
 * mastery plan -- which approved rubric answers which objective, and what has
 * to be true before one is allowed to. */
const RUBRIC_SOURCE_TEXT = [
  'The gunner confirms the weapon is clear before handling it.',
  'The gunner announces a misfire and waits five seconds before opening the feed tray cover.',
  'The assistant gunner keeps the belt flat and free of twists while feeding the weapon.',
].join(' ');

function clearingDimensions() {
  return [
    {
      name: 'Confirms the weapon is clear before handling',
      source: 'confirms the weapon is clear before handling it',
      anchors: {
        unsatisfactory: 'Handles the weapon before it is confirmed clear.',
        satisfactory: 'Confirms the weapon is clear before handling it.',
        proficient: 'Confirms the weapon is clear and announces it before handling it.',
      },
    },
    {
      name: 'Announces a misfire before opening the feed tray cover',
      source: 'announces a misfire and waits five seconds',
      anchors: {
        unsatisfactory: 'Opens the feed tray cover without announcing the misfire.',
        satisfactory: 'Announces a misfire and waits five seconds before opening the feed tray cover.',
        proficient: 'Announces a misfire, waits five seconds, then opens the feed tray cover.',
      },
    },
  ];
}

/* What generateRubric stores beside a rubric: Rubricon's own verdicts, kept so
 * a later reader can re-ask the questions approveRubric asked instead of
 * trusting a status column any write path can set. Produced here rather than
 * hand-written, so a flagged rubric carries Rubricon's real answer for one --
 * valid, grounded and 100% covered, all of it true about zero dimensions. */
function rubricEvidence(rubric, sourceTextForRubric = RUBRIC_SOURCE_TEXT) {
  return {
    rubric,
    validation: validateRubric(rubric),
    traceability: verifyTraceability(rubric, sourceTextForRubric),
  };
}

test(
  'an approved rubric becomes the course mastery plan, and nothing else does',
  { skip: !databaseReady },
  async () => {
    const suffix = `rubric-plan-${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Rubric Plan Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `rubric-plan-${suffix}` },
    });
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const records = [];
    const clearing = 'Clear and handle the weapon safely';
    const feeding = 'Feed the weapon without inducing a stoppage';

    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Rubric plan source ${suffix}`,
        sourceId: `rubric-plan-source-${suffix}`,
        text: RUBRIC_SOURCE_TEXT,
        pages: [{ page: 1, text: RUBRIC_SOURCE_TEXT }],
        chunks: [{ page: 1, text: RUBRIC_SOURCE_TEXT }],
      },
    });
    const otherSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Unrelated source ${suffix}`,
        sourceId: `unrelated-source-${suffix}`,
        text: 'The armourer records every weapon serial number in the logbook.',
        pages: [{ page: 1, text: 'The armourer records every weapon serial number in the logbook.' }],
      },
    });
    records.push(source, otherSource);

    // One course whose every objective has an approved rubric, and one whose
    // only objective has nothing a human has signed.
    const ratifiedCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Ratified course ${suffix}`,
        sourceIds: [source.id, otherSource.id],
        objectives: [clearing],
      },
    });
    const flaggedCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Flagged course ${suffix}`,
        sourceIds: [source.id],
        objectives: [feeding],
      },
    });
    records.push(ratifiedCourse, flaggedCourse);

    const approvedRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      status: 'APPROVED',
      payload: {
        sourceId: source.id,
        courseId: ratifiedCourse.id,
        objective: clearing,
        ...rubricEvidence({ flagged: false, dimensions: clearingDimensions() }),
      },
    });
    // Approved, for the right objective -- but recorded against a document this
    // plan is not grounded against. Its evidence is deliberately left as clean
    // as the rubric above's, so the ONLY thing that can exclude it is the
    // source filter.
    const foreignRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      status: 'APPROVED',
      payload: {
        sourceId: otherSource.id,
        courseId: ratifiedCourse.id,
        objective: clearing,
        ...rubricEvidence({ flagged: false, dimensions: clearingDimensions() }),
      },
    });
    // Rubricon refused to anchor this standard. approveRubric will not approve
    // it; the row is forced APPROVED anyway so the mastery path has to prove it
    // refuses a flagged rubric on its own, not by relying on the status column.
    const flaggedRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      payload: {
        sourceId: source.id,
        courseId: flaggedCourse.id,
        objective: feeding,
        ...rubricEvidence({ flagged: true, reason: 'Too subjective to anchor.', needsSME: 'Define a stoppage.' }),
      },
    });
    records.push(approvedRubric, foreignRubric, flaggedRubric);

    try {
      // The front door: a flagged rubric is not approvable, ever.
      assert.equal(await status(approveRubric(instructor, { params: { id: flaggedRubric.id } })), 409);
      await updateLearningRecord(flaggedRubric.id, { status: 'APPROVED' });

      // No model is configured in tests, so reaching the model at all is a 503.
      // That is the assertion: the flagged rubric did NOT supply the criteria.
      assert.equal(
        await status(
          generateMasteryPlan(instructor, {
            params: { id: flaggedCourse.id },
            body: { sourceId: source.id },
          }),
        ),
        503,
      );

      // The same defect one step subtler: a rubric that is not flagged, whose
      // anchors still overlap the source, but that never passed structural
      // validation -- so approveRubric would have refused it. The status column
      // says APPROVED; the stored evidence says otherwise, and the mapper reads
      // the evidence. Every objective on this course is covered, so no model
      // call is available to hide behind: a 201 here would mean the plan was
      // built from a rubric no human could have approved.
      const soundPayload = (await getLearningRecord(approvedRubric.id)).payload;
      await updateLearningRecord(approvedRubric.id, {
        payload: {
          ...soundPayload,
          validation: { valid: false, flagged: false, issues: ['dimension 2 (…) has indistinct tiers'] },
        },
      });
      assert.equal(
        await status(
          generateMasteryPlan(instructor, {
            params: { id: ratifiedCourse.id },
            body: { sourceId: source.id },
          }),
        ),
        422,
      );
      await updateLearningRecord(approvedRubric.id, { payload: soundPayload });

      // The ratified course generates without a model call at all.
      const generated = await generateMasteryPlan(instructor, {
        params: { id: ratifiedCourse.id },
        body: { sourceId: source.id },
      });
      assert.equal(generated.status, 201);
      assert.equal(generated.json.provenance.origin, 'RATIFIED');
      assert.deepEqual(
        generated.json.masteryPlan.criteria.map((criterion) => criterion.elo),
        clearingDimensions().map((dimension) => dimension.name),
      );
      assert.deepEqual(generated.json.masteryPlan.criteria[0].indicators, {
        developing: clearingDimensions()[0].anchors.unsatisfactory,
        competent: clearingDimensions()[0].anchors.satisfactory,
        mastered: clearingDimensions()[0].anchors.proficient,
      });
      // The newest approved rubric written from THIS source, not the one
      // approved against another document.
      const rubricIds = generated.json.provenance.rubricIds;
      assert.deepEqual(rubricIds, [approvedRubric.id]);
      assert.ok(!rubricIds.includes(foreignRubric.id));

      // Approval keeps the instructor's name on the criteria it persists.
      const approvedPlan = await approveMasteryPlan(instructor, {
        params: { id: ratifiedCourse.id },
        body: { revision: generated.json.revision },
      });
      assert.equal(approvedPlan.json.masteryPlan.status, 'APPROVED');
      assert.equal(approvedPlan.json.masteryPlan.provenance.origin, 'RATIFIED');
      assert.equal(
        approvedPlan.json.masteryPlan.criteria[0].provenance.rubricId,
        approvedRubric.id,
      );
      assert.equal(approvedPlan.json.masteryPlan.criteria[0].provenance.objective, clearing);
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await db.user.deleteMany({ where: { id: instructorRow.id } });
    }
  },
);

/*
 * The rubric pass, called the way the route calls it.
 *
 * This is deliberately an end-to-end handler test rather than another test of
 * the pure module beside it. A route in this repo is one line that forwards to
 * a handler, so a handler referring to something it never imported passes every
 * unit test underneath it and throws the first time anyone presses the button
 * -- which is exactly how requireAnyRole reached main. The only test that
 * catches that class is one that actually runs the function.
 */
test(
  'a generated course gets one BARS rubric per taught objective, pending approval',
  { skip: !databaseReady },
  async () => {
    const suffix = `course-rubrics-${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Rubric Pass Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `rubric-pass-${suffix}` },
    });
    const otherRow = await db.user.create({
      data: { name: `Other Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `rubric-pass-other-${suffix}` },
    });
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const stranger = { id: otherRow.id, name: otherRow.name, role: 'INSTRUCTOR' };
    const records = [];

    const clearing = 'Clear and handle the weapon safely';
    const feeding = 'Feed the weapon without inducing a stoppage';
    const lessonFor = (line) => `${line} ${RUBRIC_SOURCE_TEXT}`;

    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Rubric pass source ${suffix}`,
        sourceId: `rubric-pass-source-${suffix}`,
        text: RUBRIC_SOURCE_TEXT,
        pages: [{ page: 1, text: RUBRIC_SOURCE_TEXT }],
        chunks: [{ page: 1, text: RUBRIC_SOURCE_TEXT }],
      },
    });
    records.push(source);

    const course = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Rubric pass course ${suffix}`,
        sourceIds: [source.id],
        objectives: [clearing, feeding],
        sections: [
          {
            title: 'Clearing',
            objective: clearing,
            cite: 'Gunnery p.1',
            lesson: lessonFor('Clearing precedes every other action.'),
          },
          {
            title: 'Feeding',
            objective: feeding,
            cite: 'Gunnery p.1',
            lesson: lessonFor('Feeding is the assistant gunner responsibility.'),
          },
          // Too little prose to state a standard from. It must be skipped
          // rather than producing a rubric built out of one sentence.
          { title: 'Stub', objective: 'Something barely taught', cite: 'Gunnery p.2', lesson: 'Short.' },
        ],
      },
    });
    records.push(course);

    // Rubricon's own reply shape. The handler is what is under test, so the
    // model is answered here and every validator downstream of it is real.
    const asked = [];
    const ask = async (task, sourceTextForRubric) => {
      asked.push({ task, sourceTextForRubric });
      return { flagged: false, dimensions: clearingDimensions() };
    };

    try {
      const events = [];
      const first = await buildCourseRubricsRecord(
        instructor,
        { params: { id: course.id } },
        { ask, emit: (event) => events.push(event) },
      );
      assert.equal(first.json.written, 2, 'one per taught objective, and not for the stub section');
      assert.equal(first.json.approvable, 2);
      assert.equal(first.json.flagged, 0);

      const written = await listLearningRecords({ ownerId: instructor.id, type: 'RUBRIC' });
      const mine = written.filter((row) => row.payload?.courseId === course.id);
      assert.equal(mine.length, 2);
      // Nothing here approves anything. A rubric a learner is graded against
      // has to have passed through a person, and this pass fills the queue.
      assert.deepEqual([...new Set(mine.map((row) => row.status))], ['PENDING']);
      assert.deepEqual(
        mine.map((row) => row.payload.objective).sort(),
        [clearing, feeding].sort(),
        'each rubric claims the course objective it judges',
      );
      assert.deepEqual([...new Set(mine.map((row) => row.payload.sourceId))], [source.id]);

      // The standard the model saw is the section's, not the publication's.
      assert.equal(asked.length, 2);
      for (const call of asked) {
        assert.ok(call.task.performanceSteps.length >= 2);
        assert.ok(
          call.sourceTextForRubric.length < RUBRIC_SOURCE_TEXT.length * 3,
          'traceability is checked against the section, not the whole document',
        );
      }

      assert.ok(events.some((event) => event.phase === 'rubrics' && event.status === 'start'));
      const done = events.find((event) => event.phase === 'rubrics' && event.status === 'done');
      assert.equal(done.written, 2);
      assert.deepEqual(
        events.filter((event) => event.kind === 'rubric').map((event) => event.ok),
        [true, true],
      );

      // Resumability. A second pass over the same course writes nothing, which
      // is what makes this safe to re-run after a deploy killed the first.
      const again = await buildCourseRubricsRecord(
        instructor,
        { params: { id: course.id } },
        { ask: async () => { throw new Error('the model must not be asked again'); } },
      );
      assert.equal(again.json.written, 0);
      assert.equal(again.json.skipped, 3);

      // And it is the owner's course, like everything else here.
      assert.equal(
        await status(buildCourseRubricsRecord(stranger, { params: { id: course.id } }, { ask })),
        404,
      );
    } finally {
      const all = await listLearningRecords({ ownerId: instructor.id, type: 'RUBRIC' });
      await db.learningRecord.deleteMany({
        where: { id: { in: [...records.map((record) => record.id), ...all.map((row) => row.id)] } },
      });
      await db.user.deleteMany({ where: { id: { in: [instructorRow.id, otherRow.id] } } });
    }
  },
);

/* Rubricon refusing to invent measurable criteria is a result, not a failure.
   It must be recorded as a rubric an SME has to look at, and it must not be
   counted as one an instructor can approve. */
test(
  'a flagged standard is stored with its reason and reported as needing an SME',
  { skip: !databaseReady },
  async () => {
    const suffix = `course-rubrics-flag-${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Flag Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `rubric-flag-${suffix}` },
    });
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const records = [];
    const objective = 'Display sound judgement under pressure';

    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Flag source ${suffix}`,
        sourceId: `rubric-flag-source-${suffix}`,
        text: RUBRIC_SOURCE_TEXT,
        pages: [{ page: 1, text: RUBRIC_SOURCE_TEXT }],
      },
    });
    const course = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: {
        title: `Flag course ${suffix}`,
        sourceIds: [source.id],
        objectives: [objective],
        sections: [{ title: 'Judgement', objective, cite: 'Gunnery p.1', lesson: RUBRIC_SOURCE_TEXT }],
      },
    });
    records.push(source, course);

    try {
      const events = [];
      const result = await buildCourseRubricsRecord(
        instructor,
        { params: { id: course.id } },
        {
          emit: (event) => events.push(event),
          ask: async () => ({
            flagged: true,
            reason: 'sound judgement is not observable from the sidelines',
            needsSME: 'define what a correct decision looks like at each tier',
          }),
        },
      );
      assert.equal(result.json.written, 1, 'the refusal is recorded rather than dropped');
      assert.equal(result.json.flagged, 1);
      assert.equal(result.json.approvable, 0, 'and it is not offered as ready to approve');

      const stored = (await listLearningRecords({ ownerId: instructor.id, type: 'RUBRIC' }))
        .find((row) => row.payload?.courseId === course.id);
      assert.equal(stored.payload.rubric.flagged, true);
      assert.match(stored.payload.rubric.needsSME, /each tier/);

      const chip = events.find((event) => event.kind === 'rubric');
      assert.equal(chip.ok, false);
      assert.match(chip.reason, /SME/i, 'the screen says what a human has to do');
    } finally {
      const all = await listLearningRecords({ ownerId: instructor.id, type: 'RUBRIC' });
      await db.learningRecord.deleteMany({
        where: { id: { in: [...records.map((record) => record.id), ...all.map((row) => row.id)] } },
      });
      await db.user.deleteMany({ where: { id: instructorRow.id } });
    }
  },
);

/* ------------------------- grader agreement (Rubricon) -------------------- */

/*
 * "Rubric reliability is measured" is one of the four claims this platform
 * makes, and until this landed nothing in the repository called a single one of
 * Rubricon's reliability functions. These run the handlers for real, because a
 * route here is one line and a handler referring to something it never imported
 * passes every unit test beneath it.
 */
test(
  'an instructor rating their own session measures agreement with the grader',
  { skip: !databaseReady },
  async () => {
    const suffix = `reliability-${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Reliability Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `reliability-${suffix}` },
    });
    const otherRow = await db.user.create({
      data: { name: `Reliability Other ${suffix}`, role: 'INSTRUCTOR', externalId: `reliability-other-${suffix}` },
    });
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const stranger = { id: otherRow.id, name: otherRow.name, role: 'INSTRUCTOR' };
    const records = [];

    const course = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: `Reliability course ${suffix}`, sourceIds: [], objectives: [] },
    });
    const session = await createLearningRecord({
      ownerId: instructor.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: course.id,
        complete: true,
        report: {
          complete: true,
          criteria: [
            { competency: 'Frame the problem', verdict: 'mastered' },
            { competency: 'Design the course of action', verdict: 'competent' },
            { competency: 'Wargame the course of action', verdict: 'developing' },
            { competency: 'Compare courses of action', verdict: 'competent' },
          ],
        },
      },
    });
    // Finished, but on a different course: it must not be pooled into this
    // course's figure.
    const elsewhere = await createLearningRecord({
      ownerId: instructor.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: 'a-different-course',
        complete: true,
        report: { complete: true, criteria: [{ competency: 'Something else', verdict: 'mastered' }] },
      },
    });
    records.push(course, session, elsewhere);

    try {
      const before = await courseReliability(instructor, { params: { id: course.id } });
      assert.equal(before.json.rated, 0);
      assert.equal(before.json.unrated, 1, 'one finished session on this course is waiting');
      assert.match(before.json.reliability.reason, /no session has been rated/);

      const rated = await rateMasterySession(instructor, {
        params: { id: session.id },
        body: {
          criteria: [
            { competency: 'Frame the problem', verdict: 'mastered' },
            { competency: 'Design the course of action', verdict: 'competent' },
            // Two disagreements, one of them two tiers wide.
            { competency: 'Wargame the course of action', verdict: 'competent' },
            { competency: 'Compare courses of action', verdict: 'mastered' },
          ],
        },
      });
      assert.equal(rated.json.reliability.n, 4);
      assert.equal(rated.json.reliability.agreement, 0.5);
      assert.equal(typeof rated.json.reliability.kappa, 'number');
      assert.equal(typeof rated.json.reliability.interpretation, 'string');

      // The grader's own verdicts survive the rating. They are half the
      // comparison; overwriting them would destroy it on the next read.
      const stored = await getLearningRecord(session.id);
      assert.deepEqual(
        stored.payload.report.criteria.map((criterion) => criterion.verdict),
        ['mastered', 'competent', 'developing', 'competent'],
      );
      assert.equal(stored.payload.raterVerdicts.length, 4);

      const after = await courseReliability(instructor, { params: { id: course.id } });
      assert.equal(after.json.rated, 1);
      assert.equal(after.json.unrated, 0);
      assert.equal(after.json.reliability.n, 4, 'the session on another course is not pooled in');

      // A session belongs to whoever sat it, and rating is a read of its
      // contents. ownedSession is the same gate every other session read uses.
      assert.equal(
        await status(rateMasterySession(stranger, { params: { id: session.id }, body: { criteria: [] } })),
        404,
      );
      assert.equal(await status(courseReliability(stranger, { params: { id: course.id } })), 404);
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await db.user.deleteMany({ where: { id: { in: [instructorRow.id, otherRow.id] } } });
    }
  },
);

test(
  'a session that was never graded cannot be rated, and an empty rating is refused',
  { skip: !databaseReady },
  async () => {
    const suffix = `reliability-guard-${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Guard Owner ${suffix}`, role: 'INSTRUCTOR', externalId: `reliability-guard-${suffix}` },
    });
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const records = [];

    const course = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: `Guard course ${suffix}`, sourceIds: [], objectives: [] },
    });
    const running = await createLearningRecord({
      ownerId: instructor.id,
      type: 'MASTERY_SESSION',
      status: 'ACTIVE',
      payload: { courseId: course.id, currentQuestion: 'Still going.' },
    });
    const graded = await createLearningRecord({
      ownerId: instructor.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: course.id,
        complete: true,
        report: { complete: true, criteria: [{ competency: 'Frame the problem', verdict: 'mastered' }] },
      },
    });
    records.push(course, running, graded);

    try {
      assert.equal(
        await status(rateMasterySession(instructor, {
          params: { id: running.id },
          body: { criteria: [{ competency: 'Frame the problem', verdict: 'mastered' }] },
        })),
        409,
      );
      // Nothing the session assessed, so nothing to compare: refused rather
      // than stored as a rating of zero criteria.
      assert.equal(
        await status(rateMasterySession(instructor, {
          params: { id: graded.id },
          body: { criteria: [{ competency: 'A criterion this session never had', verdict: 'mastered' }] },
        })),
        422,
      );
      assert.equal(
        await status(rateMasterySession(instructor, { params: { id: graded.id }, body: {} })),
        422,
      );
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((record) => record.id) } } });
      await db.user.deleteMany({ where: { id: instructorRow.id } });
    }
  },
);
