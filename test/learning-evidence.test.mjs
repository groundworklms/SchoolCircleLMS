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

test('analytics rejects malformed grouping keys and strips nested attempt payloads', () => {
  const analytics = buildAnalytics({
    cohort: true,
    attempts: [
      {
        learnerId: { learnerId: 'nested-learner' },
        objective: {
          learnerId: 'nested-group-learner',
          answer: 'nested-answer',
          gradedAgainst: 'nested-key',
        },
        phase: 'pre',
        correct: false,
        answer: 'raw-answer',
        gradedAgainst: 'raw-key',
      },
      {
        learnerId: { learnerId: 'nested-learner' },
        objective: { learnerId: 'nested-group-learner' },
        phase: 'post',
        correct: true,
        answer: 'raw-answer',
        gradedAgainst: 'raw-key',
      },
    ],
    sessions: [],
  });

  assert.equal(analytics.privacy.observedLearners, 0);
  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.deepEqual(analytics.gaps, []);
  const serialised = JSON.stringify(analytics);
  for (const secret of ['nested-learner', 'nested-group-learner', 'nested-answer', 'nested-key', 'raw-answer', 'raw-key']) {
    assert.equal(serialised.includes(secret), false);
  }
  assert.equal(serialised.includes('[object Object]'), false);
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

test('cohort membership is the union of attempts and mastery, while each statistic needs contributors', () => {
  const attempts = ['a', 'b', 'c', 'd'].flatMap((learnerId) => [
    { learnerId, objective: 'movement', phase: 'pre', correct: false },
    { learnerId, objective: 'movement', phase: 'post', correct: true },
  ]);
  const analytics = buildAnalytics({
    cohort: true,
    attempts,
    sessions: [
      { learnerId: 'd', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
      { learnerId: 'e', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
    ],
  });

  assert.equal(analytics.privacy.observedLearners, 5);
  assert.equal(analytics.gain.status, 'insufficient_evidence');
  assert.equal(analytics.gain.observedContributors, 4);
  assert.equal(analytics.mastery.status, 'insufficient_evidence');
  assert.equal(analytics.mastery.observedContributors, 2);
  assert.deepEqual(analytics.gaps, []);
  const serialised = JSON.stringify(analytics);
  assert.equal(serialised.includes('"learnerId"'), false);
  assert.equal(serialised.includes('correct'), false);
  assert.equal(serialised.includes('answer'), false);
  assert.equal(serialised.includes('gradedAgainst'), false);
});

test('mastery-only four learners are suppressed but five learners do not invent gain', () => {
  const sessions = (learnerIds) => learnerIds.map((learnerId) => ({
    learnerId,
    criteria: [
      { competency: 'movement', verdict: 'mastered' },
      ...(learnerId === 'a'
        ? [{ competency: 'sparse-competency', verdict: 'developing' }]
        : []),
    ],
  }));
  const four = buildAnalytics({
    cohort: true,
    attempts: [],
    sessions: sessions(['a', 'b', 'c', 'd']),
  });
  assert.equal(four.privacy.observedLearners, 4);
  assert.equal(four.mastery.status, 'insufficient_evidence');
  assert.deepEqual(four.gaps, []);

  const five = buildAnalytics({
    cohort: true,
    attempts: [],
    sessions: sessions(['a', 'b', 'c', 'd', 'e']),
  });
  assert.equal(five.privacy.observedLearners, 5);
  assert.equal(five.gain.status, 'insufficient_evidence');
  assert.equal(five.gain.overall, null);
  assert.ok(Array.isArray(five.mastery));
  assert.equal(JSON.stringify(five.mastery).includes('sparse-competency'), false);
  assert.equal(JSON.stringify(five).includes('"learnerId"'), false);
});

test('cohort gain and objective output suppress disjoint and sparse contributors', () => {
  const attempts = [
    ...['a', 'b', 'c', 'd', 'e'].flatMap((learnerId) => [
      { learnerId, objective: 'movement', phase: 'pre', correct: false },
      { learnerId, objective: 'movement', phase: 'post', correct: true },
    ]),
    { learnerId: 'a', objective: 'sparse-objective', phase: 'pre', correct: false },
    { learnerId: 'a', objective: 'sparse-objective', phase: 'post', correct: true },
  ];
  const analytics = buildAnalytics({
    cohort: true,
    attempts,
    sessions: [],
  });

  assert.equal(analytics.gain.status, undefined);
  assert.ok(analytics.gain.objectives.some((entry) => entry.objective === 'movement'));
  assert.equal(analytics.gain.objectives.some((entry) => entry.objective === 'sparse-objective'), false);
  assert.equal(analytics.gaps.length, 1);
  assert.equal(analytics.privacy.objectiveContributors.suppressed, 1);
  const serialised = JSON.stringify(analytics);
  assert.equal(serialised.includes('sparse-objective'), false);
  assert.equal(serialised.includes('"learnerId"'), false);
});

test('gain calculation excludes unpaired learner attrition from overall and objective rates', () => {
  const paired = ['a', 'b', 'c', 'd', 'e'].flatMap((learnerId) => [
    { learnerId, objective: 'movement', phase: 'pre', correct: false },
    { learnerId, objective: 'movement', phase: 'post', correct: true },
  ]);
  const baseline = buildAnalytics({ cohort: true, attempts: paired, sessions: [] });
  const withAttrition = buildAnalytics({
    cohort: true,
    attempts: [
      ...paired,
      { learnerId: 'attrition', objective: 'movement', phase: 'post', correct: true },
      { learnerId: 'attrition', objective: 'movement', phase: 'post', correct: false },
    ],
    sessions: [],
  });

  assert.deepEqual(withAttrition.gain.overall, baseline.gain.overall);
  assert.deepEqual(withAttrition.gain.objectives, baseline.gain.objectives);
  assert.equal(withAttrition.privacy.observedLearners, 6);
  assert.equal(withAttrition.privacy.gainContributors.observed, 5);
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

test('Cartridge rejects missing citations and mixed producer projections', async () => {
  await assert.rejects(
    () => buildApprovedScorm({
      course: {
        id: 'fixture-uncited',
        title: 'Uncited fixture',
        approved: true,
        lessons: [{ text: 'A lesson with no provenance' }],
        quiz: [],
      },
    }),
    /valid source citation/,
  );
  await assert.rejects(
    () => buildApprovedScorm({
      course: {
        id: 'fixture-mixed',
        title: 'Mixed fixture',
        approved: true,
        sections: [
          { lesson: 'A cited lesson.', cite: 'fixture-source', pre: [{ stem: 'Before?', options: ['A', 'B'], answer: 0 }], post: [{ stem: 'After?', options: ['A', 'B'], answer: 0 }] },
          { items: [] },
        ],
      },
    }),
    /incompatible|non-empty items/,
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
