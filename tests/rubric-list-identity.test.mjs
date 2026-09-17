/*
 * Two saved rubrics that render identically.
 *
 * generateRubric derives an SC-prefixed task code from the title whenever the
 * source carries no real one, on purpose -- so nothing downstream mistakes it
 * for an official 0000-AAA-0000 code. The flip side is that two rubrics
 * written for the same title from that fallback path collide on both title
 * and code, and a saved-rubrics list that shows only title/code/status made
 * those two rows genuinely indistinguishable: same first line, same second
 * line except for a trailing "Draft" vs "Flagged for an SME".
 *
 * Two layers are pinned here:
 *   1. listRubrics already carries createdAt and sourceId per row -- the
 *      collision is a rendering gap, not a missing-data gap, and this test
 *      exists to keep it that way.
 *   2. The row-level component that turns those two fields into something an
 *      instructor reads ("From <source> · Generated <date>"), including the
 *      case a rubric outlives the source it was built from.
 *
 * Requires --experimental-test-module-mocks, same as test/record-admin.test.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, mock, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- listRubrics: the API layer already has the fields ---------------- */

const records = new Map();
let seq = 0;

function seed(id, payload, { status = 'PENDING', ownerId = 'instructor-1', createdAt } = {}) {
  records.set(id, {
    id, ownerId, type: 'RUBRIC', status, payload, version: 0,
    createdAt: createdAt || new Date(2026, 0, 1 + seq++).toISOString(),
  });
  return records.get(id);
}

mock.module('../lib/db.js', {
  namedExports: {
    db: { learningRecord: { findMany: async () => [] } },
    async createLearningRecord() { throw new Error('not used'); },
    async getLearningRecord(id) { return records.get(id) || null; },
    async getLearningRecordsByIds(ids) {
      return new Map([...new Set(ids || [])].map((id) => [id, records.get(id) || null]).filter(([, r]) => r));
    },
    async listLearningRecords(filter) {
      return [...records.values()]
        .filter((r) => !filter?.type || r.type === filter.type)
        .filter((r) => !filter?.ownerId || r.ownerId === filter.ownerId)
        .filter((r) => !filter?.status || r.status === filter.status);
    },
    async updateLearningRecord() { throw new Error('not used'); },
    async updateLearningRecordIfVersion() { throw new Error('not used'); },
    async createCourseRevisionAtomically() { return { committed: false }; },
    async approveCourseAtomically() { throw new Error('not used'); },
    async deleteLearningRecords() { throw new Error('not used'); },
    async listDeliveryCourseItems() { return []; },
    async getDeliveryCourseItem() { return null; },
    async updateDeliveryCourseItem() { return null; },
    async courseEvidenceCount() { return { attempts: 0, schedules: 0, total: 0 }; },
  },
});

const core = await import('../lib/learning/core.js');

const OWNER = { id: 'instructor-1', role: 'INSTRUCTOR' };

beforeEach(() => {
  records.clear();
  seq = 0;
});

test('two colliding rubrics still carry distinct identity through listRubrics', async () => {
  // Same title, same source (payload.task carries no real code, so both
  // derive SC-CONDUCT-MARINE-AIR-01), one drafted from a different source
  // and later flagged -- exactly the pairing the finding describes.
  const task = { code: 'SC-CONDUCT-MARINE-AIR-01', title: 'Conduct Marine Air-Ground Task Force Intelligence Operations' };
  seed('rub-draft', {
    rubric: { task, dimensions: [{ name: 'Collection tasking' }] },
    sourceId: 'source-alpha',
  }, { status: 'PENDING', createdAt: '2026-08-01T09:00:00.000Z' });
  seed('rub-flagged', {
    rubric: { task, flagged: true, reason: 'too vague' },
    sourceId: 'source-bravo',
  }, { status: 'PENDING', createdAt: '2026-09-10T14:30:00.000Z' });

  const { json: rows } = await core.listRubrics(OWNER);
  assert.equal(rows.length, 2);
  const [draft, flagged] = rows[0].id === 'rub-draft' ? [rows[0], rows[1]] : [rows[1], rows[0]];

  // Title and derived code collide -- that part is correct behaviour, not
  // the bug -- so the assertion is on what does NOT collide.
  assert.equal(draft.title, flagged.title);
  assert.equal(draft.taskCode, flagged.taskCode);
  assert.notEqual(draft.createdAt, flagged.createdAt);
  assert.notEqual(draft.sourceId, flagged.sourceId);
  assert.equal(draft.sourceId, 'source-alpha');
  assert.equal(flagged.sourceId, 'source-bravo');
  assert.ok(draft.createdAt < flagged.createdAt, 'the draft is genuinely the older of the two');
});

/* ---------------- the row-level rendering: from data to a readable line ---------------- */

function loadInstructorFeatures(expose) {
  const filename = path.join(workspace, 'app/prototype/InstructorFeatures.js');
  const transformed = transformSync(fs.readFileSync(filename, 'utf8'), {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2019',
      transform: { react: { runtime: 'classic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const reactForModule = {
    ...React,
    // Nothing exposed here is a hook consumer -- RubricProvenance is a plain
    // function of its props, and the helpers below take no hooks at all --
    // so these exist only to satisfy the module's own top-level destructure.
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial ?? null }),
  };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    require(request) {
      if (request === 'react') return reactForModule;
      if (request === '../_learning/useLearning') return { useApiQuery: () => ({}), useApiMutation: () => ({}) };
      if (request === './RowActions') return { RowActions: () => null };
      if (request === './rubric-coverage') return require(path.join(workspace, 'app/prototype/rubric-coverage.js'));
      return require(request);
    },
  };
  const exposed = expose.map((name) => `module.exports[${JSON.stringify(name)}] = ${name};`).join('\n');
  vm.runInNewContext(`${transformed.code}\n${exposed}`, sandbox, { filename });
  return module.exports;
}

test('a rubric row names its source and generation date, not just title and status', () => {
  const { RubricProvenance } = loadInstructorFeatures(['RubricProvenance']);
  const sources = [{ id: 'source-alpha', title: 'MCWP 2-10.1' }];

  const markup = renderToStaticMarkup(React.createElement(RubricProvenance, {
    rubric: { sourceId: 'source-alpha', createdAt: '2026-08-01T09:00:00.000Z' },
    sources,
  }));
  assert.match(markup, /MCWP 2-10\.1/);
  assert.match(markup, /2026/);

  // A rubric can outlive the source it was generated from -- the id is still
  // shown rather than the row silently dropping provenance.
  const orphaned = renderToStaticMarkup(React.createElement(RubricProvenance, {
    rubric: { sourceId: 'source-gone', createdAt: '2026-08-01T09:00:00.000Z' },
    sources,
  }));
  assert.match(orphaned, /source-gone/);

  // Neither field present: no empty separator dangling in the row.
  const bare = renderToStaticMarkup(React.createElement(RubricProvenance, { rubric: {}, sources }));
  assert.equal(bare, '');
});

test('two colliding rows resolve to two different provenance lines', () => {
  const { RubricProvenance } = loadInstructorFeatures(['RubricProvenance']);
  const sources = [
    { id: 'source-alpha', title: 'MCWP 2-10.1' },
    { id: 'source-bravo', title: 'MCRP 2-10B.1' },
  ];
  const draft = renderToStaticMarkup(React.createElement(RubricProvenance, {
    rubric: { sourceId: 'source-alpha', createdAt: '2026-08-01T09:00:00.000Z' },
    sources,
  }));
  const flagged = renderToStaticMarkup(React.createElement(RubricProvenance, {
    rubric: { sourceId: 'source-bravo', createdAt: '2026-09-10T14:30:00.000Z' },
    sources,
  }));
  assert.notEqual(draft, flagged);
});

/* ---------------- the 25-second wait: honest instead of static ---------------- */

test('the auto-fill wait explains itself once it runs long enough to suspect the slow path', () => {
  const { suggestingText, FAST_SUGGESTION_SECONDS } = loadInstructorFeatures([
    'suggestingText', 'FAST_SUGGESTION_SECONDS',
  ]);
  assert.equal(suggestingText(0), 'Reading the task from this source…');
  assert.equal(suggestingText(FAST_SUGGESTION_SECONDS - 1), 'Reading the task from this source…');
  // Past the threshold, it says what is actually happening (the model
  // fallback) and that it is the slower of the two paths -- hedged, since a
  // slow quarry lookup would make the same guess wrong.
  const later = suggestingText(FAST_SUGGESTION_SECONDS);
  assert.match(later, /model/);
  assert.match(later, /slower/);
  assert.match(later, new RegExp(`${FAST_SUGGESTION_SECONDS}s`));
});
