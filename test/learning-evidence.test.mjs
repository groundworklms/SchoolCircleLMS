import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAar,
  buildAnalytics,
  buildApprovedScorm,
  buildCohortProfile,
  buildProfile,
  buildStudyPlan,
  evaluateFidelity,
} from '../lib/arsenal-evidence.js';

// These are deliberately named fixture records, not production evidence. Route tests must inject
// persisted store records instead of posting these values from a learner or browser.
const FIXTURE_ATTEMPTS = [
  { learnerId: 'fixture-a', objective: 'movement', phase: 'pre', correct: false },
  { learnerId: 'fixture-a', objective: 'movement', phase: 'post', correct: true },
  { learnerId: 'fixture-b', objective: 'movement', phase: 'pre', correct: false },
  { learnerId: 'fixture-b', objective: 'movement', phase: 'post', correct: true },
  { learnerId: 'fixture-c', objective: 'movement', phase: 'pre', correct: true },
  { learnerId: 'fixture-c', objective: 'movement', phase: 'post', correct: true },
];

test('Sextant analytics preserves gain and suppresses a cohort below five learners', () => {
  const analytics = buildAnalytics({ attempts: FIXTURE_ATTEMPTS, sessions: [] });
  assert.equal(analytics.gain.overall.gain, 0.667);
  assert.deepEqual(analytics.gaps, []);
  assert.equal(analytics.privacy.learnerIdsReturned, false);
});

test('whole-cohort suppression covers gain and mastery, not only Sextant gaps', () => {
  const analytics = buildAnalytics({
    cohort: true,
    attempts: FIXTURE_ATTEMPTS,
    sessions: [{ criteria: [{ competency: 'movement', verdict: 'mastered' }] }],
  });
  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.equal(analytics.mastery.status, 'insufficient_evidence');
  assert.deepEqual(analytics.gaps, []);
  assert.equal(analytics.privacy.observedLearners, 3);
});

test('mastery turns and missing correctness never become false pre/post attempts', () => {
  const analytics = buildAnalytics({
    attempts: [{ learnerId: 'fixture-a', phase: 'pre', objective: 'movement' }],
    sessions: [
      { criteria: [{ competency: 'movement', verdict: 'not yet assessed' }] },
    ],
  });
  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.deepEqual(analytics.mastery, []);
  assert.equal(analytics.evidence.mastery.status, 'insufficient_evidence');
});

test('Sextant fixture cohort is emitted only after distinct-learner threshold', () => {
  const attempts = [...FIXTURE_ATTEMPTS];
  for (const learnerId of ['fixture-d', 'fixture-e']) {
    attempts.push({ learnerId, objective: 'movement', phase: 'post', correct: false });
  }
  const analytics = buildAnalytics({ attempts, sessions: [] });
  assert.equal(analytics.gaps.length, 1);
  assert.equal(analytics.gaps[0].cohort, 5);
  assert.equal('learnerId' in analytics.gaps[0], false);
});

test('cohort contributor thresholds suppress disjoint and objective-sparse evidence', () => {
  const attempts = [
    ...['a', 'b', 'c', 'd'].flatMap((learnerId) => [
      { learnerId, objective: 'movement', phase: 'pre', correct: false },
      { learnerId, objective: 'movement', phase: 'post', correct: true },
    ]),
    { learnerId: 'e', objective: 'movement', phase: 'pre', correct: false },
    { learnerId: 'a', objective: 'private-objective', phase: 'pre', correct: false },
    { learnerId: 'a', objective: 'private-objective', phase: 'post', correct: true },
  ];
  const sessions = ['a', 'b', 'c', 'd'].map((learnerId) => ({
    learnerId,
    criteria: [
      { competency: 'movement', verdict: 'mastered' },
      { competency: 'private-competency', verdict: 'developing' },
    ],
  }));
  const analytics = buildAnalytics({
    cohort: true,
    attempts,
    sessions,
    distinctLearnerCount: 5,
  });

  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.equal(analytics.gain.observedContributors, 4);
  assert.deepEqual(analytics.gaps, []);
  assert.equal(analytics.mastery.status, 'insufficient_evidence');
  assert.equal(analytics.mastery.observedContributors, 4);
  assert.equal(JSON.stringify(analytics).includes('"learnerId"'), false);
  assert.equal(JSON.stringify(analytics).includes('"correct"'), false);

  const completeAttempts = [
    ...['a', 'b', 'c', 'd', 'e'].flatMap((learnerId) => [
      { learnerId, objective: 'movement', phase: 'pre', correct: false },
      { learnerId, objective: 'movement', phase: 'post', correct: true },
    ]),
    { learnerId: 'a', objective: 'private-objective', phase: 'pre', correct: false },
    { learnerId: 'a', objective: 'private-objective', phase: 'post', correct: true },
  ];
  const complete = buildAnalytics({
    cohort: true,
    attempts: completeAttempts,
    sessions: [
      ...['a', 'b', 'c', 'd', 'e'].map((learnerId) => ({
        learnerId,
        criteria: [{ competency: 'movement', verdict: 'mastered' }],
      })),
      {
        learnerId: 'a',
        criteria: [{ competency: 'private-competency', verdict: 'developing' }],
      },
    ],
    distinctLearnerCount: 5,
  });
  assert.equal(complete.gain.status, undefined);
  assert.deepEqual(complete.gain.objectives.map((objective) => objective.objective), ['movement']);
  assert.deepEqual(complete.gaps.map((gap) => gap.objective), ['movement']);
  assert.deepEqual(complete.mastery.map((criterion) => criterion.competency), ['movement']);
});

test('cohort gain and every objective require paired contributors, not union membership', () => {
  const attempts = [
    ...['a', 'b', 'c', 'd'].map((learnerId) => ({
      learnerId,
      objective: 'movement',
      phase: 'pre',
      correct: false,
    })),
    { learnerId: 'e', objective: 'movement', phase: 'post', correct: true },
  ];
  const analytics = buildAnalytics({
    cohort: true,
    attempts,
    sessions: [],
    distinctLearnerCount: 5,
  });

  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.equal(analytics.gain.observedContributors, 0);
  assert.deepEqual(analytics.gaps, []);
  assert.equal(analytics.privacy.observedLearners, 5);
});

test('Cadence fixture returns a deterministic recommended plan, reminders, and ICS', () => {
  const result = buildStudyPlan({
    syllabus: [{ id: 'fixture-lesson', title: 'Land navigation', due: '2026-02-05', hours: 1 }],
    availability: 60,
    asOf: '2026-02-01',
    ics: { dtstamp: '20260101T000000Z' },
  });
  assert.equal(result.plan.recommended, 'maintain');
  assert.match(result.ics, /BEGIN:VCALENDAR/);
  assert.match(result.ics, /END:VCALENDAR/);
  assert.equal(result.reminders.length, result.selectedBlocks.length);
});

test('Hotwash fixture creates ranked deterministic AAR without a model', async () => {
  const result = await buildAar({
    critiques: [
      { area: 'brief', kind: 'sustain', iteration: '2026-01' },
      { area: 'brief', kind: 'improve', severity: 5, iteration: '2026-01' },
      { area: 'brief', kind: 'improve', severity: 4, iteration: '2026-02' },
    ],
  });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.modelAvailable, false);
  assert.equal(result.report.improves[0].area, 'brief');
  assert.match(result.memo, /AFTER-ACTION REVIEW/);
});

test('Waypoint fixture profile and cohort preserve unanswered dimensions', () => {
  const one = buildProfile({ responses: { v1: 5, v2: 5, h1: 1, h2: 1 } });
  assert.equal(one.profile.dominantModality, 'visual');
  assert.equal(one.profile.dims.verbal, null);
  const suppressed = buildCohortProfile({ entries: [{ learnerId: 'fixture-a', profile: one.profile }] });
  assert.equal(suppressed.status, 'insufficient_evidence');
  const cohort = buildCohortProfile({
    entries: ['a', 'b', 'c', 'd', 'e'].map((learnerId) => ({ learnerId, profile: one.profile })),
  });
  assert.equal(cohort.status, 'complete');
  assert.equal(cohort.n, 5);
  assert.equal(cohort.dims.verbal, null);
});

test('Waypoint cohort suppresses profile dimension and modality cells below five contributors', () => {
  const responses = [
    { v1: 5, v2: 5 },
    { b1: 5, b2: 5 },
    { r1: 5, r2: 5 },
    { h1: 5, h2: 5 },
    { p1: 5, p2: 5 },
  ];
  const cohort = buildCohortProfile({
    entries: responses.map((value, index) => ({
      learnerId: `cell-${index}`,
      profile: buildProfile({ responses: value }).profile,
    })),
  });

  assert.equal(cohort.status, 'complete');
  assert.equal(cohort.n, 5);
  assert.equal(cohort.dims.visual, null);
  assert.equal(cohort.dims.verbal, null);
  assert.equal(cohort.dims.reading, null);
  assert.equal(cohort.dims.hands_on, null);
  assert.equal(cohort.dims.self_paced, null);
  assert.equal(cohort.dims.structured, null);
  assert.ok(cohort.modalityMix.every((entry) => entry.share === null && entry.count === null));
  assert.deepEqual(cohort.recommendations, []);
});

test('Cartridge fixture is built and validated before it can be exported', async () => {
  const result = await buildApprovedScorm({
    course: {
      id: 'fixture-course',
      title: 'Fixture course',
      approved: true,
      lessons: [{ text: 'A cited lesson', cite: 'Fixture source' }],
      quiz: [{ stem: 'What is tested?', options: ['This'], answer: 0 }],
    },
  });
  assert.equal(result.validation.valid, true);
  assert.ok(Buffer.isBuffer(result.zip));
  assert.ok(result.zip.length > 0);
  await assert.rejects(
    () => buildApprovedScorm({
      course: { id: 'fixture-pending', title: 'Pending fixture', approved: false, lessons: [] },
    }),
    /approved course projection/,
  );
});

test('Cartridge projects real Coursewright lesson/pre/post content and rejects refusals', async () => {
  const result = await buildApprovedScorm({
    course: {
      id: 'fixture-coursewright',
      title: 'Fixture Coursewright',
      approved: true,
      sections: [{
        title: 'Movement',
        cite: 'fixture-doctrine p. 1',
        lesson: 'Movement keeps the unit aligned with the objective.',
        pre: [{ stem: 'What keeps the unit aligned?', options: ['Movement'], answer: 0 }],
        post: [{ stem: 'Which action keeps alignment?', options: ['Movement'], answer: 0 }],
      }],
    },
  });
  assert.equal(result.validation.valid, true);
  assert.equal(result.course.lessons[0].text, 'Movement keeps the unit aligned with the objective.');
  assert.equal(result.course.quiz.length, 2);
  await assert.rejects(
    () => buildApprovedScorm({
      course: {
        id: 'fixture-refusal',
        title: 'Refused fixture',
        approved: true,
        sections: [{ title: 'Empty', lesson: '', pre: [], post: [] }],
      },
    }),
    /COURSE_CONTENT_MISSING|non-empty/,
  );
});

test('Understudy reports explicit unavailable when no model is injected', async () => {
  const result = await evaluateFidelity({
    cases: [{ id: 'fixture-case', situation: 'Hold position', expect: 'Hold position' }],
    persona: 'fixture doctrine cell',
    doctrine: ['Hold position when directed.'],
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.report, null);
});

test('Understudy fixture uses injected agent and independent judge model seams', async () => {
  const result = await evaluateFidelity({
    cases: [{ id: 'fixture-case', situation: 'Hold position', expect: 'Hold position' }],
    persona: 'fixture doctrine cell',
    doctrine: [{ text: 'Hold position when directed.', source: 'fixture-doctrine' }],
    model: async ({ role }) => role === 'agent'
      ? { action: 'Hold position.', rationale: 'The doctrine directs hold position [1].', used: [1] }
      : { verdict: 'in-doctrine', reasons: 'Matches fixture doctrine.' },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.report.scored, 1);
  assert.equal(result.report.fidelity, 1);
});
