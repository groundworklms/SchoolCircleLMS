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
  draftRubricTask,
  looksLikeFrontMatter,
  matchTopK,
  sourcePassageIndex,
  validateCourseOutline,
  validateMasteryPlan,
} from '../lib/arsenal-core.js';
import {
  extractedRubricTasks,
  canViewCourse,
  learnerCourseProjection,
  savedMasteryView,
  sourceDocuments,
  tutor,
} from '../lib/learning/core.js';
import { matchesApprovedMasteryPlan } from '../lib/db.js';
import { projectCourseRows } from '../lib/learning/project-course.js';

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
      // Production Whetstone now rides the shared model, so the shared credential
      // is what authenticates that path.
      MODEL_API_KEY: 'fixture-not-a-credential',
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
  // The refusal reason is still carried out of the injected model, so the
  // contract this test guards is unchanged; it is carried out against the
  // objective it cost rather than on a section that has nothing in it.
  await assert.rejects(
    () => draftCourse(
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
    ),
    (error) =>
      error.code === 'COURSE_GENERATION_EMPTY' &&
      error.message.includes('Explain the standard safety check') &&
      error.message.includes('contract test refusal'),
  );
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

// Two pages of one source, each with its own citation.
const TWO_PAGES = [
  { source: 'record-1 p.1', text: 'Clear the rifle and confirm the chamber is empty before disassembly begins.' },
  { source: 'record-1 p.2', text: 'Carbon buildup on the bolt tail causes a failure to extract during sustained fire.' },
];

// "chamber carbon" is grounded in the sources as a whole -- both words appear --
// so it passes outline validation, but neither page carries enough of it for
// retrieval to ground a section in one passage. That gap is the production
// path: the model wrote twelve objectives and retrieval covered eleven.
function twoPageAsk(objectives) {
  return async (model, system) => {
    if (system.includes('instructional designer')) {
      return { title: 'Rifle maintenance', objectives };
    }
    if (system.includes('micro-lesson')) {
      return { refused: false, lesson: 'Clear the rifle and confirm the chamber is empty before disassembly begins.' };
    }
    if (system.includes('"items"')) {
      return { refused: false, items: [{
        stem: 'What is confirmed before disassembly begins?',
        options: ['The chamber is empty', 'The rifle is loaded'],
        answerIndex: 0,
        rationale: 'Confirm the chamber is empty before disassembly begins.',
      }] };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'What is confirmed before disassembly?', back: 'The chamber is empty.' }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
}

test('an uncovered objective is named, not a reason to throw the whole course away', async () => {
  // An instructor saw "Coursewright generated 11 sections for 12 requested
  // objectives" and no course at all: one objective retrieval could not ground
  // discarded eleven finished sections. The draft is PENDING and needs their
  // review anyway, so keep what was built and name what was not -- the opposite
  // of dropping sections quietly.
  const course = await draftCourse(
    { objectives: [], documents: TWO_PAGES, diagrams: false },
    { load: upstream, ask: twoPageAsk(['Clear the rifle before disassembly begins', 'chamber carbon']) },
  );

  assert.equal(course.sections.length, 1);
  assert.deepEqual(course.objectives, ['Clear the rifle before disassembly begins']);
  assert.deepEqual(course.skippedObjectives, [
    { objective: 'chamber carbon', reason: 'no approved passage covers this objective' },
  ]);
});

test('nothing grounded at all is still an explicit failure, never an empty course', async () => {
  await assert.rejects(
    () => draftCourse(
      { objectives: [], documents: TWO_PAGES, diagrams: false },
      { load: upstream, ask: twoPageAsk(['chamber carbon']) },
    ),
    (error) =>
      error.code === 'COURSE_GENERATION_EMPTY' &&
      error.status === 422 &&
      /chamber carbon/.test(error.message),
  );
});

/* ---------- a refused section costs its objective, not the course ---------- */

/* The live MCWP 2-10 run, reduced to what reproduces it: three objectives,
   three pages that each cover one of them, and a generator that will write two
   and refuse the third. The refusal is the real one -- "the passage identifies
   CI/HUMINT reporting categories ... but its counterintelligence discussion is
   incomplete" -- and it cost two fully grounded, fully cited sections. */
const MAGTF_PAGES = [
  { page: 3, text: 'The six intelligence functions are planning and direction, collection, processing, production, dissemination, and utilization.' },
  { page: 4, text: 'Intelligence preparation of the battlespace has four steps: define the battlespace environment, describe the battlespace effects, evaluate the adversary, and determine adversary courses of action.' },
  { page: 7, text: 'Counterintelligence and human intelligence reporting categories are submitted to the MAGTF commander through the intelligence section.' },
];
const MAGTF_SOURCE = {
  id: 'source-mcwp',
  status: 'APPROVED',
  payload: {
    title: 'MCWP 2-10',
    sourceId: 'mcwp-2-10',
    pages: MAGTF_PAGES,
  },
};
// The documents as sourceDocuments builds them: one per page, cited by the
// record id and page, which is what validateCourseDraft resolves labels against.
const MAGTF_DOCUMENTS = MAGTF_PAGES.map((page) => ({
  source: `${MAGTF_SOURCE.id} p.${page.page}`,
  text: page.text,
}));
const MAGTF_OBJECTIVES = [
  'Identify the six intelligence functions',
  'Describe the four steps of intelligence preparation of the battlespace',
  'Explain how counterintelligence supports the MAGTF commander',
];
const CI_REFUSAL =
  'the passage identifies CI/HUMINT reporting categories but its counterintelligence discussion is incomplete';

/* Teach from the page, verbatim, so nothing here can pass a grounding floor the
   real generator would fail -- except the counterintelligence objective, which
   the generator refuses exactly as it did live. */
function magtfAsk({ refuseAll = false } = {}) {
  const pageFor = (objective) => {
    if (objective.includes('six intelligence functions')) return MAGTF_PAGES[0].text;
    if (objective.includes('four steps')) return MAGTF_PAGES[1].text;
    return MAGTF_PAGES[2].text;
  };
  return async (model, system, prompt) => {
    const objective = (/Objective:\s*(.*)/.exec(prompt)?.[1] || '').trim();
    const refuses = refuseAll || objective.includes('counterintelligence');
    if (system.includes('micro-lesson')) {
      return refuses
        ? { refused: true, reason: CI_REFUSAL }
        : { refused: false, lesson: pageFor(objective) };
    }
    if (system.includes('"items"')) {
      return {
        refused: false,
        items: [{
          stem: 'Which of these does the passage state?',
          options: [pageFor(objective).slice(0, 60), 'None of the above'],
          answerIndex: 0,
          rationale: pageFor(objective),
        }],
      };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'What does the passage state?', back: pageFor(objective) }] };
    }
    // Scenario, discussion and summary are course-level and not what this is about.
    return { refused: true, reason: 'not needed for this fixture' };
  };
}

test('a refused section costs its own objective, not the two that were grounded', async () => {
  const coursewright = await upstream('coursewright');

  // Before: the generator hands back three sections, one of them refused, and
  // the draft boundary fails the whole thing over it -- so nothing is saved and
  // two grounded, cited sections are gone. This is the failure, reproduced.
  const ask = magtfAsk();
  const raw = await coursewright.buildCourse(
    {
      title: 'MAGTF intelligence',
      diagrams: false,
      objectives: MAGTF_OBJECTIVES.map((objective, index) => ({
        objective,
        title: objective,
        passage: MAGTF_PAGES[index].text,
        cite: MAGTF_DOCUMENTS[index].source,
      })),
    },
    undefined,
    { ask },
  );
  assert.equal(raw.sections.length, 3);
  assert.equal(raw.sections[2].refused, true);
  const before = validateCourseDraft(raw, { sources: [MAGTF_SOURCE] });
  assert.equal(before.valid, false);
  assert.ok(before.issues.some((issue) => /section 2 .* is refused/.test(issue)));

  // After: the refusal costs its own objective and nothing else.
  const course = await draftCourse(
    { title: 'MAGTF intelligence', objectives: MAGTF_OBJECTIVES, documents: MAGTF_DOCUMENTS, diagrams: false },
    { load: upstream, ask },
  );
  assert.equal(course.sections.length, 2);
  assert.equal(course.sections.some((section) => section.refused), false);
  assert.deepEqual(course.sections.map((section) => section.title), MAGTF_OBJECTIVES.slice(0, 2));
  // The saved draft claims only what it teaches.
  assert.deepEqual(course.objectives, MAGTF_OBJECTIVES.slice(0, 2));
  // And names what it does not, with the reason the generator gave.
  assert.deepEqual(course.skippedObjectives, [{ objective: MAGTF_OBJECTIVES[2], reason: CI_REFUSAL }]);

  // The gate that discarded it now passes, so the record is created.
  assert.deepEqual(validateCourseDraft(course, { sources: [MAGTF_SOURCE] }), { valid: true, issues: [] });
});

test('a refused section cannot be materialised, because it is not in the draft', async () => {
  const course = await draftCourse(
    { title: 'MAGTF intelligence', objectives: MAGTF_OBJECTIVES, documents: MAGTF_DOCUMENTS, diagrams: false },
    { load: upstream, ask: magtfAsk() },
  );
  const { sections } = projectCourseRows('rec_magtf', course, { sourceId: 'mcwp-2-10' });
  assert.deepEqual(sections.map((section) => section.title), MAGTF_OBJECTIVES.slice(0, 2));
  const stems = sections.flatMap((section) => section.items.map((item) => item.stem));
  assert.equal(stems.some((stem) => /counterintelligence/i.test(stem)), false);
  // A refused section carries no lesson and no questions, so materialising one
  // would write an empty Section row an instructor cannot review or reject.
  assert.ok(sections.every((section) => section.items.length > 0));
});

test('every section refusing is still a hard failure, and says what was not covered', async () => {
  await assert.rejects(
    () => draftCourse(
      { title: 'MAGTF intelligence', objectives: MAGTF_OBJECTIVES, documents: MAGTF_DOCUMENTS, diagrams: false },
      { load: upstream, ask: magtfAsk({ refuseAll: true }) },
    ),
    (error) =>
      error.code === 'COURSE_GENERATION_EMPTY' &&
      error.status === 422 &&
      MAGTF_OBJECTIVES.every((objective) => error.message.includes(objective)) &&
      error.message.includes(CI_REFUSAL),
  );
});

test('dropping a refusal is not a licence to drop a validation failure', async () => {
  // The guard. Only refused/error sections are dropped; everything the draft
  // boundary exists to catch stays fatal, or this fix would be a way for
  // ungrounded content to reach a learner.
  const good = () => ({
    title: MAGTF_OBJECTIVES[0],
    cite: `${MAGTF_SOURCE.id} p.3`,
    lesson: MAGTF_PAGES[0].text,
    pre: [{ stem: 'Which functions?', options: [MAGTF_PAGES[0].text, 'None'], answer: 0, rationale: MAGTF_PAGES[0].text }],
    post: [{ stem: 'Name the functions.', options: [MAGTF_PAGES[0].text, 'None'], answer: 0, rationale: MAGTF_PAGES[0].text }],
  });
  const fatal = [
    ['an ungrounded lesson', { ...good(), lesson: 'The orbital engine requires a ceramic seal before launch.' }],
    ['an unresolvable citation', { ...good(), cite: 'some-other-publication p.1' }],
    ['a missing citation', { ...good(), cite: '' }],
    ['a malformed question', { ...good(), pre: [{ stem: 'Which functions?', options: [], answer: 0 }] }],
    ['a refused section reaching the boundary', { title: MAGTF_OBJECTIVES[2], cite: `${MAGTF_SOURCE.id} p.7`, refused: true, reason: CI_REFUSAL }],
  ];
  for (const [label, section] of fatal) {
    const result = validateCourseDraft(
      { title: 'MAGTF intelligence', sections: [good(), section] },
      { sources: [MAGTF_SOURCE] },
    );
    assert.equal(result.valid, false, `${label} must still stop the draft`);
    assert.ok(result.issues.some((issue) => issue.startsWith('section 1')), label);
  }
});

test('the stream says which objective a refusal cost, and why', async () => {
  const events = [];
  await draftCourse(
    { title: 'MAGTF intelligence', objectives: MAGTF_OBJECTIVES, documents: MAGTF_DOCUMENTS, diagrams: false },
    { load: upstream, ask: magtfAsk(), emit: (event) => events.push(event) },
  );
  // The reason exists only inside the generation callback, so it has to leave
  // on the stream: the modal cannot recover it from the saved record alone.
  const dropped = events.filter((event) => event.step === 'dropped');
  assert.deepEqual(dropped, [{
    phase: 'coursewright',
    step: 'dropped',
    section: MAGTF_OBJECTIVES[2],
    reason: CI_REFUSAL,
  }]);
  // A retrieval skip now carries a reason too, so the screen can list both.
  const skipped = events.find((event) => event.step === 'skipped');
  assert.equal(skipped, undefined);
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

test('student tutor course visibility matches the authenticated course-view convention', async () => {
  const approvedElsewhere = {
    id: 'course-public',
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
    ownerId: 'instructor-1',
  };
  const pendingOwn = {
    id: 'course-pending',
    type: 'COURSE_DRAFT',
    status: 'PENDING',
    ownerId: 'instructor-1',
  };
  // Course list/reader have no roster enrollment filter: approved courses are
  // visible to authenticated learning users. Tutor intentionally shares that
  // rule instead of creating a divergent delivery policy.
  assert.equal(canViewCourse({ id: 'learner-1', role: 'LEARNER' }, approvedElsewhere), true);
  assert.equal(canViewCourse({ id: 'learner-1', role: 'LEARNER' }, pendingOwn), false);
  assert.equal(canViewCourse({ id: 'instructor-1', role: 'INSTRUCTOR' }, pendingOwn), true);
  assert.equal(canViewCourse({ id: 'other-instructor', role: 'INSTRUCTOR' }, pendingOwn), false);

  // Validate the bounded question before any record/model lookup.
  await assert.rejects(
    tutor(
      { id: 'learner-1', role: 'LEARNER' },
      { body: { courseId: 'course-public', question: 'x'.repeat(2_001) } },
    ),
    (error) => error instanceof TypeError && /2000/.test(error.message),
  );
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
// A Coursewright section-generation fixture. Only the outline/title prompts
// differ between the cases below, so they pass their own handler in.
function coursewrightAsk(outlineHandler) {
  const calls = [];
  const ask = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('instructional designer')) return outlineHandler(calls.length, prompt);
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
  return { ask, calls };
}

const SAFETY_DOCUMENT = {
  source: 'poi-1',
  text: 'A safety check is required before operation. The operator confirms the check before starting.',
};

test('the outline prompt states the objective limits the validator enforces', () => {
  // The limit went unstated once and every generated objective came back a
  // paragraph, so all twelve failed at once and the instructor saw only
  // "outline.objectives[0] exceeds 200 characters" twelve times over.
  const { ask, calls } = coursewrightAsk(() => ({ objectives: ['Safety check'] }));
  return draftCourse(
    { title: 'Stated limits', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  ).then(() => {
    assert.match(calls[0].system, /200 characters/);
    assert.match(calls[0].system, /at most 20 objectives/);
  });
});

test('the outline prompt demands one teaching point per objective', () => {
  // Eight of twelve MCDP 2 sections were refused as "the passage supports X,
  // but does not cover Y and Z". No validator can catch a compound objective --
  // five teaching points fit inside the character cap -- so the prompt has to,
  // and the cap alone is not the instruction.
  const { ask, calls } = coursewrightAsk(() => ({ objectives: ['Safety check'] }));
  return draftCourse(
    { title: 'One point each', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  ).then(() => {
    assert.match(calls[0].system, /exactly ONE point/);
    assert.match(calls[0].system, /SEVERAL narrow objectives/);
  });
});

test('an outline the validator rejects is repaired once with the reasons, not failed outright', async () => {
  const tooLong = 'The learner will be able to describe, in complete detail and with reference to every applicable authority, the full sequence of the standard safety check that is required before operation, including the confirmation the operator performs before starting, so that operation never begins without it having been carried out first.';
  assert.ok(tooLong.length > 200, 'fixture must exceed the objective limit');

  const { ask, calls } = coursewrightAsk((call) =>
    call === 1 ? { objectives: [tooLong] } : { objectives: ['Safety check'] });

  const course = await draftCourse(
    { title: 'Repaired outline', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  );

  assert.deepEqual(course.objectives, ['Safety check']);
  const repair = calls[1];
  assert.equal(repair.model, 'coursewright-outline');
  assert.match(repair.prompt, /A previous attempt was rejected/);
  assert.match(repair.prompt, /exceeds 200 characters/);
});

/* ---------- front matter is not grounding ---------- */

// A contents page with the classic dot leaders.
const CONTENTS_WITH_LEADERS = [
  'Table of Contents',
  'Chapter 1. Intelligence and the Marine Corps ............ 1',
  'Chapter 2. The Nature of Intelligence ................... 17',
  'Chapter 3. Intelligence Requirements .................... 33',
  "Chapter 4. Commander's Critical Information Requirements  49",
  'Chapter 5. Collection Management ........................ 65',
  'Appendix A. Intelligence Products ....................... A-1',
].join('\n');

// The same page from an extractor that aligned the page numbers with spaces
// instead. No leaders at all, so only the entry/shape signals are left.
const CONTENTS_WITHOUT_LEADERS = [
  'CONTENTS',
  'Chapter 1  Intelligence and the Marine Corps   1',
  'Chapter 2  The Nature of Intelligence   17',
  'Chapter 3  Intelligence Requirements   33',
  'Chapter 4  Collection Management   49',
  'Chapter 5  Counterintelligence   65',
  'Appendix A  Intelligence Products   A-1',
].join('\n');

// A real page of doctrine, plus the running footer the extractor keeps.
const DOCTRINE_PROSE = [
  'Intelligence is knowledge about the enemy or the surrounding environment needed to support decisionmaking.',
  'It is the product of the collection, processing, and analysis of information. The commander drives intelligence, and the intelligence effort is focused by the intent of the commander.',
  "Commander's critical information requirements are the information requirements the commander identifies as critical to timely decisionmaking.",
  'A priority intelligence requirement is an intelligence requirement associated with a decision that will affect the overall success of the mission.',
  'The latest time the information is of value establishes when a requirement must be answered if the commander is to act on it.',
  'Collection management matches requirements against available capabilities and tasks those capabilities.',
  'MCDP 2 Intelligence',
  '2-7',
].join('\n');

test('front matter is recognised by several agreeing signals, never by one', () => {
  assert.equal(looksLikeFrontMatter(CONTENTS_WITH_LEADERS), true);
  assert.equal(looksLikeFrontMatter(CONTENTS_WITHOUT_LEADERS), true);
  // A contents page extracted as one unbroken blob has no lines to count, but
  // its leaders survive.
  assert.equal(
    looksLikeFrontMatter(
      'Contents Chapter 1. Intelligence....1 Chapter 2. The Nature of Intelligence....17 ' +
        'Chapter 3. Intelligence Requirements....33 Chapter 4. Collection Management....49',
    ),
    true,
  );
});

test('genuine prose is never mistaken for front matter', () => {
  // The expensive error. A false positive silently deletes real doctrine from a
  // course; a false negative only lets one bad passage compete. The running
  // footer and the page number on their own lines must not tip it.
  assert.equal(looksLikeFrontMatter(DOCTRINE_PROSE), false);
  assert.equal(looksLikeFrontMatter(SAFETY_DOCUMENT.text), false);

  // Short lines, numbered headings, no prose sentences -- everything a contents
  // page has except page numbers, which is the signal that actually separates
  // them. A task's performance steps must survive.
  assert.equal(
    looksLikeFrontMatter([
      'PERFORMANCE STEPS:',
      '1. Clear the rifle and confirm the chamber is empty.',
      '2. Disassemble the rifle into its major groups.',
      '3. Clean each group with solvent and a bore brush.',
      '4. Lubricate the bolt carrier group.',
      '5. Reassemble the rifle and perform a function check.',
    ].join('\n')),
    false,
  );

  // Too few lines to judge. Withholding a passage on this little evidence is
  // the error that costs doctrine, so it is not withheld.
  assert.equal(
    looksLikeFrontMatter('Chapter 1  Intelligence  1\nChapter 2  Requirements  17'),
    false,
  );
});

// A contents page whose headings echo the prose page's distinctive wording --
// which is exactly why it wins IDF-weighted retrieval, and exactly the shape
// that refused two live MCDP 2 sections with "the passage is only a table of
// contents". It is listed first so a tie goes to it.
const CONTENTS_DOCUMENT = {
  source: 'poi-1 p.2',
  text: [
    'Table of Contents',
    'Chapter 1. The Safety Check Before Operation ............ 1',
    'Chapter 2. Operator Confirmation Before Starting ........ 17',
    'Chapter 3. Starting and Shutdown ........................ 33',
    'Chapter 4. Maintenance Intervals ........................ 49',
    'Appendix A. Safety Check Worksheet ...................... A-1',
  ].join('\n'),
};

test('a contents page is withheld from both the outline prompt and retrieval', async () => {
  const { ask, calls } = coursewrightAsk(() => ({ objectives: ['Safety check'] }));
  const course = await draftCourse(
    {
      title: 'Grounded in prose',
      objectives: [],
      documents: [CONTENTS_DOCUMENT, SAFETY_DOCUMENT],
      diagrams: false,
    },
    { load: upstream, ask },
  );

  // Withholding it from only one of the two leaves the loop intact: hidden from
  // retrieval it still teaches the model to write heading-shaped objectives,
  // hidden from the outline it still wins retrieval on IDF.
  assert.equal(calls[0].prompt.includes('Maintenance Intervals'), false);
  assert.ok(calls[0].prompt.includes('A safety check is required before operation.'));
  assert.equal(course.sections[0].cite, 'poi-1');
});

test('a document that is all front matter is used unfiltered rather than left with nothing', async () => {
  // The safety rail. Either the heuristic is wrong about this document or the
  // document really is all front matter; either way an instructor can read and
  // reject a generation, and can do nothing at all with an empty one.
  const calls = [];
  const ask = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('instructional designer')) {
      return { title: 'Operations safety', objectives: ['The safety check before operation'] };
    }
    if (system.includes('micro-lesson')) {
      return { refused: false, lesson: 'Chapter 1 covers the safety check before operation.' };
    }
    if (system.includes('"items"')) {
      return { refused: false, items: [{
        stem: 'Which chapter covers the safety check before operation?',
        options: ['Chapter 1', 'Chapter 4'],
        answerIndex: 0,
        rationale: 'Chapter 1 covers the safety check before operation.',
      }] };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'Safety check before operation?', back: 'Chapter 1.' }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };

  const course = await draftCourse(
    { objectives: [], documents: [CONTENTS_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  );

  assert.ok(calls[0].prompt.includes('Maintenance Intervals'), 'the filter was abandoned');
  assert.equal(course.sections.length, 1);
  assert.equal(course.sections[0].cite, 'poi-1 p.2');
});

/* ---------- an objective is grounded in every passage that covers it ---------- */

/* Two pages of the same publication. One says how many steps there are, the
   other names them; neither carries the objective on its own. This is the
   shape that refused nearly every section of a live MCDP 2 run and of a live
   Basic Electronics POI run, both with the same signature: "the passage
   supports X, but does not ..." */
const STEPS_COUNTED = {
  source: 'ipb-1 p.4',
  text: 'Intelligence preparation of the battlespace is a systematic process. The process has four steps.',
};
const STEPS_NAMED = {
  source: 'ipb-1 p.5',
  text: 'The four steps are define the battlespace environment, describe the battlespace effects, evaluate the adversary, and determine adversary courses of action.',
};
/* A page of the same publication about something else entirely: it shares no
   content word with the objective, so it can never clear Coursewright's floor. */
const STEPS_UNRELATED = {
  source: 'ipb-1 p.9',
  text: 'Logistics convoys refuel at the forward arming point before dawn, and drivers rotate every six hours.',
};
const STEPS_OBJECTIVE = 'Identify the four steps of intelligence preparation of the battlespace';
const STEPS_LESSON =
  'The four steps of intelligence preparation of the battlespace are define the battlespace ' +
  'environment, describe the battlespace effects, evaluate the adversary, and determine ' +
  'adversary courses of action.';

// The section fixture for the two-page objective. Coursewright's own grounding
// check decides whether any of it survives; nothing here bypasses it.
function stepsAsk() {
  const calls = [];
  const ask = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('micro-lesson')) return { lesson: STEPS_LESSON };
    if (system.includes('"items"') && system.includes('answerIndex')) {
      return {
        items: [
          {
            stem: 'How many steps does intelligence preparation of the battlespace have?',
            options: ['Four', 'Two'],
            answerIndex: 0,
            rationale: 'The process has four steps.',
          },
          {
            stem: 'Which step evaluates the adversary?',
            options: ['Evaluate the adversary', 'Describe the battlespace effects'],
            answerIndex: 0,
            rationale: 'The four steps are define the battlespace environment, describe the battlespace effects, evaluate the adversary, and determine adversary courses of action.',
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return { cards: [{ front: 'How many steps?', back: 'The process has four steps.' }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
  return { ask, calls };
}

test('one passage covers part of an objective; the section is grounded in all of them', async () => {
  const coursewright = await upstream('coursewright');
  const cited = [STEPS_COUNTED, STEPS_NAMED, STEPS_UNRELATED];

  // Before: the architecture offered exactly one passage per objective, and the
  // one it offers here carries the count but not the names. Coursewright then
  // measures the lesson against that passage and refuses the whole section --
  // this is the refusal, reproduced rather than described.
  const single = coursewright.match(STEPS_OBJECTIVE, cited);
  assert.equal(single.source, 'ipb-1 p.4');
  assert.equal(coursewright.verifyGrounding(STEPS_LESSON, single.text).grounded, false);

  // After: retrieval offers the union, and the same lesson clears the same floor.
  const hits = matchTopK(coursewright.match, STEPS_OBJECTIVE, cited);
  assert.deepEqual(hits.map((hit) => hit.source), ['ipb-1 p.4', 'ipb-1 p.5']);
  assert.equal(
    coursewright.verifyGrounding(STEPS_LESSON, hits.map((hit) => hit.text).join('\n\n')).grounded,
    true,
  );

  const { ask } = stepsAsk();
  const course = await draftCourse(
    {
      title: 'Intelligence preparation of the battlespace',
      objectives: [STEPS_OBJECTIVE],
      documents: cited,
      diagrams: false,
    },
    { load: upstream, ask },
  );

  assert.equal(course.sections.length, 1);
  const [section] = course.sections;
  assert.equal(section.refused, undefined, section.reason);
  assert.equal(section.lesson, STEPS_LESSON);
  // `cite` stays a single string naming the primary -- project-course.js writes
  // it to every materialised Item's citation column.
  assert.equal(typeof section.cite, 'string');
  assert.equal(section.cite, 'ipb-1 p.4');
  assert.deepEqual(section.cites, ['ipb-1 p.4', 'ipb-1 p.5']);
});

test('the section prompt carries the union, in score order', async () => {
  const { ask, calls } = stepsAsk();
  await draftCourse(
    {
      title: 'Intelligence preparation of the battlespace',
      objectives: [STEPS_OBJECTIVE],
      documents: [STEPS_COUNTED, STEPS_NAMED, STEPS_UNRELATED],
      diagrams: false,
    },
    { load: upstream, ask },
  );
  const lesson = calls.find((call) => call.system.includes('micro-lesson'));
  assert.ok(lesson.prompt.includes(`${STEPS_COUNTED.text}\n\n${STEPS_NAMED.text}`));
  // The passage that cleared no floor is not smuggled in alongside them.
  assert.equal(lesson.prompt.includes('Logistics convoys'), false);
});

test('top-K is a ceiling, never a quota', async () => {
  const coursewright = await upstream('coursewright');
  const covering = [
    { source: 'a', text: 'A safety check is required before operation.' },
    { source: 'b', text: 'The safety check is required before every operation.' },
    { source: 'c', text: 'Operation requires a completed safety check.' },
    { source: 'd', text: 'Before operation the safety check is required.' },
    { source: 'e', text: 'A required safety check precedes operation.' },
    { source: 'f', text: 'The operation begins after the required safety check.' },
  ];
  const objective = 'The safety check required before operation';

  // Six passages clear the floor; four is the cap.
  assert.equal(matchTopK(coursewright.match, objective, covering).length, 4);

  // Add a passage that shares no content word with the objective, and it is
  // still four -- the extra slot is left empty rather than filled.
  const withNoise = [
    ...covering.slice(0, 2),
    { source: 'noise', text: 'Logistics convoys refuel at the forward arming point before dawn.' },
  ];
  const hits = matchTopK(coursewright.match, objective, withNoise);
  assert.deepEqual(hits.map((hit) => hit.source), ['a', 'b']);
  // And Coursewright itself agrees there was nothing else to take.
  assert.equal(coursewright.match(objective, [withNoise[2]]), null);
});

test('the grounding union is bounded by characters as well as by count', async () => {
  const coursewright = await upstream('coursewright');
  const objective = 'The safety check required before operation';
  const sentence = 'The safety check is required before operation and the operator confirms it. ';
  const bulk = (label) => ({
    source: label,
    text: `Passage ${label}. ${sentence.repeat(80)}`.slice(0, 5000),
  });

  // 12000 characters is the budget, and passages are separated by a blank line:
  // 5000 + 2 + 5000 fits, a third 5000 does not.
  const hits = matchTopK(coursewright.match, objective, [bulk('a'), bulk('b'), bulk('c'), bulk('d')]);
  assert.equal(hits.length, 2);
  assert.ok(hits.map((hit) => hit.text).join('\n\n').length <= 12000);

  // The primary is kept whatever it costs. Dropping it would ground the section
  // in less text than single-passage retrieval already grounds it in.
  const huge = { source: 'huge', text: `Huge. ${sentence.repeat(400)}` };
  assert.ok(huge.text.length > 12000);
  const single = matchTopK(coursewright.match, objective, [huge, bulk('b')]);
  assert.equal(single.length, 1);
  assert.equal(single[0].source, 'huge');
});

test('buildCourse does not carry unknown objective fields onto its sections', async () => {
  // Why the list has to be re-attached after generation rather than passed
  // through: Coursewright builds each section object from scratch.
  const coursewright = await upstream('coursewright');
  const { ask } = stepsAsk();
  const built = await coursewright.buildCourse(
    {
      title: 'Passthrough probe',
      diagrams: false,
      objectives: [{
        objective: STEPS_OBJECTIVE,
        title: STEPS_OBJECTIVE,
        passage: `${STEPS_COUNTED.text}\n\n${STEPS_NAMED.text}`,
        cite: 'ipb-1 p.4',
        cites: ['ipb-1 p.4', 'ipb-1 p.5'],
      }],
    },
    undefined,
    { ask },
  );
  assert.equal(built.sections[0].cite, 'ipb-1 p.4');
  assert.equal(built.sections[0].cites, undefined);
});

test('the instructor is told how many passages ground each section', async () => {
  const events = [];
  const { ask } = stepsAsk();
  await draftCourse(
    {
      title: 'Intelligence preparation of the battlespace',
      objectives: [STEPS_OBJECTIVE],
      documents: [STEPS_COUNTED, STEPS_NAMED, STEPS_UNRELATED],
      diagrams: false,
    },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );
  const grounded = events.find((event) => event.step === 'grounded');
  assert.equal(grounded.passages, 2);
  assert.deepEqual(grounded.cites, ['ipb-1 p.4', 'ipb-1 p.5']);
  const sections = events.find((event) => event.phase === 'sections');
  assert.equal(sections.total, 1);
  assert.equal(sections.passages, 2);
});

/* ---------- validation widens to the union, and only to the union ---------- */

// Two pages of one persisted source. The lesson below is grounded in the
// second, not in the one `cite` names.
const TWO_PAGE_SOURCE = {
  id: 'record-2',
  status: 'APPROVED',
  payload: {
    title: 'Battlespace preparation',
    sourceId: 'ipb-1',
    text: `${STEPS_COUNTED.text}\n\n${STEPS_NAMED.text}`,
    pages: [
      { page: 4, text: STEPS_COUNTED.text },
      { page: 5, text: STEPS_NAMED.text },
    ],
  },
};

function unionCourse(overrides = {}) {
  return {
    title: 'Battlespace preparation',
    sections: [
      {
        title: 'The four steps',
        cite: 'record-2 p.4',
        lesson: STEPS_NAMED.text,
        pre: [{
          stem: 'Which step evaluates the adversary?',
          options: ['Evaluate the adversary', 'Describe the battlespace effects'],
          answer: 0,
          rationale: STEPS_NAMED.text,
        }],
        post: [{
          stem: 'Which step determines adversary courses of action?',
          options: ['Determine adversary courses of action', 'Define the battlespace environment'],
          answer: 0,
          rationale: STEPS_NAMED.text,
        }],
        ...overrides,
      },
    ],
  };
}

test('a lesson grounded in the second cited passage validates against the union', () => {
  // Without the list, the validator resolves only p.4 and rejects a lesson that
  // is plainly grounded -- in p.5, which the section was also written from.
  const single = validateCourseDraft(unionCourse(), { sources: [TWO_PAGE_SOURCE] });
  assert.equal(single.valid, false);
  assert.ok(single.issues.includes('section 0 lesson is not grounded in its cited source'));

  const union = validateCourseDraft(
    unionCourse({ cites: ['record-2 p.4', 'record-2 p.5'] }),
    { sources: [TWO_PAGE_SOURCE] },
  );
  assert.deepEqual(union.issues, []);
  assert.equal(union.valid, true);
});

test('every label in the list has to resolve, and cite has to head it', () => {
  // A second label naming nothing persisted is an unverifiable citation, and is
  // named rather than ignored.
  const dangling = validateCourseDraft(
    unionCourse({ cites: ['record-2 p.4', 'record-2 p.99'] }),
    { sources: [TWO_PAGE_SOURCE] },
  );
  assert.ok(
    dangling.issues.includes('section 0 citation "record-2 p.99" does not resolve to a persisted source'),
  );

  // `cite` is what a learner is shown and what the Item row carries, so it must
  // be the head of the list it came from.
  const mismatched = validateCourseDraft(
    unionCourse({ cites: ['record-2 p.5', 'record-2 p.4'] }),
    { sources: [TWO_PAGE_SOURCE] },
  );
  assert.ok(mismatched.issues.includes('section 0 cite is not the primary of its cites list'));
});

/* ---------------- the label -> passage text seam ---------------- */

// Materialisation has to know which passage an individual item came from, and
// a section carries only citation LABELS. `sourcePassageIndex` is the seam:
// the same projection of the same persisted sources that validateCourseDraft
// resolves a citation against, exported so the materialiser resolves a label
// to exactly the text the validator graded the section on -- rather than a
// second copy of the doctrine carried through the draft payload.
test('the passage index resolves a citation label to the text the validator uses', () => {
  const index = sourcePassageIndex([TWO_PAGE_SOURCE]);
  assert.equal(index.length, 2);

  const textFor = (label) =>
    index.filter((passage) => passage.labels.includes(label)).map((passage) => passage.text);
  // A page label addresses that page and only that page.
  assert.deepEqual(textFor('record-2 p.4'), [STEPS_COUNTED.text]);
  assert.deepEqual(textFor('record-2 p.5'), [STEPS_NAMED.text]);
  // The bare source labels address the whole publication, as they do in the
  // validator; a label naming nothing persisted addresses nothing.
  assert.equal(textFor('record-2').length, 2);
  assert.equal(textFor('ipb-1').length, 2);
  assert.deepEqual(textFor('record-2 p.99'), []);
});

test('the passage index refuses to carry an unapproved source', () => {
  // Nothing unapproved may ground a course, so nothing unapproved may be
  // resolved to and cited either.
  assert.deepEqual(sourcePassageIndex([{ ...TWO_PAGE_SOURCE, status: 'PENDING' }]), []);
  assert.deepEqual(sourcePassageIndex([]), []);
  assert.deepEqual(sourcePassageIndex(undefined), []);
});

test('a section with no cites list validates exactly as it always did', () => {
  // The widening must never loosen the single-citation path.
  assert.equal(validateCourseDraft(groundedCourse(), { sources: [groundedSource] }).valid, true);

  const unresolvable = groundedCourse();
  unresolvable.sections[0].cite = 'not-a-source';
  assert.deepEqual(
    validateCourseDraft(unresolvable, { sources: [groundedSource] }).issues,
    ['section 0 citation does not resolve to a persisted source'],
  );

  const uncited = groundedCourse();
  delete uncited.sections[0].cite;
  assert.deepEqual(
    validateCourseDraft(uncited, { sources: [groundedSource] }).issues,
    [
      'section 0 requires a citation',
      'section 0 citation does not resolve to a persisted source',
    ],
  );
});

test('the outline repair pass is bounded at one retry', async () => {
  const { ask, calls } = coursewrightAsk(() => ({ objectives: [] }));
  await assert.rejects(
    () => draftCourse(
      { title: 'Never valid', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
      { load: upstream, ask },
    ),
    (error) => error.code === 'COURSE_OUTLINE_INVALID' && error.status === 422,
  );
  assert.equal(calls.length, 2, 'one outline attempt plus one repair, then stop');
});

test('an omitted title is named by the model from the same sources', async () => {
  const { ask, calls } = coursewrightAsk(() => ({
    title: 'Pre-Operation Safety Checks',
    objectives: ['Safety check'],
  }));

  const course = await draftCourse(
    { objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  );

  assert.equal(course.title, 'Pre-Operation Safety Checks');
  assert.equal(calls[0].prompt.includes('Course title:'), false, 'nothing to echo back');
});

test('a supplied title is never overwritten by the generated one', async () => {
  const { ask } = coursewrightAsk(() => ({
    title: 'Model would have called it this',
    objectives: ['Safety check'],
  }));

  const course = await draftCourse(
    { title: 'Instructor wording', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  );

  assert.equal(course.title, 'Instructor wording');
});

test('explicit objectives with no title get a title of their own before generation', async () => {
  const { ask, calls } = coursewrightAsk(() => ({ title: 'Safety Check Fundamentals' }));

  const course = await draftCourse(
    { objectives: ['Safety check'], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  );

  assert.equal(course.title, 'Safety Check Fundamentals');
  assert.equal(calls[0].model, 'coursewright-title');
});

test('a title the model will not produce is an explicit failure, never a guess', async () => {
  const { ask } = coursewrightAsk(() => ({ title: '   ' }));
  await assert.rejects(
    () => draftCourse(
      { objectives: ['Safety check'], documents: [SAFETY_DOCUMENT], diagrams: false },
      { load: upstream, ask },
    ),
    (error) => error.code === 'COURSE_TITLE_INVALID' && error.status === 422,
  );
});

/* ---------- rubric task auto-fill ---------- */

// The CONDITION / STANDARD / PERFORMANCE STEPS layout Quarry's extractTasks reads.
const STANDARDS_DOCUMENT = [
  '0311-MNT-1001: Maintain an M16 service rifle',
  'CONDITION: Given a service rifle, a cleaning kit, and lubricant.',
  'STANDARD: Rifle is cleaned and lubricated so that it functions without stoppage.',
  'PERFORMANCE STEPS:',
  '1. Clear the rifle.',
  '2. Disassemble the rifle into major groups.',
  '3. Clean each group.',
  '4. Lubricate and reassemble the rifle.',
].join('\n');

test('a standards source fills the rubric form from Quarry, not from a model', async () => {
  const payload = await ingestSource(
    { title: 'Rifle maintenance', sourceId: 'poi-rifle', text: STANDARDS_DOCUMENT },
    { load: upstream },
  );

  const suggested = extractedRubricTasks(payload);
  assert.equal(suggested.origin, 'quarry');
  assert.equal(suggested.tasks.length, 1);

  const [task] = suggested.tasks;
  // Every field the rubric form asks for, straight out of the document.
  assert.equal(task.code, '0311-MNT-1001');
  assert.equal(task.codeGenerated, false);
  assert.equal(task.title, 'Maintain an M16 service rifle');
  assert.match(task.condition, /cleaning kit/);
  assert.match(task.standard, /without stoppage/);
  assert.equal(task.performanceSteps.length, 4);
  assert.equal(task.performanceSteps[0], 'Clear the rifle.');
});

test('a source with no task block has nothing to extract and falls through', async () => {
  const payload = await ingestSource(
    {
      title: 'Prose source',
      sourceId: 'prose-1',
      text: 'A safety check is required before operation. The operator confirms the check before starting.',
    },
    { load: upstream },
  );
  assert.equal(extractedRubricTasks(payload), null);
});

test('a task drafted by the model keeps only source-shaped fields and is capped', async () => {
  const task = await draftRubricTask(
    { sourceText: 'A safety check is required before operation.' },
    {
      ask: async (model, system) => {
        assert.equal(model, 'rubricon-task');
        assert.match(system, /ONLY those passages/);
        return {
          title: '  Perform a pre-operation safety check  ',
          condition: 'Given a machine before operation.',
          standard: 'The check is completed before operation begins.',
          performanceSteps: Array.from({ length: 30 }, (_, i) => `Step ${i + 1}`),
          invented: 'dropped',
        };
      },
    },
  );

  assert.equal(task.title, 'Perform a pre-operation safety check');
  assert.equal(task.performanceSteps.length, 20);
  assert.equal(task.invented, undefined);
});

test('an incomplete drafted task is an explicit failure, never a half-filled form', async () => {
  await assert.rejects(
    () => draftRubricTask(
      { sourceText: 'A safety check is required before operation.' },
      { ask: async () => ({ title: 'A task', condition: '', standard: '', performanceSteps: [] }) },
    ),
    (error) => error.code === 'RUBRIC_TASK_INCOMPLETE' && error.status === 422,
  );

  await assert.rejects(
    () => draftRubricTask(
      { sourceText: 'A safety check is required before operation.' },
      { ask: async () => ({ refused: true, reason: 'no performable task' }) },
    ),
    (error) => error.code === 'RUBRIC_TASK_REFUSED' && error.status === 422,
  );
});

test('a task with no code of its own gets a derived one that cannot pass for an official code', () => {
  const suggested = extractedRubricTasks({
    tasks: [{
      title: 'Perform a pre-operation safety check',
      condition: 'Given a machine before operation.',
      standard: 'The check is completed before operation begins.',
      performanceSteps: ['Clear the machine.'],
    }],
  });

  const [task] = suggested.tasks;
  assert.equal(task.codeGenerated, true);
  assert.equal(task.code, 'SC-PERFORM-PRE-OPERATION-01');
  // An official task code is 0000-AAA-0000; a derived one must not look like it.
  assert.doesNotMatch(task.code, /^[0-9X]{4}-[A-Z]{2,4}-[0-9]{4}$/);
});

/* ---------- grounding a section in what its citation denotes ---------- */

// Two persisted chunks of one page. They carry the same citation label, which
// is what validateCourseDraft resolves a section's cite against.
const PAGE_CHUNKS = [
  {
    source: 'record-1 p.1',
    text: 'Clear the rifle and confirm the chamber is empty before any disassembly begins. Disassemble the rifle into its major groups: upper receiver, lower receiver, and bolt carrier group.',
  },
  {
    source: 'record-1 p.1',
    text: 'Carbon build-up on the bolt tail is the most common cause of a failure to extract. A rifle that is cleaned but under-lubricated will short-stroke under sustained fire, so lubrication is not optional.',
  },
];

// A lesson that draws on both chunks of the page it cites -- which is exactly
// what an instructor wants and what the cited page supports.
const PAGE_LESSON = 'Clear the rifle and confirm the chamber is empty before any disassembly begins. Disassemble the rifle into its major groups: upper receiver, lower receiver, and bolt carrier group. Carbon build-up on the bolt tail is the most common cause of a failure to extract. A rifle that is cleaned but under-lubricated will short-stroke under sustained fire, so lubrication is not optional.';

function pageAsk(lesson = PAGE_LESSON) {
  return async (model, system) => {
    if (system.includes('micro-lesson')) return { refused: false, lesson };
    if (system.includes('"items"')) {
      return { refused: false, items: [{
        stem: 'What is the most common cause of a failure to extract?',
        options: ['Carbon build-up on the bolt tail', 'An empty chamber'],
        answerIndex: 0,
        rationale: 'Carbon build-up on the bolt tail is the most common cause of a failure to extract.',
      }] };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'Most common cause of a failure to extract?', back: 'Carbon build-up on the bolt tail.' }] };
    }
    if (system.includes('applied scenario')) return { refused: true, reason: 'not needed for this fixture' };
    if (system.includes('discussion prompts')) return { refused: true, reason: 'not needed for this fixture' };
    if (system.includes('summarize')) return { refused: true, reason: 'not needed for this fixture' };
    throw new Error(`unexpected prompt: ${system.slice(0, 60)}`);
  };
}

test('a lesson drawing on the whole cited page is not refused for missing one chunk of it', async () => {
  // Regression. Coursewright re-chunked the documents to ~180 words and graded
  // the lesson against the single best chunk, while validateCourseDraft grades
  // it against everything the citation resolves to. A lesson grounded in the
  // page but spread across two chunks measured 37.5% against the chunk and
  // 66.7% against the page, so it was refused despite being grounded.
  const course = await draftCourse(
    {
      title: 'Rifle maintenance',
      objectives: ['Clear the rifle before disassembly'],
      documents: PAGE_CHUNKS,
      diagrams: false,
    },
    { load: upstream, ask: pageAsk() },
  );

  assert.equal(course.sections.length, 1);
  assert.equal(course.sections[0].refused, undefined, course.sections[0].reason);
  assert.equal(course.sections[0].cite, 'record-1 p.1');
});

test('a refused section carries its reason out of validation, not just its index', async () => {
  // Twelve lines of "section N is refused" is what an instructor actually saw.
  const validation = validateCourseDraft(
    {
      title: 'Rifle maintenance',
      sections: [{ title: 'Clean the bolt', cite: 'record-1 p.1', refused: true, reason: 'lesson not grounded in the passage' }],
    },
    { sources: [{ id: 'record-1', status: 'APPROVED', payload: { sourceId: 'record-1', title: 'POI', pages: [{ page: 1, text: PAGE_CHUNKS[0].text }] } }] },
  );

  assert.equal(validation.valid, false);
  const refusal = validation.issues.find((issue) => issue.includes('is refused'));
  assert.match(refusal, /lesson not grounded in the passage/);
  assert.match(refusal, /Clean the bolt/);
});

test('generation reports each phase and artifact as it lands', async () => {
  const events = [];
  await draftCourse(
    {
      title: 'Rifle maintenance',
      objectives: ['Clear the rifle before disassembly'],
      documents: PAGE_CHUNKS,
      diagrams: false,
    },
    { load: upstream, ask: pageAsk(), emit: (event) => events.push(event) },
  );

  // What the live generation view renders.
  assert.equal(events.find((e) => e.phase === 'sources')?.documents, 2);
  assert.deepEqual(
    events.filter((e) => e.phase === 'sections')[0],
    // `passages` is how many source passages ground the whole course, which is
    // not the section count: a section may be grounded in several.
    { phase: 'sections', status: 'start', total: 1, passages: 1 },
  );
  const landed = events.filter((e) => e.phase === 'coursewright' && e.ok === true).map((e) => e.kind);
  assert.deepEqual(landed.sort(), ['flashcards', 'lesson', 'post-test', 'pre-test']);
  // A refusal reaches the view with its reason, live, rather than only in a
  // summary after the whole build is discarded.
  const refused = events.filter((e) => e.phase === 'coursewright' && e.ok === false);
  assert.ok(refused.every((e) => typeof e.reason === 'string' && e.reason));
  assert.equal(events.at(-1).step, 'done');
});

test('a throwing progress listener never aborts a generation that is going fine', async () => {
  const course = await draftCourse(
    {
      title: 'Rifle maintenance',
      objectives: ['Clear the rifle before disassembly'],
      documents: PAGE_CHUNKS,
      diagrams: false,
    },
    { load: upstream, ask: pageAsk(), emit: () => { throw new Error('listener exploded'); } },
  );
  assert.equal(course.sections.length, 1);
});
