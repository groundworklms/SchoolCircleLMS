import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftCourse,
  generateRubric,
  ingestSource,
  restoreMasterySession,
  serialiseMasterySession,
  startMasterySession,
  tutorAnswer,
} from '../lib/arsenal-core.js';

const upstream = (name) => import(name);

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