import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  draftCourse,
  deriveMasteryPlan,
  generateRubric,
  ingestSource,
  restoreMasterySession,
  serialiseMasterySession,
  startMasterySession,
  terminalSafeScorer,
  tutorAnswer,
  validateCourseDraft,
  validateCourseOutline,
  validateMasteryPlan,
} from '../lib/arsenal-core.js';
import { learnerCourseProjection, savedMasteryView, sourceDocuments } from '../lib/learning/core.js';
import { matchesApprovedMasteryPlan } from '../lib/db.js';

const upstream = (name) => import(name);

const groundedSource = {
  id: 'source-record-1',
  status: 'APPROVED',
  payload: {
    title: 'Safety standard',
    sourceId: 'safety-standard',
    text: 'A safety check is required before operation. The operator confirms the check before starting.',
    pages: [
      {
        page: 1,
        text: 'A safety check is required before operation. The operator confirms the check before starting.',
      },
    ],
  },
};

function groundedCourse(overrides = {}) {
  return {
    title: 'Safety course',
    sections: [
      {
        title: 'Safety check',
        cite: 'safety-standard',
        lesson: 'A safety check is required before operation.',
        pre: [
          {
            stem: 'When is a safety check required before operation?',
            options: ['Before operation', 'Never'],
            answer: 0,
          },
        ],
        post: [
          {
            stem: 'What must the operator confirm before starting?',
            options: ['The safety check', 'Nothing'],
            answer: 0,
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('course draft boundary rejects refusal-only, empty, uncited, and ungrounded output', () => {
  const valid = validateCourseDraft(groundedCourse(), { sources: [groundedSource] });
  assert.deepEqual(valid, { valid: true, issues: [] });

  for (const [label, course] of [
    [
      'refused',
      {
        title: 'Refused',
        sections: [{ title: 'Safety', cite: 'safety-standard', refused: true, reason: 'unsupported' }],
      },
    ],
    ['empty', { title: 'Empty', sections: [] }],
    [
      'uncited',
      {
        ...groundedCourse(),
        sections: [{ ...groundedCourse().sections[0], cite: '' }],
      },
    ],
    [
      'ungrounded',
      {
        ...groundedCourse(),
        sections: [{
          ...groundedCourse().sections[0],
          lesson: 'The orbital engine requires a ceramic seal.',
        }],
      },
    ],
  ]) {
    const result = validateCourseDraft(course, { sources: [groundedSource] });
    assert.equal(result.valid, false, `${label} draft must stay pending`);
    assert.ok(result.issues.length > 0);
  }
});

test('saved mastery view uses report competency shape and strips rubric indicators', () => {
  const record = {
    id: 'session-1',
    status: 'COMPLETE',
    version: 2,
    payload: {
      courseId: 'course-1',
      sourceId: 'source-1',
      currentQuestion: 'Should be hidden after completion',
      report: {
        complete: true,
        score: 100,
        criteria: [{
          competency: 'Safety check',
          verdict: 'mastered',
          indicators: { mastered: 'private answer key' },
        }],
      },
      complete: false,
      rubric: [{ elo: 'Safety check', indicators: { mastered: 'private answer key' } }],
      transcript: [{ role: 'user', text: 'Before operation.' }],
    },
  };
  const view = savedMasteryView(record);
  assert.deepEqual(view.criteria, [{ competency: 'Safety check', verdict: 'mastered' }]);
  assert.deepEqual(view.report.criteria, [{ competency: 'Safety check', verdict: 'mastered' }]);
  assert.equal(view.currentQuestion, null);
  assert.equal(JSON.stringify(view).includes('private answer key'), false);
});

test('real production scorer: restored and fresh sessions finish, then reload completed', () => {
  const result = spawnSync(process.execPath, ['test/fixtures/mastery-production.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      MODEL_BASE_URL: 'https://whetstone.invalid',
      MODEL_ID: 'fixture-model',
      WHETSTONE_ENDPOINT: 'https://whetstone.invalid/chat/completions',
      WHETSTONE_MODEL: 'fixture-model',
      WHETSTONE_API_KEY: 'fixture-not-a-credential',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('terminal correction changes only the exact final-mastered index mismatch', async () => {
  const criteria = [{ elo: 'first' }, { elo: 'last' }];
  const turn = { criteria, eloIndex: 1 };
  const buggy = { verdict: 'mastered', mastered: true, complete: true, nextEloIndex: 1, score: 100 };
  const corrected = await terminalSafeScorer({ scoreTurn: async () => buggy })(turn);
  assert.deepEqual(corrected, { ...buggy, nextEloIndex: 2 });
  assert.equal(buggy.nextEloIndex, 1, 'do not mutate scorer output');
  for (const [input, output] of [
    [{ ...turn, eloIndex: 0 }, { ...buggy, nextEloIndex: 0 }],
    [turn, { ...buggy, verdict: 'competent' }],
    [turn, { ...buggy, mastered: false }],
    [turn, { ...buggy, complete: false }],
    [turn, { ...buggy, nextEloIndex: 0 }],
    [turn, { ...buggy, nextEloIndex: '1' }],
    [turn, { ...buggy, nextEloIndex: 2 }],
    [turn, { ...buggy, nextEloIndex: 3 }],
    [turn, { ...buggy, error: 'provider failed' }],
    [{ ...turn, eloIndex: '1' }, buggy],
    [{ criteria: [], eloIndex: -1 }, buggy],
    [{ criteria: null, eloIndex: 0 }, buggy],
    [turn, null],
  ]) {
    assert.strictEqual(await terminalSafeScorer({ scoreTurn: async () => output })(input), output);
  }
  const error = new Error('scorer rejected');
  await assert.rejects(terminalSafeScorer({ scoreTurn: async () => { throw error; } })(turn), e => e === error);
});

test('inconsistent early completion still reaches real Session validation', async () => {
  const w = await import('whetstone');
  const session = new w.Session({
    objectives: 'Two checks', source: 'Check first, then second.',
    deriveRubric: async () => ({ criteria: [{ elo: 'first' }, { elo: 'second' }] }),
    firstQuestion: async () => ({ question: 'First?' }),
    scorer: terminalSafeScorer({ scoreTurn: async () => ({
      verdict: 'mastered', mastered: true, complete: true, nextEloIndex: 0, score: 50,
    }) }),
  });
  await session.start();
  await assert.rejects(() => session.answer('First.'), /inconsistent with nextEloIndex/);
  assert.equal(session.complete, false);
  assert.equal(session.eloIndex, 0);
});

test('Quarry source ingestion preserves printed pages and chunks', async () => {
  const source = await ingestSource(
    {
      title: 'Contract source',
      sourceId: 'contract-1',
      text: 'Page one. Page two.',
      pages: [
        { page: 7, text: 'Page one.' },
        { page: 8, text: 'Page two.' },
      ],
    },
    { load: upstream },
  );

  assert.deepEqual(
    source.pages.map((page) => page.page),
    [7, 8],
  );
  assert.equal(source.chunks.length, 2);
  assert.equal(source.chunks[1].page, 8);
});

test('Coursewright documents retain page labels and grounding stays on cited passage', () => {
  const record = {
    id: 'source-record-1',
    payload: {
      title: 'Safety standard',
      sourceId: 'safety-standard',
      text: 'A safety check is required before operation. An orbital engine requires a ceramic seal.',
      pages: [
        { page: 7, text: 'A safety check is required before operation.' },
        { page: 8, text: 'An orbital engine requires a ceramic seal.' },
      ],
      chunks: [
        { page: 7, text: 'A safety check is required before operation.' },
        { page: 8, text: 'An orbital engine requires a ceramic seal.' },
      ],
    },
  };
  assert.deepEqual(
    sourceDocuments(record).map(({ source, text }) => ({ source, text })),
    [
      { source: 'source-record-1 p.7', text: 'A safety check is required before operation.' },
      { source: 'source-record-1 p.8', text: 'An orbital engine requires a ceramic seal.' },
    ],
  );

  const pageScoped = validateCourseDraft(
    {
      ...groundedCourse(),
      sections: [{ ...groundedCourse().sections[0], cite: 'source-record-1 p.8' }],
    },
    { sources: [{ ...record, status: 'APPROVED' }] },
  );
  assert.equal(pageScoped.valid, false);
  assert.ok(pageScoped.issues.some((issue) => issue.includes('not grounded')));
});

test('Coursewright draft uses an injected model and keeps refusal output', async () => {
  const course = await draftCourse(
    {
      title: 'Grounded draft',
      objectives: ['Explain the standard safety check'],
      documents: [{ text: 'The standard requires a safety check.', source: 'contract-1' }],
      diagrams: false,
    },
    {
      load: upstream,
      ask: async () => ({ refused: true, reason: 'contract test refusal' }),
    },
  );

  assert.equal(course.sections.length, 1);
  assert.equal(course.sections[0].refused, true);
  assert.equal(course.sections[0].reason, 'contract test refusal');
});

test('empty objectives derive a grounded outline before Coursewright builds every section', async () => {
  const calls = [];
  const ask = async (model, system) => {
    calls.push({ model, system });
    if (system.includes('instructional designer')) {
      return { objectives: ['Safety check', 'Operator confirms check'] };
    }
    if (system.includes('micro-lesson')) {
      return { lesson: 'A safety check is required before operation.' };
    }
    if (system.includes('"items"') && system.includes('answerIndex')) {
      return {
        items: [
          {
            stem: 'When is a safety check required before operation?',
            options: ['Before operation', 'Never'],
            answerIndex: 0,
            rationale: 'The safety check is required before operation.',
          },
          {
            stem: 'What does the operator confirm before starting?',
            options: ['The safety check', 'Nothing'],
            answerIndex: 0,
            rationale: 'The operator confirms the safety check before starting.',
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return {
        cards: [
          { front: 'What is required before operation?', back: 'A safety check.' },
          { front: 'What does the operator confirm?', back: 'The safety check.' },
          { front: 'When does the operator confirm it?', back: 'Before starting.' },
        ],
      };
    }
    if (system.includes('applied scenario')) {
      return {
        situation: 'A safety check is required before operation.',
        task: 'Confirm the safety check before starting.',
        coaching: 'The operator confirms the check before starting.',
      };
    }
    if (system.includes('discussion prompts')) {
      return { prompts: ['Why is a safety check required before operation?'] };
    }
    if (system.includes('summarize')) {
      return { summary: 'The course covers the safety check required before operation.' };
    }
    throw new Error(`unexpected Coursewright prompt: ${system}`);
  };
  const course = await draftCourse(
    {
      title: 'Generated from POI',
      objectives: [],
      documents: [{
        source: 'poi-1',
        text: 'A safety check is required before operation. The operator confirms the check before starting.',
      }],
      diagrams: false,
    },
    { load: upstream, ask },
  );

  assert.equal(calls[0].model, 'coursewright-outline');
  assert.equal(calls[0].system.includes('approved source passages'), true);
  assert.deepEqual(course.objectives, ['Safety check', 'Operator confirms check']);
  assert.equal(course.sections.length, 2);
  assert.deepEqual(course.sections.map((section) => section.title), [
    'Safety check',
    'Operator confirms check',
  ]);
});

test('invalid generated outlines are rejected without silently truncating them', async () => {
  const invalid = validateCourseOutline(
    { objectives: ['Safety check', 'Safety check'] },
    {
      documents: [{ text: 'A safety check is required before operation.' }],
    },
  );
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.includes('duplicates')));

  await assert.rejects(
    () => draftCourse(
      {
        title: 'Invalid outline',
        objectives: [],
        documents: [{ text: 'A safety check is required before operation.' }],
        diagrams: false,
      },
      {
        load: upstream,
        ask: async () => ({ objectives: [] }),
      },
    ),
    (error) => error.code === 'COURSE_OUTLINE_INVALID' && error.status === 422,
  );
});

test('Coursewright skipped objectives fail as partial generation', async () => {
  await assert.rejects(
    () => draftCourse(
      {
        title: 'Partial course',
        objectives: ['Safety check', 'Check before operation'],
        documents: [{ text: 'A safety check is required before operation.' }],
        diagrams: false,
      },
      {
        load: async () => ({
          fromDocuments: async () => ({ sections: [{ title: 'Safety check' }] }),
        }),
        ask: async () => { throw new Error('partial-result fixture does not call a model'); },
      },
    ),
    (error) =>
      error.code === 'COURSE_GENERATION_PARTIAL' &&
      error.validation.expectedSections === 2 &&
      error.validation.actualSections === 1,
  );
});

test('Rubricon validation and traceability run after injected generation', async () => {
  const result = await generateRubric(
    {
      task: {
        code: 'TASK-1',
        title: 'Safety check',
        standard: 'Complete a safety check before operation.',
      },
      sourceText: 'Complete a safety check before operation.',
    },
    {
      load: upstream,
      ask: async () => ({
        flagged: false,
        dimensions: [
          {
            name: 'Safety check',
            source: 'safety check before operation',
            anchors: {
              unsatisfactory: 'Omits the check.',
              satisfactory: 'Completes the safety check.',
              proficient: 'Completes the safety check before operation.',
            },
          },
        ],
      }),
    },
  );

  assert.equal(result.validation.valid, true);
  assert.equal(result.traceability.grounded, true);
});

test('Sourcerer cite-or-refuse keeps the injected citation marker', async () => {
  const answer = await tutorAnswer(
    {
      question: 'What safety check is required?',
      passages: [{ text: 'A safety check is required.', source: 'contract-1 p.7' }],
    },
    {
      load: upstream,
      chat: async (system) =>
        system.includes('strict fact-checker')
          ? { claims: [{ claim: 'A safety check is required.', supported: true }], unsupported: [] }
          : {
              refused: false,
              answer: 'A safety check is required. [1]',
              used: [1],
            },
    },
  );

  assert.equal(answer.refused, false);
  assert.match(answer.answer, /\[1\]/);
  assert.equal(answer.citations[0].source, 'contract-1 p.7');
});

test('tutor adapter preserves errors and clears citations on strict refusals', async () => {
  const unfaithful = await tutorAnswer(
    {
      question: 'What safety check is required?',
      passages: [{ text: 'A safety check is required.', source: 'contract-1 p.7' }],
    },
    {
      load: upstream,
      chat: async (system) =>
        system.includes('strict fact-checker')
          ? {
              claims: [{ claim: 'The answer invents a schedule.', supported: false }],
              unsupported: ['The answer invents a schedule.'],
            }
          : { refused: false, answer: 'A safety check is required. [1]', used: [1] },
    },
  );
  assert.equal(unfaithful.refused, true);
  assert.equal(unfaithful.reason, 'unfaithful');
  assert.deepEqual(unfaithful.citations, []);

  const error = new Error('verification transport failed');
  await assert.rejects(
    () =>
      tutorAnswer(
        {
          question: 'What safety check is required?',
          passages: [{ text: 'A safety check is required.', source: 'contract-1 p.7' }],
        },
        { load: upstream, chat: async () => { throw error; } },
      ),
    (cause) => cause === error,
  );
});

test('Whetstone session progresses with an injected model', async () => {
  const started = await startMasterySession(
    {
      objectives: 'Explain the safety check',
      source: 'A safety check is required before operation.',
      maxTurns: 2,
    },
    {
      load: upstream,
      ask: async (system) => {
        if (system.includes('mastery rubric')) {
          return {
            criteria: [
              {
                elo: 'Safety check',
                indicators: {
                  developing: 'Names a check.',
                  competent: 'Explains the check.',
                  mastered: 'Explains when the check occurs.',
                },
              },
            ],
          };
        }
        if (system.includes('opening mastery question')) {
          return { question: 'When does the safety check occur?' };
        }
        return {
          verdict: 'mastered',
          feedback: 'Correct.',
          followup: '',
        };
      },
    },
  );

  const turn = await started.session.answer('Before operation.');
  assert.equal(turn.complete, true);
  assert.equal(started.session.report().stalled, false);

  const state = serialiseMasterySession(
    started.session,
    'source-1',
    'Explain the safety check',
  );
  let calls = 0;
  const restored = await restoreMasterySession(state, {
    load: upstream,
    ask: async () => {
      calls += 1;
      throw new Error('restore must not generate a new question');
    },
  });
  assert.equal(calls, 0);
  assert.equal(restored.complete, true);
  const saved = serialiseMasterySession(
    started.session,
    'source-1',
    started.session.objectives,
  );
  assert.equal(saved.criteria[0].verdict, 'mastered');
  assert.equal(saved.rubric[0].indicators.mastered, 'Explains when the check occurs.');
});

test('mastery restores mid-session and completes the final criterion via the production scorer path', async () => {
  // Two criteria, so the session is NOT complete after the first answer — the case the
  // single-criterion test above never exercises. Answering on a RESTORED, incomplete
  // session is the exact path the rubric->criteria restore bug broke.
  const rubric = {
    criteria: [
      { elo: 'Name the check', indicators: { developing: 'a', competent: 'b', mastered: 'c' } },
      { elo: 'Explain the timing', indicators: { developing: 'a', competent: 'b', mastered: 'c' } },
    ],
  };
  const ask = async (system) => {
    if (system.includes('rubric')) return rubric;
    if (system.includes('Score the learner')) {
      return { verdict: 'mastered', feedback: 'Correct.', followup: '' };
    }
    return { question: 'Explain the safety check.' }; // firstQuestion (initial + on advance)
  };

  const started = await startMasterySession(
    {
      objectives: 'Explain the safety check',
      source: 'A safety check is required before operation, and it occurs before startup.',
      maxTurns: 6,
    },
    { load: upstream, ask },
  );

  // First criterion mastered -> advance to the second, NOT complete yet.
  const turn1 = await started.session.answer('You name the safety check.');
  assert.equal(turn1.complete, false);
  assert.equal(started.session.eloIndex, 1);

  // Persist mid-session, then restore — the round-trip that used to drop the criteria.
  const state = serialiseMasterySession(started.session, 'source-1', started.session.objectives);
  const restored = await restoreMasterySession(state, { load: upstream, ask });

  // Regression: the restored session must carry its grading criteria. Before the fix these
  // landed on session.rubric, leaving session.criteria === null, so the next answer() threw
  // 'call start() before answer()' and the final criterion could never complete.
  assert.ok(
    Array.isArray(restored.criteria) && restored.criteria.length === 2,
    'restored session must grade on session.criteria',
  );
  assert.equal(restored.complete, false);
  assert.equal(restored.eloIndex, 1);

  // Answer the FINAL criterion on the RESTORED session -> terminal completion.
  const turn2 = await restored.answer('You explain that it occurs before startup.');
  assert.equal(turn2.complete, true);
  assert.equal(restored.complete, true);
  assert.equal(restored.currentQuestion, null);

  const report = restored.report();
  assert.equal(report.complete, true);
  assert.equal(report.stalled, false);
  assert.equal(report.criteria.length, 2);
});

test('terminalSafeScorer corrects the pinned production scoreTurn so the final criterion completes', async () => {
  const w = await import('whetstone');
  // Reproduces the pinned scoreTurn's terminal defect: on final-criterion mastery it returns
  // `complete: true` but leaves `nextEloIndex` at the current index (never advanced).
  const buggyScoreTurn = async ({ eloIndex, criteria }) => ({
    verdict: 'mastered',
    feedback: 'Correct.',
    mastered: true,
    complete: eloIndex + 1 >= criteria.length,
    nextEloIndex: eloIndex, // the bug
    nextQuestion: '',
    score: 1,
  });
  const rubric = { criteria: [{ elo: 'c', indicators: { developing: 'a', competent: 'b', mastered: 'c' } }] };
  const build = (scorer) =>
    new w.Session({
      objectives: 'o',
      source: 's',
      deriveRubric: async () => rubric,
      firstQuestion: async () => ({ question: 'q' }),
      scorer,
    });

  // Raw pinned behavior: Session.answer() rejects the inconsistent terminal turn.
  const broken = build(buggyScoreTurn);
  await broken.start();
  await assert.rejects(() => broken.answer('done'), /inconsistent with nextEloIndex/);

  // Corrective adapter: the same terminal turn now completes cleanly through the real Session.
  const fixed = build(terminalSafeScorer({ scoreTurn: buggyScoreTurn }));
  await fixed.start();
  const turn = await fixed.answer('done');
  assert.equal(turn.complete, true);
  assert.equal(fixed.complete, true);
  assert.equal(fixed.currentQuestion, null);
});

test('shared mastery plans are canonical, grounded, and immutable in injected sessions', async () => {
  const criteria = [
    {
      elo: 'Safety check',
      indicators: {
        developing: 'Names the safety check.',
        competent: 'Explains the safety check.',
        mastered: 'Uses the safety check before operation.',
      },
    },
    {
      elo: 'Operation',
      indicators: {
        developing: 'Names the operation.',
        competent: 'Explains the operation.',
        mastered: 'Performs the operation after the safety check.',
      },
    },
  ];
  const source = 'A safety check is required before operation. The operator performs the operation after the check.';
  const plan = await deriveMasteryPlan(
    { objectives: 'Explain the safety check and operation', source, sourceId: 'source-1' },
    {
      load: upstream,
      deriveRubric: async () => ({ criteria }),
    },
  );
  assert.equal(plan.status, 'PENDING');
  assert.match(plan.revision, /^sha256:/);
  assert.deepEqual(plan.criteria, criteria);
  assert.equal(validateMasteryPlan(plan, { sourceText: source, sourceId: 'source-1' }).valid, true);
  assert.equal(
    validateMasteryPlan(
      {
        ...plan,
        criteria: [{ ...criteria[0], elo: 'Unrelated moon phases' }, criteria[1]],
      },
      { sourceText: source, sourceId: 'source-1' },
    ).valid,
    false,
  );

  const modelCalls = [];
  const ask = async (system) => {
    modelCalls.push(system);
    if (system.includes('opening mastery question')) return { question: 'Explain it.' };
    return { verdict: 'developing', feedback: 'Keep going.', followup: 'Try again.' };
  };
  const started = await startMasterySession(
    {
      objectives: criteria.map((criterion) => criterion.elo),
      source,
      approvedCriteria: plan.criteria,
      masteryPlanRevision: plan.revision,
    },
    { load: upstream, ask },
  );
  assert.deepEqual(started.session.criteria, plan.criteria);
  assert.equal(modelCalls.some((system) => system.includes('mastery rubric')), false);
  const state = serialiseMasterySession(
    started.session,
    'source-1',
    started.session.objectives,
  );
  const restored = await restoreMasterySession(state, {
    load: upstream,
    approvedCriteria: plan.criteria,
    ask: async () => {
      throw new Error('restore must not call the model');
    },
  });
  assert.deepEqual(restored.criteria, plan.criteria);
  assert.equal(restored.masteryPlanRevision, plan.revision);
});

test('learner course projection exposes only approved plan source and revision', () => {
  const pending = learnerCourseProjection({
    sourceIds: ['source-1', 'source-2'],
    masteryPlan: {
      status: 'PENDING',
      sourceId: 'source-2',
      revision: 'pending-revision',
      criteria: [{ elo: 'Private', indicators: { mastered: 'answer key' } }],
    },
  });
  assert.deepEqual(pending.sourceIds, ['source-1', 'source-2']);
  assert.equal(pending.masteryPlan, undefined);

  const approved = learnerCourseProjection({
    sourceIds: ['source-1', 'source-2'],
    masteryPlan: {
      status: 'APPROVED',
      sourceId: 'source-2',
      revision: 'approved-revision',
      criteria: [{ elo: 'Private', indicators: { mastered: 'answer key' } }],
    },
  });
  assert.deepEqual(approved.masteryPlan, {
    status: 'APPROVED',
    sourceId: 'source-2',
    revision: 'approved-revision',
  });
  assert.equal(JSON.stringify(approved).includes('answer key'), false);
});

test('approved cohort plan key excludes legacy and mismatched session evidence', () => {
  const plan = { status: 'APPROVED', sourceId: 'source-2', revision: 'revision-2' };
  assert.equal(
    matchesApprovedMasteryPlan(
      { sourceId: 'source-2', masteryPlanRevision: 'revision-2' },
      plan,
    ),
    true,
  );
  for (const session of [
    { sourceId: 'source-2' },
    { sourceId: 'source-2', masteryPlanRevision: 'legacy' },
    { sourceId: 'source-1', masteryPlanRevision: 'revision-2' },
  ]) {
    assert.equal(matchesApprovedMasteryPlan(session, plan), false);
  }
  assert.equal(matchesApprovedMasteryPlan({ sourceId: 'source-1' }, { status: 'PENDING' }), true);
});