import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestSource, validateCourseDraft } from '../lib/arsenal-core.js';
import { normaliseCourseIds } from '../lib/learning/course-revisions.js';
import { projectCourseRows } from '../lib/learning/project-course.js';
import {
  DOCTRINE_PAGES,
  GOLDEN_SOURCE_LABEL,
  GOLDEN_SOURCE_RECORD_ID,
  buildGoldenCourseDraft,
  goldenSourceInput,
} from '../scripts/golden-course.mjs';
import {
  GoldenSeedPolicyError,
  assertGoldenSeedEnvironment,
} from '../scripts/seed-golden-course.mjs';

const TARGET_URL = 'postgresql://seed_user:not-a-real-password@127.0.0.1:5432/schoolcircle_dev';

function validEnvironment(overrides = {}) {
  return {
    SCHOOLCIRCLE_DB_ENV: 'development',
    ALLOW_GOLDEN_COURSE_SEED: 'true',
    NODE_ENV: 'development',
    DATABASE_URL: TARGET_URL,
    DATABASE_TARGET_CONFIRM: 'schoolcircle_dev',
    ...overrides,
  };
}

/* ---------------- guards ---------------- */

test('accepts only an explicitly confirmed local development target', () => {
  assert.deepEqual(assertGoldenSeedEnvironment(validEnvironment()), {
    dbEnvironment: 'development',
    nodeEnvironment: 'development',
    databaseName: 'schoolcircle_dev',
  });
});

test('refuses every unsafe target without quoting the connection string', () => {
  const cases = [
    ['unset opt-in', { ALLOW_GOLDEN_COURSE_SEED: undefined }],
    ['production database env', { SCHOOLCIRCLE_DB_ENV: 'production' }],
    ['production node env', { NODE_ENV: 'production' }],
    ['missing database env', { SCHOOLCIRCLE_DB_ENV: undefined }],
    // The database .env.local names is pre-migration and has no _dev suffix,
    // so the default configuration refuses rather than half-seeding it.
    ['unsuffixed database', {
      DATABASE_URL: 'postgresql://seed_user:not-a-real-password@127.0.0.1:5432/schoolcircle',
      DATABASE_TARGET_CONFIRM: 'schoolcircle',
    }],
    ['remote host', {
      DATABASE_URL: 'postgresql://seed_user:not-a-real-password@10.0.0.4:5432/schoolcircle_dev',
    }],
    ['cloud sql connector', { CLOUD_SQL_CONNECTION_NAME: 'project:region:instance' }],
    ['unconfirmed target', { DATABASE_TARGET_CONFIRM: 'schoolcircle_demo' }],
    ['missing confirmation', { DATABASE_TARGET_CONFIRM: undefined }],
    ['malformed url', { DATABASE_URL: 'not-a-database-url' }],
  ];

  for (const [label, overrides] of cases) {
    assert.throws(
      () => assertGoldenSeedEnvironment(validEnvironment(overrides)),
      (error) => {
        assert.equal(error instanceof GoldenSeedPolicyError, true, label);
        assert.equal(error.message.includes('not-a-real-password'), false, label);
        assert.equal(error.message.includes('postgresql://'), false, label);
        return true;
      },
      label,
    );
  }
});

test('a Cloud SQL instance name is refused even when the URL looks local', () => {
  // The connector takes the instance from the env var and ignores the URL host,
  // so the loopback check alone would be describing the wrong connection.
  assert.throws(
    () => assertGoldenSeedEnvironment(validEnvironment({
      CLOUD_SQL_CONNECTION_NAME: 'schoolcircle:us-central1:demo',
    })),
    GoldenSeedPolicyError,
  );
});

/* ---------------- content ---------------- */

test('every doctrine page carries text and a printed page label', () => {
  assert.ok(DOCTRINE_PAGES.length > 0);
  for (const page of DOCTRINE_PAGES) {
    assert.equal(Number.isInteger(page.page) && page.page > 0, true);
    assert.match(page.printed, /^\d{1,2}-\d{1,3}$/);
    assert.equal(page.text.trim().length > 200, true, `page ${page.page} is too short to ground a lesson`);
  }
  const pages = DOCTRINE_PAGES.map((page) => page.page);
  assert.equal(new Set(pages).size, pages.length, 'page numbers must be distinct');
});

test('the banked draft is grounded in the ingested source', async () => {
  // This is the invariant that keeps the seed honest: the same validation the
  // approval route runs, over the passages ingestion actually persists. If the
  // content module drifts from the doctrine it cites, this fails here rather
  // than becoming an ungrounded course in a demo.
  const payload = await ingestSource(goldenSourceInput());
  const source = { id: GOLDEN_SOURCE_RECORD_ID, status: 'APPROVED', payload };
  const validation = validateCourseDraft(
    normaliseCourseIds(buildGoldenCourseDraft()),
    { sources: [source] },
  );
  assert.deepEqual(validation, { valid: true, issues: [] });
});

test('a draft citing a different source record does not validate', async () => {
  const payload = await ingestSource(goldenSourceInput());
  const source = { id: GOLDEN_SOURCE_RECORD_ID, status: 'APPROVED', payload };
  const validation = validateCourseDraft(
    normaliseCourseIds(buildGoldenCourseDraft({ sourceRecordId: 'some-other-record' })),
    { sources: [source] },
  );
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) => issue.includes('does not resolve to a persisted source')),
    true,
  );
});

test('an unapproved source cannot ground the banked draft', async () => {
  const payload = await ingestSource(goldenSourceInput());
  const source = { id: GOLDEN_SOURCE_RECORD_ID, status: 'PENDING', payload };
  const validation = validateCourseDraft(
    normaliseCourseIds(buildGoldenCourseDraft()),
    { sources: [source] },
  );
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.includes('all grounding sources must be approved'), true);
});

test('the draft names exactly the source its citations address', () => {
  const draft = buildGoldenCourseDraft();
  assert.deepEqual(draft.sourceIds, [GOLDEN_SOURCE_RECORD_ID]);
  for (const section of draft.sections) {
    assert.match(section.cite, new RegExp(`^${GOLDEN_SOURCE_RECORD_ID} p\\.\\d+$`));
  }
});

/* ---------------- materialisation ---------------- */

test('materialising the banked course yields only PENDING items', () => {
  // A seeded course must arrive with the human work still to do; per-item
  // ratification is the guardrail, and pre-approving it would demo a product
  // that does not exist.
  const { course, sections } = projectCourseRows(
    'golden-delivery',
    normaliseCourseIds(buildGoldenCourseDraft()),
    { sourceId: GOLDEN_SOURCE_LABEL },
  );
  assert.equal(course.sourceId, GOLDEN_SOURCE_LABEL);
  const items = sections.flatMap((section) => section.items);
  assert.equal(items.length > 0, true);
  assert.deepEqual([...new Set(items.map((item) => item.status))], ['PENDING']);
});

test('every materialised item carries a citation that names a page', () => {
  const { sections } = projectCourseRows(
    'golden-delivery',
    normaliseCourseIds(buildGoldenCourseDraft()),
    { sourceId: GOLDEN_SOURCE_LABEL },
  );
  const pages = new Set(DOCTRINE_PAGES.map((page) => String(page.page)));
  for (const section of sections) {
    for (const item of section.items) {
      assert.equal(item.citation.pubId, GOLDEN_SOURCE_LABEL, item.id);
      // The trailing scenario section is cited at the publication, not a page.
      if (section.id.endsWith(':scenario')) continue;
      assert.equal(pages.has(item.citation.page), true, `${item.id} cites page ${item.citation.page}`);
    }
  }
});
