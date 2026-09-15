import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { launchPackage } from './runtime-harness.mjs';

// Explicit opt-in: this script writes isolated DEVELOPMENT fixture records.
if (!process.argv.includes('--development') || process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) {
  throw new Error('Use --development in the development workspace only');
}
const { db } = await import('../../lib/server/db.js');
const { createSessionToken } = await import('../../lib/server/session.js');
const { dispatchRequest } = await import('../../lib/server/router.js');
const { default: registry, authBoundary } = await import('../../lib/server/integration.js');
const prefix = `scorm-runtime-${randomUUID()}`;
const users = [];
const report = { evidence: 'Native authorized app contract + simulated SCORM RTE/DOM, not browser or external LMS', externalLms: 'unverified; no authorized access supplied', exports: [], rejections: [], defects: [], cleanup: 'pending' };
const output = `/tmp/${prefix}`;
await mkdir(output);
try {
  for (const role of ['INSTRUCTOR', 'LEARNER', 'INSTRUCTOR']) {
    users.push(await db.user.create({ data: { name: 'Isolated SCORM test identity', role, externalId: `${prefix}-${users.length}` } }));
  }
  const tokens = users.map(user => createSessionToken({ userId: user.id, subject: user.externalId }));
  // Reviewed upstream example, unchanged; illustrative safety content, not doctrine.
  const examplePath = new URL('../example/course.json', import.meta.resolve('cartridge'));
  const source = await readFile(examplePath, 'utf8');
  const course = JSON.parse(source);
  assert.ok(course.lessons.length && course.quiz.every(q => q.options.length > 1));
  report.fixture = { source: 'installed cartridge/example/course.json', sha256: createHash('sha256').update(source).digest('hex'), review: 'All three keyed answers checked against the three supplied lessons; test-only, not operational safety approval.' };
  const variants = {
    approved: { status: 'APPROVED', payload: course },
    pending: { status: 'PENDING', payload: course },
    missing: { status: 'APPROVED', payload: { title: course.title, lessons: [] } },
    refused: { status: 'APPROVED', payload: { title: course.title, sections: [{ title: 'Refused', refused: true, lesson: '', pre: [], post: [] }] } },
  };
  for (const [name, variant] of Object.entries(variants)) {
    await db.learningRecord.create({ data: { id: `${prefix}-${name}`, ownerId: users[0].id, type: 'COURSE_DRAFT', ...variant } });
  }
  async function request(name, version, token = tokens[0]) {
    return dispatchRequest(new Request(`https://schoolcircle.example.test/api/learning/export?courseId=${prefix}-${name}&version=${version}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }), registry, { middleware: [authBoundary] });
  }
  for (const version of ['1.2', '2004']) {
    for (const [name, token, expected] of [
      ['approved', null, 401], ['approved', tokens[1], 403],
      ['approved', tokens[2], 409], ['pending', tokens[0], 409],
      ['missing', tokens[0], 409], ['refused', tokens[0], 409],
    ]) {
      const response = await request(name, version, token);
      assert.ok(response.status >= 400, 'Unapproved or unauthorized export must never succeed');
      if (expected === 401 || expected === 403) assert.equal(response.status, expected);
      else assert.notEqual(response.status, 401, 'Owner-content checks require a verified identity');
      const body = await response.json();
      const result = { version, case: name, identity: token === null ? 'anonymous' : token === tokens[1] ? 'learner' : token === tokens[2] ? 'other instructor' : 'owner', status: response.status, code: body.code };
      report.rejections.push(result);
      if (response.status !== expected) report.defects.push({ ...result, expectedStatus: expected });
    }
    const response = await request('approved', version);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.ok(response.headers.get('x-scorm-version').startsWith(version));
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(`${output}/scorm-${version}.zip`, bytes);
    const runs = [];
    for (const outcome of ['pass', 'fail']) {
      for (const discovery of ['parent', 'opener']) runs.push(await launchPackage(bytes, version, { outcome, discovery }));
    }
    report.exports.push({ version, sha256: createHash('sha256').update(bytes).digest('hex'), runs });
  }
  const audits = await db.learningRecord.findMany({ where: { ownerId: users[0].id, type: 'SCORM_EXPORT' } });
  assert.deepEqual(audits.map(row => row.payload.version).sort(), ['1.2', '2004']);
  assert.ok(audits.every(row => row.payload.courseId === `${prefix}-approved`));
  report.audit = 'Exactly two successful exports; no rejected-export audits';
  if (report.defects.length) process.exitCode = 2;
} catch (error) {
  report.failure = { name: error.name, message: error instanceof assert.AssertionError ? error.message : 'Verification failed; no sensitive diagnostics retained' };
  process.exitCode = 1;
} finally {
  try {
    // Only these newly created identities own anything this run can remove.
    await db.learningRecord.deleteMany({ where: { ownerId: { in: users.map(user => user.id) } } });
    await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    report.cleanup = 'passed';
  } catch {
    report.cleanup = 'failed';
    process.exitCode = 1;
  }
  await db.$disconnect();
  await writeFile(`${output}/evidence.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, exports: report.exports.length, defects: report.defects, failure: report.failure, cleanup: report.cleanup }, null, 2));
}