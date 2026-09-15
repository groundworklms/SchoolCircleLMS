import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLearningRecord,
  db,
  getLearningRecord,
  updateLearningRecordIfVersion,
} from '../lib/db.js';

// Opt in explicitly: CI sets a placeholder DATABASE_URL for prisma generate only.
const databaseReady = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);

test(
  'labelled persistence fixture round-trips LearningRecord and CAS version',
  { skip: !databaseReady },
  async () => {
    const fixture = `fixture-learning-${Date.now()}-${process.pid}`;
    let record;
    try {
      record = await createLearningRecord({
        ownerId: fixture,
        type: 'MASTERY_SESSION',
        status: 'ACTIVE',
        payload: {
          fixture,
          courseId: 'fixture-approved-course',
          objectives: ['fixture objective'],
          criteria: [{ competency: 'fixture objective', verdict: 'mastered' }],
          report: {
            criteria: [{ competency: 'fixture objective', verdict: 'mastered' }],
          },
        },
      });
      const loaded = await getLearningRecord(record.id);
      assert.equal(loaded.ownerId, fixture);
      assert.equal(loaded.payload.report.criteria[0].verdict, 'mastered');
      assert.equal(loaded.version, 0);

      assert.equal(
        await updateLearningRecordIfVersion(record.id, 0, {
          status: 'COMPLETE',
          payload: { ...loaded.payload, complete: true },
        }),
        true,
      );
      const advanced = await getLearningRecord(record.id);
      assert.equal(advanced.status, 'COMPLETE');
      assert.equal(advanced.version, 1);
      assert.equal(await updateLearningRecordIfVersion(record.id, 0, {}), false);
    } finally {
      if (record) {
        await db.learningRecord.delete({ where: { id: record.id } });
      }
    }
  },
);