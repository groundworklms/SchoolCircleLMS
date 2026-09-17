import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RUBRIC_STATE_LABELS,
  courseObjectives,
  coverageSummary,
  objectiveCoverage,
  rubricForObjective,
  rubricState,
} from '../app/prototype/rubric-coverage.js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COURSE = {
  title: 'MAGTF intelligence',
  sourceIds: ['source-1'],
  objectives: [
    'Task collection assets against a named requirement',
    'Disseminate intelligence to the supported commander',
    'Assess the reliability of a single-source report',
  ],
};

function rubric(overrides) {
  return {
    id: 'rubric-1',
    status: 'PENDING',
    courseId: 'course-1',
    dimensions: 4,
    flagged: false,
    ...overrides,
  };
}

test('objectives are read from a draft in either shape it is stored in', () => {
  assert.deepEqual(courseObjectives(COURSE), COURSE.objectives);
  // The envelope nests the draft; an older outline stored objects rather than
  // strings. Both have to resolve, or the coverage list is silently empty.
  assert.deepEqual(courseObjectives({ course: COURSE }), COURSE.objectives);
  assert.deepEqual(
    courseObjectives({ objectives: [{ title: 'Heading', objective: 'Do the thing' }, '  Spaced  '] }),
    ['Do the thing', 'Spaced'],
  );
  assert.deepEqual(courseObjectives(null), []);
  assert.deepEqual(courseObjectives({ objectives: 'not a list' }), []);
});

test('a flagged rubric is never reported as a draft on its way to approval', () => {
  assert.equal(rubricState(null), 'none');
  assert.equal(rubricState(rubric({})), 'draft');
  assert.equal(rubricState(rubric({ flagged: true })), 'flagged');
  assert.equal(rubricState(rubric({ status: 'APPROVED' })), 'approved');
  // An approved record cannot also be flagged -- approveRubric refuses that --
  // but if one ever existed, approved must not hide the refusal's meaning by
  // accident: the state machine reads status first because only a human sets it.
  assert.equal(rubricState(rubric({ status: 'APPROVED', flagged: true })), 'approved');
  assert.equal(RUBRIC_STATE_LABELS.flagged, 'Flagged for an SME');
});

test('an objective speaks through its approved rubric, else its newest attempt', () => {
  // The API returns newest first; a refused standard is rewritten and generated
  // again, so an objective routinely carries several rubrics.
  const rubrics = [
    rubric({ id: 'newest-draft' }),
    rubric({ id: 'older-approved', status: 'APPROVED' }),
    rubric({ id: 'first-flagged', flagged: true }),
  ].map((entry) => ({ ...entry, objective: COURSE.objectives[0] }));

  assert.equal(rubricForObjective(rubrics, 'course-1', COURSE.objectives[0]).id, 'older-approved');
  const unapproved = rubrics.filter((entry) => entry.status !== 'APPROVED');
  assert.equal(rubricForObjective(unapproved, 'course-1', COURSE.objectives[0]).id, 'newest-draft');
  // A rubric written for another course, or for no course at all, never
  // answers for this one.
  assert.equal(rubricForObjective(rubrics, 'course-2', COURSE.objectives[0]), null);
  assert.equal(rubricForObjective([rubric({ objective: null })], 'course-1', COURSE.objectives[0]), null);
  assert.equal(rubricForObjective(null, 'course-1', COURSE.objectives[0]), null);
});

test('coverage counts only objectives a human approved a rubric for', () => {
  const rubrics = [
    rubric({ id: 'a', status: 'APPROVED', objective: COURSE.objectives[0] }),
    rubric({ id: 'b', flagged: true, dimensions: 0, objective: COURSE.objectives[1] }),
  ];
  const rows = objectiveCoverage(COURSE, rubrics, 'course-1');
  assert.deepEqual(rows.map((row) => row.state), ['approved', 'flagged', 'none']);
  // The order the course teaches them in, not the order the rubrics were made.
  assert.equal(rows[0].objective, COURSE.objectives[0]);

  const summary = coverageSummary(rows);
  assert.deepEqual(summary, { objectives: 3, assessable: 1, drafted: 0, flagged: 1, missing: 1 });

  // A generated-but-unapproved rubric is not an assessment anyone agreed to.
  const drafted = objectiveCoverage(
    COURSE,
    [rubric({ id: 'c', objective: COURSE.objectives[0] })],
    'course-1',
  );
  assert.equal(coverageSummary(drafted).assessable, 0);
  assert.equal(coverageSummary(drafted).drafted, 1);
  assert.deepEqual(coverageSummary(null), { objectives: 0, assessable: 0, drafted: 0, flagged: 0, missing: 0 });
});

/*
 * The saved-rubric list counted a `criteria` array for years. Rubricon has
 * never produced one -- a rubric carries `dimensions`, a refusal carries
 * `flagged` -- so every rubric ever written was listed as "0 criteria" beside
 * its own six dimensions. Asserted against the source because the count is
 * built in a database handler and the bug was a silent zero, not a failure.
 */
test('the rubric list counts the dimensions Rubricon actually returns', () => {
  const core = fs.readFileSync(path.join(workspace, 'lib/learning/core.js'), 'utf8');
  const listRubrics = core.slice(core.indexOf('export async function listRubrics'));
  const body = listRubrics.slice(0, listRubrics.indexOf('\nasync function ownedRubric'));
  assert.match(body, /dimensions: Array\.isArray\(payload\.rubric\?\.dimensions\)/);
  assert.match(body, /flagged: payload\.rubric\?\.flagged === true/);
  assert.doesNotMatch(body, /payload\.rubric\?\.criteria/);
  // The course objective a rubric judges has to survive to the client, or the
  // coverage above can never be computed.
  assert.match(body, /courseId: payload\.courseId/);
  assert.match(body, /objective: payload\.objective/);
});

/*
 * The Rubrics screen has always offered approved sources only, but the route
 * accepted any source its owner could read. The grounding guarantee has to
 * live in the server that enforces the rest of them.
 */
test('a rubric can only ever be generated from an approved source', () => {
  const core = fs.readFileSync(path.join(workspace, 'lib/learning/core.js'), 'utf8');
  for (const handler of ['export async function suggestRubricTasks', 'export async function generateRubricRecord']) {
    const body = core.slice(core.indexOf(handler), core.indexOf(handler) + 1200);
    assert.match(body, /sourceFor\(identity, sourceId, \{ approvedOnly: true \}\)/, handler);
  }
});
