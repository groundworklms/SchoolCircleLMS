import assert from 'node:assert/strict';
import test from 'node:test';

import { createLearningRecord, db } from '../lib/db.js';
import {
  deleteSource,
  getSource,
  getSourcePdf,
  listSources,
} from '../lib/learning/core.js';
import { errorStatus } from '../lib/learning/http.js';
import {
  normalisePdfText,
  publicSourcePayload,
  safePdfFilename,
  sourcePdfRecordFor,
  sourceSummary,
  validatePdfPages,
} from '../lib/source/library.js';

test('source PDF matching normalises whitespace but enforces page count and text', () => {
  const source = {
    id: 'source-1',
    type: 'SOURCE',
    payload: {
      pages: [
        { page: 7, text: 'A safety check is required.\nBefore startup.' },
        { page: 8, text: 'The operator confirms the check.' },
      ],
    },
  };

  assert.equal(
    normalisePdfText(' A safety   check is required.\r\nBefore startup. '),
    'A safety check is required. Before startup.',
  );
  assert.equal(validatePdfPages(source, [
    'A safety check is required.  Before startup.',
    'The operator confirms the check.',
  ]), true);
  assert.throws(
    () => validatePdfPages(source, ['A safety check is required. Before startup.']),
    (error) => error.code === 'SOURCE_PDF_MISMATCH' && error.status === 409,
  );
  assert.throws(
    () => validatePdfPages(source, [
      'A safety check is required. Before startup.',
      'A different page.',
    ]),
    (error) => error.code === 'SOURCE_PDF_MISMATCH' && error.status === 409,
  );
});

test('source responses strip inline binary metadata and PDF filenames are safe', () => {
  const payload = publicSourcePayload({
    title: 'Safety standard',
    nested: {
      bytesBase64: 'must-not-escape',
      originalPdf: { bytes: 'must-not-escape' },
    },
  });
  assert.equal(payload.title, 'Safety standard');
  assert.equal(payload.nested.bytesBase64, undefined);
  assert.equal(payload.nested.originalPdf, undefined);

  assert.equal(
    safePdfFilename(
      { id: 'source-1', payload: { title: 'Fallback title' } },
      { payload: { filename: '../unsafe\r\nname.pdf' } },
    ),
    '_unsafename.pdf',
  );
});

test('SOURCE_PDF rows resolve by source record id without exposing payload bytes', () => {
  const row = {
    id: 'pdf-row',
    type: 'SOURCE_PDF',
    payload: {
      sourceRecordId: 'source-1',
      bytesBase64: 'JVBERi0xLjQK',
    },
  };
  assert.equal(sourcePdfRecordFor('source-1', [row]), row);
  assert.equal(sourcePdfRecordFor('source-2', [row]), null);
});

test('source summaries expose only boolean PDF and removal capabilities', () => {
  const summary = sourceSummary(
    { id: 'source-1', status: 'PENDING' },
    { title: 'Legacy source', sourceId: 'legacy-1', pages: [], chunks: [], bytesBase64: 'secret' },
    { hasPdf: true, canRemove: true },
  );
  assert.deepEqual(summary, {
    id: 'source-1',
    status: 'PENDING',
    title: 'Legacy source',
    sourceId: 'legacy-1',
    pages: 0,
    chunks: 0,
    canRemove: true,
    hasPdf: true,
  });
  assert.equal(JSON.stringify(summary).includes('secret'), false);
});

const databaseReady = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);

test(
  'source ownership, deletion, and PDF authorization stay separated',
  { skip: !databaseReady },
  async () => {
    const owner = { id: `source-owner-${Date.now()}-${process.pid}`, role: 'INSTRUCTOR' };
    const learner = { id: `source-learner-${Date.now()}-${process.pid}`, role: 'LEARNER' };
    const recordIds = [];
    try {
      const approved = await createLearningRecord({
        ownerId: owner.id,
        type: 'SOURCE',
        status: 'APPROVED',
        payload: {
          title: 'Cited source',
          sourceId: 'cited-source',
          text: 'Approved cited text.',
          pages: [{ page: 1, text: 'Approved cited text.' }],
          chunks: [{ page: 1, text: 'Approved cited text.' }],
        },
      });
      const pending = await createLearningRecord({
        ownerId: owner.id,
        type: 'SOURCE',
        status: 'PENDING',
        payload: {
          title: 'Pending source',
          sourceId: 'pending-source',
          text: 'Pending private text.',
          pages: [{ page: 1, text: 'Pending private text.' }],
          chunks: [{ page: 1, text: 'Pending private text.' }],
        },
      });
      const course = await createLearningRecord({
        ownerId: owner.id,
        type: 'COURSE_DRAFT',
        status: 'APPROVED',
        payload: { title: 'Existing course', sourceIds: [approved.id] },
      });
      const pdfBytes = new TextEncoder().encode('%PDF-1.7\ncited');
      const pendingPdfBytes = new TextEncoder().encode('%PDF-1.7\npending');
      const pdf = await createLearningRecord({
        ownerId: owner.id,
        type: 'SOURCE_PDF',
        status: 'STORED',
        payload: {
          sourceRecordId: approved.id,
          filename: 'cited.pdf',
          bytesBase64: Buffer.from(pdfBytes).toString('base64'),
        },
      });
      const pendingPdf = await createLearningRecord({
        ownerId: owner.id,
        type: 'SOURCE_PDF',
        status: 'STORED',
        payload: {
          sourceRecordId: pending.id,
          filename: 'pending.pdf',
          bytesBase64: Buffer.from(pendingPdfBytes).toString('base64'),
        },
      });
      recordIds.push(approved.id, pending.id, course.id, pdf.id, pendingPdf.id);

      const ownerList = await listSources(owner);
      assert.equal(ownerList.json.find((entry) => entry.id === approved.id).canRemove, true);
      assert.equal(ownerList.json.find((entry) => entry.id === pending.id).hasPdf, true);
      const learnerList = await listSources(learner);
      assert.equal(learnerList.json.some((entry) => entry.id === pending.id), false);
      assert.equal(await (async () => {
        try {
          await getSource(learner, { params: { id: pending.id } });
          return 200;
        } catch (error) {
          return errorStatus(error);
        }
      })(), 404);

      const ownerPdf = await getSourcePdf(owner, { params: { id: pending.id } });
      assert.deepEqual([...ownerPdf.body], [...pendingPdfBytes]);
      assert.equal(await (async () => {
        try {
          await getSourcePdf(learner, { params: { id: pending.id } });
          return 200;
        } catch (error) {
          return errorStatus(error);
        }
      })(), 404);
      assert.equal(await (async () => {
        try {
          await deleteSource(learner, { params: { id: approved.id } });
          return 200;
        } catch (error) {
          return errorStatus(error);
        }
      })(), 404);

      // Still cited by an approved course: refused, not silently broken.
      assert.equal(await (async () => {
        try {
          await deleteSource(owner, { params: { id: approved.id } });
          return 200;
        } catch (error) {
          return errorStatus(error);
        }
      })(), 409);

      // Uncited: the source and its stored original both go.
      await deleteSource(owner, { params: { id: pending.id } });
      assert.equal(await (async () => {
        try {
          await getSource(owner, { params: { id: pending.id } });
          return 200;
        } catch (error) {
          return errorStatus(error);
        }
      })(), 404);
      assert.equal(
        await db.learningRecord.count({ where: { id: { in: [pending.id, pendingPdf.id] } } }),
        0,
      );
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: recordIds } } });
    }
  },
);
