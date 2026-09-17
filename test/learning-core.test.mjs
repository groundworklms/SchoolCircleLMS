import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  composeLesson,
  draftCourse,
  deriveMasteryPlan,
  generateRubric,
  ingestSource,
  masteryCriteriaFromRubric,
  masteryPlanProvenance,
  restoreMasterySession,
  serialiseMasterySession,
  startMasterySession,
  terminalSafeScorer,
  tutorAnswer,
  validateCourseDraft,
  draftRubricTask,
  looksLikeFrontMatter,
  looksLikeObjectiveList,
  matchTopK,
  sourcePassageIndex,
  validateCourseOutline,
  validateMasteryPlan,
} from '../lib/arsenal-core.js';
import {
  extractedRubricTasks,
  canViewCourse,
  courseCitations,
  learnerCourseProjection,
  savedMasteryView,
  sourceDocuments,
  tutor,
} from '../lib/learning/core.js';
import { matchesApprovedMasteryPlan } from '../lib/db.js';
import { projectCourseRows } from '../lib/learning/project-course.js';

const upstream = (name) => import(name);

/* ---------- the lesson contract, as a fixture ----------
 *
 * arsenal-core no longer asks the generator for Coursewright's one paragraph.
 * It asks for a lesson in GROUNDED ELEMENTS and composes them (composeLesson),
 * so a fixture that teaches from a page returns that page as elements -- each
 * in the page's own wording, so each clears the grounding floor on its own,
 * which is exactly the burden production carries. */
const LESSON_SYSTEM = /writing ONE lesson/;

function lessonElements(text, passage = 1) {
  const body = String(text).trim();
  const plain = body.replace(/\s*\.$/, '');
  return {
    refused: false,
    elements: [
      { kind: 'concept', passage, text: body },
      { kind: 'why', passage, text: `This matters because ${plain}.` },
      { kind: 'summary', passage, text: `In summary, ${plain}.` },
    ],
  };
}

/** What composeLesson makes of lessonElements(text). */
function composedLesson(text, passage = 1) {
  return lessonElements(text, passage).elements.map((element) => element.text).join('\n\n');
}

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
    if (LESSON_SYSTEM.test(system)) {
      return lessonElements('A safety check is required before operation.');
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
    if (LESSON_SYSTEM.test(system)) {
      return lessonElements('Clear the rifle and confirm the chamber is empty before disassembly begins.');
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
    if (LESSON_SYSTEM.test(system)) {
      return refuses
        ? { refused: true, reason: CI_REFUSAL }
        : lessonElements(pageFor(objective));
    }
    if (system.includes('"items"')) {
      return {
        refused: false,
        items: [{
          // Deliberately the same stem for every section: this fixture is the
          // guard that de-duplication never empties a single-question phase.
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

/* ---------- a publication is taught in part, and says which part ---------- */

/* A publication rather than a handout. The three pages the outline teaches
   from, plus eight more chapters of everything else it carries -- roughly
   thirty thousand characters, which is the shape that made the outline
   unsatisfiable: no twelve lesson-sized objectives of 240 characters cover it.
   The filler wording is deliberately unlike the three taught pages so it cannot
   win retrieval away from them. */
const EXTRA_CHAPTERS = [
  'Signals intelligence support',
  'Geospatial intelligence products',
  'Imagery collection requests',
  'Measurement and signature reporting',
  'Operations centre manning',
  'Reconnaissance and surveillance tasking',
  'Target nomination and battle damage assessment',
  'Weather and oceanographic support',
];
const BIG_DOCUMENTS = [
  ...MAGTF_DOCUMENTS,
  ...EXTRA_CHAPTERS.map((topic, index) => ({
    source: `${MAGTF_SOURCE.id} p.${10 + index}`,
    text: `${topic} is described at length in this chapter. `.repeat(80),
  })),
];
const OUT_OF_SCOPE = "in the sources, but outside this course's scope";

test('a publication too large for the objective budget is taught in part, not refused', async () => {
  // The live MCWP 2-10 failure: 108 pages, and the model refused the outline
  // rather than break a rule it had been given. It was right to -- "cover the
  // full source content" plus one teaching point per objective plus twenty
  // objectives cannot all hold at once -- so the instruction changed instead.
  const calls = [];
  const events = [];
  const scoped = magtfAsk();
  const ask = async (model, system, prompt) => {
    calls.push({ model, system });
    if (system.includes('instructional designer')) {
      return {
        title: 'MAGTF intelligence fundamentals',
        objectives: MAGTF_OBJECTIVES.slice(0, 2),
        notCovered: ['Signals intelligence support', 'Geospatial intelligence products'],
      };
    }
    return scoped(model, system, prompt);
  };
  const course = await draftCourse(
    { objectives: [], documents: BIG_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  const outlineSystem = calls.find((call) => call.model === 'coursewright-outline').system;
  assert.doesNotMatch(outlineSystem, /Cover the full source content/);
  assert.match(outlineSystem, /coherent subset/);
  assert.match(outlineSystem, /"notCovered"/);
  // Refusal is still described, but reserved for sources that carry no course.
  assert.match(outlineSystem, /Breadth is never a reason to refuse/);

  // The course teaches the subset it chose, completely.
  assert.deepEqual(course.objectives, MAGTF_OBJECTIVES.slice(0, 2));
  assert.equal(course.sections.length, 2);
  // And declares what it decided not to reach, in the same list and the same
  // shape as an objective retrieval could not ground -- with wording that keeps
  // the two apart.
  assert.deepEqual(course.skippedObjectives, [
    { objective: 'Signals intelligence support', reason: OUT_OF_SCOPE },
    { objective: 'Geospatial intelligence products', reason: OUT_OF_SCOPE },
  ]);
  assert.equal(course.thinCoverage, true);

  // The modal is watching the outline stage, so it has to leave on the stream.
  const done = events.find((event) => event.phase === 'outline' && event.status === 'done');
  assert.deepEqual(done.notCovered, course.skippedObjectives);
  assert.equal(done.thinCoverage, true);

  // An instructor who typed their own objectives has already narrowed the
  // course by hand, so the same publication prompts them to do nothing.
  const byHand = await draftCourse(
    {
      title: 'MAGTF intelligence',
      objectives: MAGTF_OBJECTIVES.slice(0, 2),
      documents: BIG_DOCUMENTS,
      diagrams: false,
    },
    { load: upstream, ask: magtfAsk() },
  );
  assert.equal(byHand.thinCoverage, undefined);
  assert.equal(byHand.skippedObjectives, undefined);
});

test('sources that support no course at all are still refused at the outline', async () => {
  // The guard on the half above. Teaching a subset instead of refusing must not
  // become a way to generate a course from a document that carries none: this
  // is cite-or-refuse at the outline layer, and it is the same refusal path,
  // reached for the same reason it always was.
  await assert.rejects(
    () => draftCourse(
      {
        objectives: [],
        documents: [{ source: 'scan p.1', text: 'iv v vi vii viii ix x xi xii' }],
        diagrams: false,
      },
      {
        load: upstream,
        ask: async (_model, system) => (system.includes('instructional designer')
          ? { refused: true, reason: 'the passages are page numbering and teach nothing testable' }
          : { refused: false, lesson: 'unreachable' }),
      },
    ),
    (error) =>
      error.code === 'COURSE_OUTLINE_REFUSED' &&
      error.status === 422 &&
      /teach nothing testable/.test(error.message),
  );
});

test('a gap the sources never mention is not reported, and a covered source is not called thin', async () => {
  // Two separate ways this could mislead an instructor. An invented gap would
  // have the screen report missing coverage of material no source ever carried
  // -- the same fabrication the grounding floor exists to stop, arriving in the
  // one field nothing else checks. And a prompt to narrow a source the outline
  // genuinely did cover is a warning instructors learn to ignore, which costs
  // the ones that mean something.
  const scoped = magtfAsk();
  const course = await draftCourse(
    { objectives: [], documents: MAGTF_DOCUMENTS, diagrams: false },
    {
      load: upstream,
      ask: async (model, system, prompt) => {
        if (system.includes('instructional designer')) {
          return {
            title: 'MAGTF intelligence fundamentals',
            objectives: MAGTF_OBJECTIVES.slice(0, 2),
            notCovered: [
              'Counterintelligence and human intelligence reporting categories',
              'Orbital launch ceramic seal inspection',
            ],
          };
        }
        return scoped(model, system, prompt);
      },
    },
  );
  assert.deepEqual(course.skippedObjectives, [
    { objective: 'Counterintelligence and human intelligence reporting categories', reason: OUT_OF_SCOPE },
  ]);
  // Three short pages: the outline had room for all of it, so nothing to say.
  assert.equal(course.thinCoverage, undefined);
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
  // Nothing here was ratified, so every criterion is stamped DERIVED and the
  // plan says so in one word -- the instructor is not left inferring it.
  assert.deepEqual(
    plan.criteria,
    criteria.map((criterion) => ({ ...criterion, provenance: { origin: 'DERIVED' } })),
  );
  assert.deepEqual(plan.provenance, {
    origin: 'DERIVED',
    total: 2,
    ratified: 0,
    derived: 2,
    rubricIds: [],
    objectives: [],
  });
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

/* The authoring draft is not a delivery channel.
 *
 * Course approval releases a SHAPE -- how many sections, in what order, under
 * what titles, grounded in which source. Every sentence inside it is
 * materialised as a PENDING Item and ratified one at a time, so the draft's
 * `lesson`, `pre`, `post` and `scenario` are unratified text by definition.
 * This response was handing them to learners: the reader stopped RENDERING the
 * draft's questions when checks moved onto the delivery rows, but they stayed
 * on the wire, and the prose was still being read straight off them. Fixing
 * only the client would have left `curl` as the exploit.
 */
test('the learner course projection carries structure, never unratified text', () => {
  const projected = learnerCourseProjection({
    title: 'Movement',
    sourceIds: ['source-1'],
    objectives: ['Move under fire'],
    scenario: { situation: 'An unratified course-level scenario.', task: 'Do the thing.' },
    sections: [{
      id: 'section-1',
      title: 'Movement fundamentals',
      order: 0,
      cite: 'source-1 p.135',
      cites: ['source-1 p.135', 'source-1 p.136'],
      lesson: 'Unratified lesson prose.',
      pre: [{ stem: 'An unratified pre-check?', options: ['A', 'B'], answer: 0 }],
      post: [{ stem: 'An unratified post-check?', options: ['A', 'B'], answer: 1 }],
    }],
  });

  // What course approval did release.
  assert.equal(projected.title, 'Movement');
  assert.deepEqual(projected.objectives, ['Move under fire']);
  assert.deepEqual(projected.sourceIds, ['source-1']);
  assert.equal(projected.sections[0].title, 'Movement fundamentals');
  assert.equal(projected.sections[0].cite, 'source-1 p.135');

  // What it did not.
  assert.equal(projected.sections[0].lesson, undefined);
  assert.equal(projected.sections[0].pre, undefined);
  assert.equal(projected.sections[0].post, undefined);
  assert.equal(projected.scenario, undefined);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /Unratified lesson prose|unratified pre-check|unratified post-check|unratified course-level scenario/i,
  );
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

/* A tutor citation, on its way to a learner.
 *
 * Its `source` is the locator "<source record id> p.N" -- the record id is the
 * authenticated page-opening key (sourcePassages) and a cuid, so the chip that
 * printed it was showing a learner a primary key. The approved source record is
 * already resolved here to authorize the citation, so the publication is named
 * from it in the same step; the locator itself is never rewritten, because it
 * is the addressing contract the source viewer opens. */
test('a delivered citation names its publication and keeps its marker and locator', () => {
  const record = {
    id: 'cmu4xdph30016s6014fn9n9y8',
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'AY27_8670_Prerequisite_Coursebook.pdf',
      sourceId: 'AY27 8670 Prerequisite Coursebook Instructor-Led Moodle',
      pages: [],
      chunks: [],
    },
  };
  // `n` is the inline marker the answer carries, not this list's order.
  const delivered = courseCitations(
    [
      { n: 4, id: 'cmu4xdph30016s6014fn9n9y8:chunk:18', text: 'Military goals serve the political outcome.', source: 'cmu4xdph30016s6014fn9n9y8 p.19' },
      // No approved, selected source owns this one: it cannot be opened, so it
      // cannot support a student-facing answer.
      { n: 5, id: 'other:chunk:1', text: 'Elsewhere.', source: 'cmz9elsewhere0001 p.2' },
    ],
    [record],
  );
  assert.deepEqual(delivered, [{
    n: 4,
    id: 'cmu4xdph30016s6014fn9n9y8:chunk:18',
    text: 'Military goals serve the political outcome.',
    source: 'cmu4xdph30016s6014fn9n9y8 p.19',
    sourceId: 'cmu4xdph30016s6014fn9n9y8',
    pubId: 'AY27 8670 Prerequisite Coursebook Instructor-Led Moodle',
  }]);

  // `sourceId` is the publication label the Sources screen shows; a source
  // recorded under no label at all is still named by its title.
  const titled = courseCitations(
    [{ n: 1, source: 'cmu4xdph30016s6014fn9n9y8 p.19' }],
    [{ ...record, payload: { ...record.payload, sourceId: '' } }],
  );
  assert.equal(titled[0].pubId, 'AY27_8670_Prerequisite_Coursebook.pdf');
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
    if (LESSON_SYSTEM.test(system)) {
      return lessonElements('A safety check is required before operation.');
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
    assert.match(calls[0].system, /240 characters/);
    assert.match(calls[0].system, /at most 12 objectives/);
  });
});

test('the outline prompt asks for one LESSON per objective, not one atom', () => {
  // Eight of twelve MCDP 2 sections were once refused as "the passage supports
  // X, but does not cover Y and Z", and the fix was one teaching point per
  // objective. Top-K retrieval removed the premise -- a section is grounded in
  // up to four passages now -- and holding the rule produced the opposite
  // failure: four consecutive near-identical "Demand-Pull ..." sections. The
  // prompt asks for a lesson-sized unit and states the anti-restatement rule
  // the validator now enforces.
  const { ask, calls } = coursewrightAsk(() => ({ objectives: ['Safety check'] }));
  return draftCourse(
    { title: 'One lesson each', objectives: [], documents: [SAFETY_DOCUMENT], diagrams: false },
    { load: upstream, ask },
  ).then(() => {
    assert.match(calls[0].system, /ONE LESSON/);
    assert.match(calls[0].system, /AT MOST THREE closely related points/);
    assert.match(calls[0].system, /Near-identical objectives are rejected/);
    // The rule it replaces is gone, not merely contradicted.
    assert.doesNotMatch(calls[0].system, /exactly ONE point/);
  });
});

test('an outline the validator rejects is repaired once with the reasons, not failed outright', async () => {
  const tooLong = 'The learner will be able to describe, in complete detail and with reference to every applicable authority, the full sequence of the standard safety check that is required before operation, including the confirmation the operator performs before starting, so that operation never begins without it having been carried out first.';
  assert.ok(tooLong.length > 240, 'fixture must exceed the objective limit');

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
  assert.match(repair.prompt, /exceeds 240 characters/);
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
    if (LESSON_SYSTEM.test(system)) {
      return lessonElements('Chapter 1 covers the safety check before operation.');
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
    // Grounded in the SECOND passage of the union, which is the whole point of
    // this fixture: element attribution has to follow retrieval order.
    if (LESSON_SYSTEM.test(system)) return lessonElements(STEPS_LESSON, 2);
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
  assert.equal(section.lesson, composedLesson(STEPS_LESSON, 2));
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
  const lesson = calls.find((call) => LESSON_SYSTEM.test(call.system));
  assert.ok(lesson.prompt.includes(`[1] ${STEPS_COUNTED.text}\n\n[2] ${STEPS_NAMED.text}`));
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
    if (LESSON_SYSTEM.test(system)) return lessonElements(lesson);
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

/* ==========================================================================
   A section grounded in four passages should read like it was written from
   four passages
   ========================================================================== */

/* Four pages of a coursebook that between them teach one lesson: what the
   hazard is, why it matters, the precaution, and the error that defeats it.
   This is the budget matchTopK already retrieves and the old contract threw
   away -- four passages, twelve thousand characters of allowance, compressed
   into one paragraph of four to seven sentences. */
const ESD_PAGES = [
  {
    page: 41,
    text: 'Electrostatic discharge is the sudden transfer of static charge between two objects at different electrical potentials. An electrostatic discharge of as little as thirty volts can damage a sensitive semiconductor device.',
  },
  {
    page: 42,
    text: 'Electrostatic discharge damage is latent: a damaged sensitive device passes its test and fails later in service. Latent electrostatic discharge damage to a device is the most expensive kind.',
  },
  {
    page: 43,
    text: 'Electrostatic discharge precautions begin with grounding. The technician wears a wrist strap bonded to the same ground as the workbench, so the technician, the bench and the sensitive device sit at one electrical potential and no discharge can occur.',
  },
  {
    page: 44,
    text: 'The common electrostatic discharge error is trusting an unbonded wrist strap. Grounding that is never checked does not prevent damage, so a wrist strap is tested before every shift; a broken ground path leaves a sensitive device open to electrostatic discharge damage.',
  },
];
const ESD_RECORD = 'esd-record';
const ESD_DOCUMENTS = ESD_PAGES.map((page) => ({
  source: `${ESD_RECORD} p.${page.page}`,
  text: page.text,
}));
const ESD_SOURCE = {
  id: ESD_RECORD,
  status: 'APPROVED',
  payload: { title: 'Basic Electronics Coursebook', sourceId: 'coursebook', pages: ESD_PAGES },
};
const ESD_OBJECTIVE =
  'Explain electrostatic discharge damage to a sensitive device and the grounding precautions that prevent it';

/* The lesson contract, answered honestly: one element per retrieved passage, in
   that passage's own words, plus the two the passages support between them. The
   fixture reads the numbered passages back out of the prompt, so it cannot
   cheat about which passage an element came from. */
function esdAsk({ elements } = {}) {
  const calls = [];
  const ask = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('instructional designer')) {
      return { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE] };
    }
    if (LESSON_SYSTEM.test(system)) {
      const numbered = [...prompt.matchAll(/\[(\d+)\] ([^\n]+)/g)].map((match) => ({
        passage: Number(match[1]),
        text: match[2],
      }));
      if (elements) return { refused: false, elements: elements(numbered) };
      const kinds = ['concept', 'why', 'detail', 'error'];
      return {
        refused: false,
        elements: [
          ...numbered.map((entry, index) => ({
            kind: kinds[index] || 'detail',
            passage: entry.passage,
            text: entry.text,
          })),
          {
            kind: 'example',
            passage: 3,
            text: 'In practice the technician bonds the wrist strap to the same ground as the workbench before touching a sensitive device.',
          },
          {
            kind: 'summary',
            passage: 1,
            text: 'In summary, electrostatic discharge is the sudden transfer of static charge, and it can damage a sensitive semiconductor device.',
          },
        ],
      };
    }
    if (system.includes('"items"')) {
      return {
        refused: false,
        items: [
          {
            stem: 'What damage does an electrostatic discharge of thirty volts do to a sensitive semiconductor device?',
            options: ['Latent damage', 'None at all'],
            answerIndex: 0,
            rationale: 'An electrostatic discharge of as little as thirty volts can damage a sensitive semiconductor device, and the damage is latent.',
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return {
        refused: false,
        cards: [{ front: 'What is electrostatic discharge?', back: 'The sudden transfer of static charge between two objects at different electrical potentials.' }],
      };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
  return { ask, calls };
}

test('retrieval offers four passages and the lesson is written from all four', async () => {
  // The complaint this change answers: "questions don't make a whole course or
  // lessons". A section was one paragraph, two pre-questions, two
  // post-questions and three flashcards -- while retrieval had already paid for
  // four passages and up to twelve thousand characters of them.
  const events = [];
  const { ask, calls } = esdAsk();
  const course = await draftCourse(
    { objectives: [], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  const [section] = course.sections;
  assert.equal(section.refused, undefined, section.reason);
  assert.equal(section.cites.length, 4, 'the fixture must exercise a four-passage union');

  // Six ordered paragraphs, not one, and in the contract's order.
  const paragraphs = section.lesson.split('\n\n');
  assert.equal(paragraphs.length, 6);
  // Ordered by the contract's kinds, not by the order retrieval ranked the
  // passages in: the lesson reads concept, why, detail, example, error, close.
  assert.match(paragraphs[3], /^In practice/);
  assert.match(paragraphs[5], /^In summary/);

  // Every retrieved passage is actually taught from -- the point of the budget.
  for (const page of ESD_PAGES) {
    assert.ok(
      section.lesson.includes(page.text),
      `page ${page.page} was retrieved and paid for but never taught from`,
    );
  }
  // And the depth is reported, so the generation view can show it.
  const depth = events.find((event) => event.step === 'depth');
  assert.equal(depth.elements, 6);
  assert.equal(depth.passages, 4);
  assert.equal(depth.passagesUsed, 4);
  assert.equal(depth.narrowed, undefined);
  assert.deepEqual(depth.kinds, ['concept', 'why', 'detail', 'example', 'error', 'summary']);

  // The deepened lesson still crosses the approval boundary, which is the
  // thing that would cost an instructor their whole draft if it did not: the
  // validator is fatal and it grades a lesson against what its citation
  // resolves to.
  assert.deepEqual(validateCourseDraft(course, { sources: [ESD_SOURCE] }), {
    valid: true,
    issues: [],
  });

  // The lesson prompt carried every passage, numbered, in retrieval order.
  const lesson = calls.find((call) => LESSON_SYSTEM.test(call.system));
  for (let index = 0; index < 4; index += 1) {
    assert.ok(lesson.prompt.includes(`[${index + 1}] `));
  }
});

test('the pinned generator still routes its lesson through the deep contract', async () => {
  // The cost of adapting a package from outside it: the adapter recognises
  // Coursewright's own lesson prompt by its wording, and a pin that renamed it
  // would fall through to the unmodified call and silently return to one
  // paragraph. This drives the REAL pinned buildCourse and fails loudly if that
  // ever happens.
  const { ask, calls } = esdAsk();
  await draftCourse(
    { objectives: [], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask },
  );
  assert.ok(
    calls.some((call) => LESSON_SYSTEM.test(call.system)),
    'the deep lesson contract never reached the model -- has the coursewright pin changed its prompt?',
  );
  assert.ok(
    calls.every((call) => !call.system.includes('micro-lesson')),
    'Coursewright asked for its own micro-lesson, so the adapter did not intercept',
  );
});

test('a passage that can only support a paragraph refuses, and does not pad', async () => {
  // Richer must never mean invented. A source that cannot carry a lesson of the
  // depth asked for takes the refusal path it always took -- reported against
  // the objective it cost, with the reason, exactly like every other refusal.
  const { ask } = esdAsk({
    elements: (numbered) => [
      { kind: 'concept', passage: numbered[0].passage, text: numbered[0].text },
    ],
  });
  await assert.rejects(
    () => draftCourse(
      { objectives: [ESD_OBJECTIVE], documents: ESD_DOCUMENTS, diagrams: false },
      { load: upstream, ask },
    ),
    (error) =>
      error.code === 'COURSE_GENERATION_EMPTY' &&
      /a paragraph and not a lesson/.test(error.message),
  );
});

test('an element the passages do not support is dropped, not composed', () => {
  // How richer output could smuggle in ungrounded content, and the answer.
  // Coursewright grades the finished paragraph against the whole union, so a
  // lesson three quarters drawn from the passages can carry one fabricated
  // sentence and still clear the floor -- dilution. Every element is graded on
  // its own instead.
  const passages = ESD_PAGES.map((page) => page.text);
  const composed = composeLesson(
    [
      { kind: 'concept', passage: 1, text: passages[0] },
      { kind: 'detail', passage: 3, text: passages[2] },
      {
        kind: 'error',
        passage: 4,
        text: 'MIL-STD-1686 requires a resistance of one megohm in every wrist strap cord.',
      },
      { kind: 'summary', passage: 2, text: passages[1] },
    ],
    passages,
  );
  assert.equal(composed.dropped, 1);
  assert.equal(composed.elements, 3);
  assert.equal(composed.lesson.includes('MIL-STD-1686'), false);

  // ...and when the fabrication is all there is, there is no lesson at all.
  const invented = composeLesson(
    [
      { kind: 'concept', passage: 1, text: 'MIL-STD-1686 requires a resistance of one megohm.' },
      { kind: 'why', passage: 1, text: 'The orbital engine requires a ceramic seal.' },
      { kind: 'summary', passage: 1, text: 'Ceramic seals are inspected every six launches.' },
    ],
    passages,
  );
  assert.equal(invented.lesson, undefined);
  assert.match(invented.reason, /0 grounded lesson element/);
});

test('an element attributed to the wrong passage is re-attributed, never trusted', () => {
  // The model's own index is a hint, not evidence. Text that names passage one
  // but was written from passage three is still grounded -- it is just cited to
  // the passage that actually holds it.
  const passages = ESD_PAGES.map((page) => page.text);
  const composed = composeLesson(
    [
      { kind: 'concept', passage: 1, text: passages[0] },
      { kind: 'detail', passage: 1, text: passages[2] },
      { kind: 'summary', passage: 99, text: passages[3] },
    ],
    passages,
  );
  assert.equal(composed.dropped, 0);
  assert.deepEqual(composed.used, [0, 2, 3]);
});

/* ==========================================================================
   the same question twice in one course
   ========================================================================== */

test('a question the course has already asked is not asked again', async () => {
  // A live course contained the same question stem twice. The generator writes
  // each section in isolation and cannot know, so the seam that sees every call
  // tells it what has been asked and drops a repeat that arrives anyway.
  const events = [];
  let call = 0;
  const shared = 'What is electrostatic discharge?';
  const ask = async (model, system, prompt) => {
    if (system.includes('instructional designer')) {
      return {
        title: 'Electrostatic discharge',
        objectives: [
          'Explain electrostatic discharge damage to a sensitive semiconductor device',
          'Explain the grounding precautions that prevent electrostatic discharge damage',
        ],
      };
    }
    if (LESSON_SYSTEM.test(system)) {
      const numbered = [...prompt.matchAll(/\[(\d+)\] ([^\n]+)/g)];
      return lessonElements(numbered[0][2], Number(numbered[0][1]));
    }
    if (system.includes('"items"')) {
      call += 1;
      return {
        refused: false,
        items: [
          {
            stem: `Question ${call}: what damage does an electrostatic discharge do to a sensitive device?`,
            options: ['Latent damage', 'None'],
            answerIndex: 0,
            rationale: 'An electrostatic discharge can damage a sensitive semiconductor device and the damage is latent.',
          },
          {
            stem: shared,
            options: ['The sudden transfer of static charge', 'A grounding strap'],
            answerIndex: 0,
            rationale: 'Electrostatic discharge is the sudden transfer of static charge between two objects at different electrical potentials.',
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'Electrostatic discharge?', back: 'The sudden transfer of static charge.' }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
  const course = await draftCourse(
    { objectives: [], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  const stems = course.sections.flatMap((section) => [...section.pre, ...section.post]).map((q) => q.stem);
  assert.equal(stems.filter((stem) => stem === shared).length, 1, stems.join(' | '));
  assert.ok(events.some((event) => event.step === 'duplicate-question'));
  // And no phase was emptied to achieve it.
  for (const section of course.sections) {
    assert.ok(section.pre.length > 0 && section.post.length > 0);
  }
});

test('de-duplication never empties a phase that has only one question', async () => {
  // The guard on the rule above. Coursewright treats an empty items list as a
  // refusal and validateCourseDraft treats an empty phase as fatal, so dropping
  // the last question to save a repeat would cost the whole draft. This fixture
  // returns the SAME single stem for every phase of every section.
  const course = await draftCourse(
    {
      title: 'MAGTF intelligence',
      objectives: MAGTF_OBJECTIVES.slice(0, 2),
      documents: MAGTF_DOCUMENTS,
      diagrams: false,
    },
    { load: upstream, ask: magtfAsk() },
  );
  assert.equal(course.sections.length, 2);
  for (const section of course.sections) {
    assert.equal(section.pre.length, 1);
    assert.equal(section.post.length, 1);
  }
});

/* ==========================================================================
   a parallel form with something to be parallel to
   ========================================================================== */

/* Coursewright asks for the pre-test and the post-test with two independent
   calls over byte-identical input -- same passage union, same cite, same
   objective -- and never shows the second what the first produced, so "a
   PARALLEL FORM vs a pre-test" is an instruction with no pre-test in it. These
   two sets are what a model writes when it IS told. Every stem and rationale
   reuses a coursebook sentence, because Coursewright grounds the phase's
   combined claims against the passages before it accepts them. */
const PRE_ITEMS = [
  {
    stem: 'What is an electrostatic discharge?',
    options: [
      'The sudden transfer of static charge between two objects at different electrical potentials',
      'A bonded wrist strap tested before every shift',
    ],
    answerIndex: 0,
    rationale:
      'Electrostatic discharge is the sudden transfer of static charge between two objects at different electrical potentials.',
  },
  {
    stem: 'How small a discharge can damage a sensitive semiconductor device?',
    options: ['As little as thirty volts', 'No less than three hundred volts'],
    answerIndex: 0,
    rationale:
      'An electrostatic discharge of as little as thirty volts can damage a sensitive semiconductor device.',
  },
];
const POST_ITEMS = [
  {
    stem: 'Why is latent electrostatic discharge damage the most expensive kind?',
    options: [
      'A damaged sensitive device passes its test and fails later in service',
      'A damaged sensitive device is caught on the bench and replaced',
    ],
    answerIndex: 0,
    rationale:
      'Electrostatic discharge damage is latent: a damaged sensitive device passes its test and fails later in service.',
  },
  {
    stem: 'Why is a wrist strap tested before every shift?',
    options: [
      'Grounding that is never checked does not prevent damage',
      'The strap wears out after one shift of use',
    ],
    answerIndex: 0,
    rationale:
      'The common electrostatic discharge error is trusting an unbonded wrist strap. Grounding that is never checked does not prevent damage, so a wrist strap is tested before every shift.',
  },
];

/* One ESD course from one explicit objective, with the question calls under the
   test's control and everything else answered honestly. `questions` is handed
   the question prompt and returns the items for it, which is how a fixture
   models a model that can or cannot see the pre-test. */
function parallelFormAsk(questions) {
  const prompts = [];
  const ask = async (model, system, prompt) => {
    if (LESSON_SYSTEM.test(system)) {
      const numbered = [...prompt.matchAll(/\[(\d+)\] ([^\n]+)/g)];
      return lessonElements(numbered[0][2], Number(numbered[0][1]));
    }
    if (system.includes('"items"')) {
      prompts.push(prompt);
      return { refused: false, items: questions(prompt) };
    }
    if (system.includes('"cards"')) {
      return {
        refused: false,
        cards: [{
          front: 'What is an electrostatic discharge?',
          back: 'The sudden transfer of static charge between two objects at different electrical potentials.',
        }],
      };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
  return { ask, prompts };
}

const SHOWN_THE_PRE_TEST = 'The pre-test for THIS objective';

test('the post-check is shown the pre-check it is supposed to be a parallel form of', async () => {
  const events = [];
  const { ask, prompts } = parallelFormAsk((prompt) =>
    (prompt.includes(SHOWN_THE_PRE_TEST) ? POST_ITEMS : PRE_ITEMS));
  const course = await draftCourse(
    { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  assert.equal(prompts.length, 2, 'one pre call and one post call');
  assert.ok(!prompts[0].includes(SHOWN_THE_PRE_TEST), 'the pre call has no pre-test to be shown');
  // The whole item, options included: the live duplicate repeated the stem AND
  // its four options, which a list of bare stems does not rule out.
  for (const item of PRE_ITEMS) {
    assert.ok(prompts[1].includes(item.stem), `post call must carry "${item.stem}"`);
    for (const option of item.options) {
      assert.ok(prompts[1].includes(option), `post call must carry the option "${option}"`);
    }
  }

  const [section] = course.sections;
  assert.deepEqual(section.pre.map((q) => q.stem), PRE_ITEMS.map((q) => q.stem));
  assert.deepEqual(section.post.map((q) => q.stem), POST_ITEMS.map((q) => q.stem));
  for (const question of section.post) {
    assert.ok(
      !section.pre.some((earlier) => earlier.stem === question.stem),
      'a post-check is never a verbatim repeat of its own pre-check',
    );
  }
});

test('a post-check that repeats its pre-check anyway is asked again, with the repeats named', async () => {
  // The prompt is the primary defence; this is what happens when the model
  // ignores it. One more call, naming exactly what was rejected -- the same
  // shape the outline repair uses.
  const events = [];
  const { ask, prompts } = parallelFormAsk((prompt) =>
    (prompt.includes('A previous attempt was rejected') ? POST_ITEMS : PRE_ITEMS));
  const course = await draftCourse(
    { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  assert.equal(prompts.length, 3, 'pre, a post that repeated it, and one retry');
  const retried = events.find((event) => event.step === 'duplicate-question' && event.retried);
  assert.ok(retried, 'the repeat is reported, not silently swapped');
  assert.deepEqual(retried.stems, PRE_ITEMS.map((q) => q.stem));
  assert.equal(retried.phase, 'post');

  const [section] = course.sections;
  assert.deepEqual(section.post.map((q) => q.stem), POST_ITEMS.map((q) => q.stem));
  assert.ok(section.pre.length > 0 && section.post.length > 0, 'neither phase was emptied');
});

test('a model that repeats whatever it is told still leaves both phases with questions', async () => {
  // The floor. Coursewright reads an empty items list as a refusal and
  // validateCourseDraft treats an empty phase as fatal, so the last resort is
  // to keep the repeat and REPORT it -- losing the section costs more than a
  // duplicate does, and the report is what puts it in front of the reviewer.
  const events = [];
  const { ask, prompts } = parallelFormAsk(() => PRE_ITEMS);
  const course = await draftCourse(
    { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  assert.equal(prompts.length, 3, 'the retry was spent before giving up');
  const [section] = course.sections;
  assert.equal(section.pre.length, 2);
  assert.equal(section.post.length, 2, 'a phase is never emptied to avoid a repeat');
  assert.ok(
    events.some((event) => event.step === 'duplicate-question' && event.kept),
    'a repeat that survives both prompts is reported rather than hidden',
  );
});

/* ==========================================================================
   a citation is a locator, and a locator is not prose
   ========================================================================== */

/* The same coursebook, recorded under a real source record id. A citation is
   stored as "<record id> p.<n>" on purpose (lib/learning/core.js
   `sourcePassages`), and Coursewright puts that label in front of the model on
   every section call as "Citation: ...". */
const LOCATOR_RECORD = 'cmu4xdph30016s6014fn9n9y8';
const LOCATOR_DOCUMENTS = ESD_PAGES.map((page) => ({
  source: `${LOCATOR_RECORD} p.${page.page}`,
  text: page.text,
}));

test('a generated question never carries the source record id into its prose', async () => {
  // Live: "...without a supported connection to this capability. Source:
  // cmu4xdph30016s6014fn9n9y8 p.135." The rationale is persisted on the Item,
  // shown to a learner when they answer a check and carried into the SCORM
  // export, so no presentation fix reaches it.
  const attributed = (items) => items.map((item) => ({
    ...item,
    stem: `${item.stem} (see ${LOCATOR_RECORD} p.41)`,
    rationale: `${item.rationale} Source: ${LOCATOR_RECORD} p.41.`,
  }));
  const { ask, prompts } = parallelFormAsk((prompt) =>
    attributed(prompt.includes(SHOWN_THE_PRE_TEST) ? POST_ITEMS : PRE_ITEMS));
  const course = await draftCourse(
    { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE], documents: LOCATOR_DOCUMENTS, diagrams: false },
    { load: upstream, ask },
  );

  for (const prompt of prompts) {
    assert.match(prompt, /Never write a citation, source name, record id/);
  }
  const questions = course.sections.flatMap((section) => [...section.pre, ...section.post]);
  assert.equal(questions.length, 4);
  for (const question of questions) {
    assert.doesNotMatch(question.stem, new RegExp(LOCATOR_RECORD));
    assert.doesNotMatch(question.rationale, new RegExp(LOCATOR_RECORD));
    assert.doesNotMatch(question.rationale, /Source:/);
    // Only the locator goes. The reasoning is the thing the learner is shown.
    assert.ok(question.rationale.trim().length > 20, question.rationale);
    assert.ok(question.stem.trim().length > 10, question.stem);
  }
  // And the citation itself is untouched: it is still the locator, on the
  // section, where every surface resolves it to a publication name.
  assert.match(course.sections[0].cite, new RegExp(`^${LOCATOR_RECORD} p\\.`));
});

/* ==========================================================================
   one lesson per objective, and never the same objective twice
   ========================================================================== */

test('an outline that restates a neighbouring objective is reported, not failed', () => {
  // A live course shipped four consecutive near-identical "Demand-Pull ..."
  // sections. Exact duplicates were already rejected; near-identical ones were
  // not, and they retrieve the same passages and repeat each other's questions.
  const documents = [{
    text: 'Demand-pull distribution in the MAGTF moves supplies forward only on a validated request from the supported unit.',
  }];
  const restated = validateCourseOutline(
    {
      objectives: [
        'Explain demand-pull distribution in the MAGTF',
        'Describe demand pull distribution for the MAGTF',
      ],
    },
    { documents },
  );
  // Still caught -- the pair differs only in its verb.
  assert.equal(restated.restatements.length, 1);
  assert.equal(restated.restatements[0].at, 1);
  assert.match(restated.restatements[0].reason, /restates outline.objectives\[0\]/);
  // But no longer fatal. A duplicated teaching point costs a section; refusing
  // to generate costs the instructor the whole course.
  assert.equal(restated.valid, true);
  assert.deepEqual(restated.issues, []);

  // A definition and the thing that validates it share a subject and are not
  // the same objective, so the rule must leave them alone.
  const distinct = validateCourseOutline(
    {
      objectives: [
        'Explain demand-pull distribution in the MAGTF',
        'Identify who validates a supported unit request before supplies move forward',
      ],
    },
    { documents },
  );
  assert.deepEqual(distinct.issues, []);
  assert.deepEqual(distinct.restatements, []);
});

/* The regression this rule nearly shipped a product-breaking version of.
   These four objectives were typed by hand by an instructor against a joint
   operations coursebook, and the old both-ways-0.75-containment rule refused
   the whole generation: "outline.objectives[1] restates outline.objectives[0]".
   They share four of five content tokens because they are written in parallel,
   which is what every POI and every T&R standard looks like. */
const JOINT_PRINCIPLES_OBJECTIVES = [
  'Explain the principle of objective in joint operations.',
  'Explain the principle of mass in joint operations.',
  'Explain the principle of unity of command in joint operations.',
  'Describe how confirmation bias can distort military planning.',
];

const JOINT_PRINCIPLES_DOCUMENT = {
  text: [
    'The principle of objective directs every military operation toward a clearly defined, decisive and attainable objective.',
    'The principle of mass concentrates the effects of combat power at the most advantageous place and time.',
    'The principle of unity of command ensures unity of effort under one responsible commander for every objective.',
    'Confirmation bias can distort military planning when a planner weighs evidence that supports a preferred course of action.',
  ].join('\n\n'),
};

test('parallel objectives that differ in their subject are not restatements', () => {
  const validated = validateCourseOutline(
    { objectives: JOINT_PRINCIPLES_OBJECTIVES },
    { documents: [JOINT_PRINCIPLES_DOCUMENT] },
  );
  // All four survive: nothing is dropped and nothing is reported.
  assert.deepEqual(validated.restatements, []);
  assert.deepEqual(validated.issues, []);
  assert.equal(validated.valid, true);
  assert.equal(validated.objectives.length, 4);
});

/* The four objectives above, against a coursebook that teaches all four --
   driven through the whole of draftCourse, because validateCourseOutline
   returning no issue is only half the fix. The live failure was
   COURSE_OBJECTIVE_INVALID thrown out of the explicit-objectives branch, which
   is a different code path from the outline branch the unit test covers. */
const JOINT_PRINCIPLES_PAGES = [
  {
    page: 1,
    text: 'In joint operations the principle of objective directs every military operation toward a clearly defined, decisive and attainable objective that contributes to the purpose of the operation.',
  },
  {
    page: 2,
    text: 'In joint operations the principle of mass concentrates the effects of combat power at the most advantageous place and time to produce decisive results.',
  },
  {
    page: 3,
    text: 'In joint operations the principle of unity of command ensures unity of effort under one responsible commander for every objective the force pursues.',
  },
  {
    page: 4,
    text: 'Confirmation bias can distort military planning when a planner weighs evidence that supports a preferred course of action and discounts evidence that contradicts it.',
  },
];

const JOINT_PRINCIPLES_RECORD = 'joint-principles-record';

const JOINT_PRINCIPLES_DOCUMENTS = JOINT_PRINCIPLES_PAGES.map((page) => ({
  source: `${JOINT_PRINCIPLES_RECORD} p.${page.page}`,
  text: page.text,
}));

/* Teaches strictly from whatever passage it is handed, so every artifact clears
   the grounding floor on its own merits and the test is measuring the objective
   rule rather than the fixture's generosity. */
function passageAsk() {
  const calls = [];
  const plain = (text) => String(text).trim().replace(/\s*\.$/, '');
  const sourcePassage = (prompt) => {
    const match = /Source passage:\n"([\s\S]*?)"\n/.exec(prompt);
    return match ? match[1] : '';
  };
  const ask = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('instructional designer')) {
      return { title: 'Joint operations', objectives: JOINT_PRINCIPLES_OBJECTIVES };
    }
    if (system.includes('course title')) return { title: 'Principles of joint operations' };
    if (LESSON_SYSTEM.test(system)) {
      const numbered = [...prompt.matchAll(/\[(\d+)\] ([^\n]+)/g)].map((match) => ({
        passage: Number(match[1]),
        text: match[2],
      }));
      if (numbered.length === 0) return { refused: true, reason: 'no passages in the prompt' };
      const [first] = numbered;
      return {
        refused: false,
        elements: [
          { kind: 'concept', passage: first.passage, text: first.text },
          { kind: 'why', passage: first.passage, text: `This matters because ${plain(first.text)}.` },
          { kind: 'summary', passage: first.passage, text: `In summary, ${plain(first.text)}.` },
        ],
      };
    }
    if (system.includes('"items"')) {
      const passage = sourcePassage(prompt);
      if (!passage) return { refused: true, reason: 'no passage' };
      return {
        refused: false,
        items: [{
          stem: `Which statement is correct: ${plain(passage)}?`,
          options: ['Correct as stated', 'Not as stated'],
          answerIndex: 0,
          rationale: passage,
        }],
      };
    }
    if (system.includes('"cards"')) {
      const passage = sourcePassage(prompt);
      if (!passage) return { refused: true, reason: 'no passage' };
      return { refused: false, cards: [{ front: 'What does the passage state?', back: passage }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
  return { ask, calls };
}

test('four hand-typed parallel objectives generate four sections', async () => {
  // The live refusal, verbatim: "Course objective validation failed:
  // outline.objectives[1] restates outline.objectives[0]" -- thrown on four
  // objectives an instructor typed on purpose, for four different principles of
  // joint operations, because they share the words that frame all four.
  const { ask } = passageAsk();
  const course = await draftCourse(
    {
      objectives: JOINT_PRINCIPLES_OBJECTIVES,
      documents: JOINT_PRINCIPLES_DOCUMENTS,
      diagrams: false,
    },
    { load: upstream, ask },
  );
  assert.equal(course.sections.length, 4);
  assert.equal(course.objectives.length, 4);
  assert.deepEqual(course.skippedObjectives, undefined);
  for (const section of course.sections) {
    assert.equal(section.refused, undefined, section.reason);
    assert.ok(section.lesson);
  }
});

test('a genuine restatement costs its own section, never the whole draft', async () => {
  // The rule still does its job on the input it was built for -- and does it by
  // dropping one objective and naming it, which is how every other uncovered
  // objective is already reported. Nothing here is fatal.
  const { ask } = passageAsk();
  const events = [];
  const course = await draftCourse(
    {
      objectives: [
        ...JOINT_PRINCIPLES_OBJECTIVES,
        // Same teaching point as the first, in a different mood.
        'Describe the principle of objective in joint operations.',
      ],
      documents: JOINT_PRINCIPLES_DOCUMENTS,
      diagrams: false,
    },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );
  assert.equal(course.sections.length, 4);
  // Said live as well as saved: the progress modal folds this into the same
  // "not covered by this course" list the retrieval skips feed.
  const restated = events.filter((event) => event.step === 'restated');
  assert.equal(restated.length, 1);
  assert.equal(restated[0].section, 'Describe the principle of objective in joint operations.');
  assert.match(restated[0].reason, /already teaches/);
  assert.equal(course.skippedObjectives.length, 1);
  assert.equal(
    course.skippedObjectives[0].objective,
    'Describe the principle of objective in joint operations.',
  );
  assert.match(course.skippedObjectives[0].reason, /restates "Explain the principle of objective/);
});

test('a restatement is the verb changing, not the subject', () => {
  const documents = [{
    text: [
      'The six intelligence functions are support to force generation, support to situational understanding,',
      'provide indications and warning, support to force protection, support to targeting, and support to',
      'information operations. Each intelligence function is performed continuously.',
    ].join(' '),
  }];

  // Same teaching point, different Bloom verb: caught.
  const reworded = validateCourseOutline(
    {
      objectives: [
        'Identify the six intelligence functions',
        'List the six intelligence functions',
      ],
    },
    { documents },
  );
  assert.equal(reworded.restatements.length, 1);
  assert.equal(reworded.restatements[0].at, 1);
  assert.equal(reworded.restatements[0].of, 'Identify the six intelligence functions');

  // Same verb, different subject: left alone, however parallel the phrasing.
  const parallel = validateCourseOutline(
    {
      objectives: [
        'Identify the six intelligence functions',
        'Identify the six warfighting functions',
      ],
    },
    {
      documents: [{
        text: `${documents[0].text} The six warfighting functions are command and control, fires, manoeuvre, logistics, intelligence and force protection.`,
      }],
    },
  );
  assert.deepEqual(parallel.restatements, []);
});

test('a restatement is repaired with the rest of the outline, not failed outright', async () => {
  // The restatement rule joins the bounded repair pass every other outline rule
  // already uses: the model never sees the validator, so it is told which rule
  // it broke and asked once more.
  let attempt = 0;
  const { ask, calls } = esdAsk();
  const repairing = async (model, system, prompt) => {
    calls.push({ model, system, prompt });
    if (system.includes('instructional designer')) {
      attempt += 1;
      return attempt === 1
        ? {
            title: 'Electrostatic discharge',
            objectives: [ESD_OBJECTIVE, ESD_OBJECTIVE.replace('Explain', 'Describe')],
          }
        : { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE] };
    }
    return ask(model, system, prompt);
  };
  const course = await draftCourse(
    { objectives: [], documents: ESD_DOCUMENTS, diagrams: false },
    { load: upstream, ask: repairing },
  );
  assert.deepEqual(course.objectives, [ESD_OBJECTIVE]);
  const repair = calls.find((call) => /A previous attempt was rejected/.test(call.prompt || ''));
  assert.match(repair.prompt, /restates outline.objectives\[0\]/);
});

/* ==========================================================================
   a POI is a specification, not content
   ========================================================================== */

/* A lesson card from a real-shaped program of instruction: the terminal
   objective, its enabling objectives, their codes, the hours, the references --
   and not one sentence that teaches any of it. */
const POI_PAGE = [
  'LESSON ID: ELEC.01.02 TITLE: Electrostatic Discharge PHASE: 1',
  'HOURS: 2.0',
  'TYPE: Task Oriented',
  'TERMINAL LEARNING OBJECTIVE',
  '2871-ELEC-1001. Without the aid of references, identify electrostatic discharge damage to a sensitive device.',
  'ENABLING LEARNING OBJECTIVES',
  '2871-ELEC-1001a. Without the aid of references, identify the grounding precautions that prevent electrostatic discharge.',
  '2871-ELEC-1001b. Without the aid of references, identify soldering iron tip temperature tolerances.',
  'REFERENCES: Basic Electronics Coursebook',
].join('\n');
const POI_DOCUMENT = { source: 'poi-record p.7', text: POI_PAGE };

test('a program of instruction is recognised by shape, and a coursebook is not', () => {
  assert.equal(looksLikeObjectiveList(POI_PAGE), true);

  // The 220-page coursebook opens chapters with an objectives panel. Declining
  // that page as grounding is right; declining the publication is not, and a
  // per-source verdict would have done exactly that.
  const panel = [
    'Learning Objectives',
    'At the end of this chapter you will be able to identify electrostatic discharge damage.',
    '',
    ESD_PAGES[0].text,
    ESD_PAGES[1].text,
  ].join('\n');
  assert.equal(looksLikeObjectiveList(panel), false);
  for (const page of ESD_PAGES) assert.equal(looksLikeObjectiveList(page.text), false);
  assert.equal(looksLikeObjectiveList(DOCTRINE_PROSE), false);
  assert.equal(looksLikeObjectiveList(''), false);
});

test('objectives come from the POI and grounding comes from the corpus', async () => {
  // The live failure, and the fix. "Basic Electronics Course 7.0.0 POI Combined
  // Report" refused with "The passage LISTS ESD learning objectives and
  // references but does not DESCRIBE ESD characteristics". The POI won
  // retrieval because it states the objective in the objective's own words, and
  // then had nothing to teach from.
  const events = [];
  const { ask, calls } = esdAsk();
  const course = await draftCourse(
    { objectives: [], documents: [POI_DOCUMENT, ...ESD_DOCUMENTS], diagrams: false },
    { load: upstream, ask, emit: (event) => events.push(event) },
  );

  // The outline is shown both, labelled, and told which is which.
  const outline = calls.find((call) => call.model === 'coursewright-outline');
  assert.match(outline.system, /LEARNING TARGETS come from a program of instruction/);
  assert.match(outline.prompt, /LEARNING TARGETS/);
  assert.match(outline.prompt, /CONTENT PASSAGES/);
  assert.ok(outline.prompt.indexOf(POI_PAGE) < outline.prompt.indexOf('CONTENT PASSAGES'));
  assert.ok(outline.prompt.indexOf(ESD_PAGES[0].text) > outline.prompt.indexOf('CONTENT PASSAGES'));

  // No lesson is grounded in the POI, however well it scores.
  const [section] = course.sections;
  assert.equal(section.refused, undefined, section.reason);
  assert.equal(section.cite.startsWith('poi-record'), false);
  assert.equal(section.cites.some((cite) => cite.startsWith('poi-record')), false);
  const lesson = calls.find((call) => LESSON_SYSTEM.test(call.system));
  assert.equal(lesson.prompt.includes('TERMINAL LEARNING OBJECTIVE'), false);

  // And the roles are reported, so the generation view can say what it has.
  const sources = events.find((event) => event.phase === 'sources');
  assert.equal(sources.objectivePassages, 1);
  assert.equal(sources.contentPassages, 4);
});

test('a target the corpus does not cover is named as exactly that', async () => {
  // The most valuable sentence this product can say: your program of
  // instruction asks for this and your sources do not teach it. Never an
  // invented lesson, and never a refusal the instructor cannot act on.
  const uncovered = 'Identify soldering iron tip temperature tolerances';
  const { ask } = esdAsk();
  const course = await draftCourse(
    { objectives: [], documents: [POI_DOCUMENT, ...ESD_DOCUMENTS], diagrams: false },
    {
      load: upstream,
      ask: async (model, system, prompt) => {
        if (system.includes('instructional designer')) {
          return { title: 'Electrostatic discharge', objectives: [ESD_OBJECTIVE, uncovered] };
        }
        return ask(model, system, prompt);
      },
    },
  );
  assert.deepEqual(course.objectives, [ESD_OBJECTIVE]);
  assert.deepEqual(course.skippedObjectives, [
    {
      objective: uncovered,
      reason: 'the program of instruction asks for this and no content source covers it',
    },
  ]);
});

test('a POI on its own is refused once, up front, not once per section', async () => {
  // Today this produced one confusing refusal per section after one model call
  // per section. There is nothing to teach from and nothing a model can add, so
  // it is said before any of them.
  await assert.rejects(
    () => draftCourse(
      { objectives: [], documents: [POI_DOCUMENT], diagrams: false },
      { load: upstream, ask: async () => { throw new Error('the model must never be called'); } },
    ),
    (error) =>
      error.code === 'COURSE_CONTENT_SOURCE_REQUIRED' &&
      error.status === 422 &&
      /state learning objectives but do not teach them/.test(error.message),
  );
});

test('a stated role beats the heuristic in both directions', async () => {
  // Inference is the default, not the only answer. Nothing in the app sets a
  // role yet; when the source library grows one, this is the seam it uses.
  const { ask, calls } = esdAsk();
  await draftCourse(
    {
      objectives: [],
      documents: [
        // A POI page the instructor insists is content...
        { ...POI_DOCUMENT, role: 'content' },
        // ...and a page of real content they have marked as targets.
        { ...ESD_DOCUMENTS[0], role: 'objectives' },
        ...ESD_DOCUMENTS.slice(1),
      ],
      diagrams: false,
    },
    { load: upstream, ask },
  );
  const outline = calls.find((call) => call.model === 'coursewright-outline');
  assert.ok(outline.prompt.indexOf(ESD_PAGES[0].text) < outline.prompt.indexOf('CONTENT PASSAGES'));
  assert.ok(outline.prompt.indexOf(POI_PAGE) > outline.prompt.indexOf('CONTENT PASSAGES'));
});

/* ---------- an approved rubric IS the mastery plan ----------
 *
 * Rubricon writes a BARS scale and a human approves it; Whetstone grades a
 * learner against mastery criteria. Those were two separate artifacts derived
 * from the same source by two separate model calls, so an instructor could
 * approve one rubric and have their learners graded against a different, never
 * approved one. These tests pin the connection: where a human has ratified the
 * words, those words are the ones a learner is graded against. */

const GUN_SOURCE = [
  'The gunner confirms the weapon is clear before handling it.',
  'The gunner announces a misfire and waits five seconds before opening the feed tray cover.',
  'The assistant gunner keeps the belt flat and free of twists while feeding the weapon.',
].join(' ');

const CLEARING_OBJECTIVE = 'Clear and handle the weapon safely';
const FEEDING_OBJECTIVE = 'Feed the weapon without inducing a stoppage';

function approvedGunRubric(overrides = {}) {
  return {
    id: 'rubric-clearing',
    status: 'APPROVED',
    objective: CLEARING_OBJECTIVE,
    rubric: {
      flagged: false,
      dimensions: [
        {
          name: 'Confirms the weapon is clear before handling',
          source: 'confirms the weapon is clear before handling it',
          anchors: {
            unsatisfactory: 'Handles the weapon before it is confirmed clear.',
            satisfactory: 'Confirms the weapon is clear before handling it.',
            proficient: 'Confirms the weapon is clear and announces it before handling it.',
          },
        },
        {
          name: 'Announces a misfire before opening the feed tray cover',
          source: 'announces a misfire and waits five seconds',
          anchors: {
            unsatisfactory: 'Opens the feed tray cover without announcing the misfire.',
            satisfactory: 'Announces a misfire and waits five seconds before opening the feed tray cover.',
            proficient: 'Announces a misfire, waits five seconds, then opens the feed tray cover.',
          },
        },
      ],
    },
    ...overrides,
  };
}

const FEEDING_CRITERION = {
  elo: 'Keeps the belt flat and free of twists while feeding',
  indicators: {
    developing: 'Feeds the weapon with a twisted belt.',
    competent: 'Keeps the belt flat while feeding the weapon.',
    mastered: 'Keeps the belt flat and free of twists while feeding the weapon.',
  },
};

test('an approved rubric becomes its objective mastery criteria without a model call', async () => {
  let asked = 0;
  const plan = await deriveMasteryPlan(
    {
      objectives: [CLEARING_OBJECTIVE],
      source: GUN_SOURCE,
      sourceId: 'source-gun',
      ratifiedRubrics: [approvedGunRubric()],
    },
    {
      load: upstream,
      deriveRubric: async () => {
        asked += 1;
        return { criteria: [FEEDING_CRITERION] };
      },
    },
  );
  // The whole point: the words a human approved are the words used, and no
  // second rubric was invented to sit beside them.
  assert.equal(asked, 0);
  assert.deepEqual(plan.criteria.map((criterion) => criterion.elo), [
    'Confirms the weapon is clear before handling',
    'Announces a misfire before opening the feed tray cover',
  ]);
  assert.deepEqual(plan.criteria[0].indicators, {
    developing: 'Handles the weapon before it is confirmed clear.',
    competent: 'Confirms the weapon is clear before handling it.',
    mastered: 'Confirms the weapon is clear and announces it before handling it.',
  });
  assert.deepEqual(plan.criteria[0].provenance, {
    origin: 'RATIFIED',
    rubricId: 'rubric-clearing',
    objective: CLEARING_OBJECTIVE,
    dimension: 'Confirms the weapon is clear before handling',
    sourcePhrase: 'confirms the weapon is clear before handling it',
  });
  assert.deepEqual(plan.provenance, {
    origin: 'RATIFIED',
    total: 2,
    ratified: 2,
    derived: 0,
    rubricIds: ['rubric-clearing'],
    objectives: [CLEARING_OBJECTIVE],
  });
  assert.equal(
    validateMasteryPlan(plan, { sourceText: GUN_SOURCE, sourceId: 'source-gun' }).valid,
    true,
  );
});

test('a flagged or unapproved rubric can never become mastery criteria', async () => {
  const flagged = approvedGunRubric({
    rubric: {
      flagged: true,
      reason: 'The standard is too subjective to anchor.',
      needsSME: 'Define what safe handling looks like.',
    },
  });
  // Rubricon flags a standard it refuses to anchor and approveRubric rejects
  // the result outright, so a flagged rubric reaching the mastery path is a
  // routing defect. Fail loudly rather than skipping it into the model path,
  // where the failure would be invisible.
  assert.throws(() => masteryCriteriaFromRubric(flagged), /flagged for an SME/);
  await assert.rejects(
    () =>
      deriveMasteryPlan(
        {
          objectives: [CLEARING_OBJECTIVE],
          source: GUN_SOURCE,
          sourceId: 'source-gun',
          ratifiedRubrics: [flagged],
        },
        { load: upstream, deriveRubric: async () => ({ criteria: [FEEDING_CRITERION] }) },
      ),
    (error) => error.code === 'MASTERY_PLAN_RUBRIC_NOT_APPROVED',
  );
  await assert.rejects(
    () =>
      deriveMasteryPlan(
        {
          objectives: [CLEARING_OBJECTIVE],
          source: GUN_SOURCE,
          sourceId: 'source-gun',
          ratifiedRubrics: [approvedGunRubric({ status: 'PENDING' })],
        },
        { load: upstream, deriveRubric: async () => ({ criteria: [FEEDING_CRITERION] }) },
      ),
    (error) => error.code === 'MASTERY_PLAN_RUBRIC_NOT_APPROVED',
  );
});

test('an objective with no approved rubric still derives, and the plan admits the mixture', async () => {
  const asked = [];
  const plan = await deriveMasteryPlan(
    {
      objectives: [CLEARING_OBJECTIVE, FEEDING_OBJECTIVE],
      source: GUN_SOURCE,
      sourceId: 'source-gun',
      ratifiedRubrics: [approvedGunRubric()],
    },
    {
      load: upstream,
      deriveRubric: async (objectives) => {
        asked.push(objectives);
        return { criteria: [FEEDING_CRITERION] };
      },
    },
  );
  // The model is asked about the objective nobody has ratified, and only that
  // one: it cannot restate or contradict a competency a human already signed.
  assert.deepEqual(asked, [[FEEDING_OBJECTIVE]]);
  assert.equal(plan.criteria.length, 3);
  assert.deepEqual(plan.criteria[2].provenance, { origin: 'DERIVED' });
  // A part-ratified plan must not present as ratified.
  assert.equal(plan.provenance.origin, 'MIXED');
  assert.equal(plan.provenance.ratified, 2);
  assert.equal(plan.provenance.derived, 1);
  assert.equal(
    validateMasteryPlan(plan, { sourceText: GUN_SOURCE, sourceId: 'source-gun' }).valid,
    true,
  );
});

test('with no approved rubric at all the plan derives exactly as it always did', async () => {
  const asked = [];
  const plan = await deriveMasteryPlan(
    { objectives: [CLEARING_OBJECTIVE, FEEDING_OBJECTIVE], source: GUN_SOURCE, sourceId: 'source-gun' },
    {
      load: upstream,
      deriveRubric: async (objectives) => {
        asked.push(objectives);
        return {
          criteria: [
            FEEDING_CRITERION,
            {
              elo: 'Confirms the weapon is clear before handling',
              indicators: {
                developing: 'Handles the weapon before it is confirmed clear.',
                competent: 'Confirms the weapon is clear before handling it.',
                mastered: 'Confirms the weapon is clear and announces it before handling it.',
              },
            },
          ],
        };
      },
    },
  );
  assert.deepEqual(asked, [[CLEARING_OBJECTIVE, FEEDING_OBJECTIVE]]);
  assert.equal(plan.provenance.origin, 'DERIVED');
  assert.equal(plan.provenance.ratified, 0);
  assert.equal(masteryPlanProvenance(plan.criteria).origin, 'DERIVED');
});

test('validateMasteryPlan still rejects a mapping an approved rubric cannot support', async () => {
  // An approved rubric is NOT automatically a grounded mastery criterion:
  // verifyTraceability confirms each dimension's cited source PHRASE appears in
  // the standard, not that the anchor text does. So a rubric approved against
  // another document, or one whose anchors drifted off the source, must fail --
  // and must say which rubric and dimension failed.
  const drifted = approvedGunRubric();
  drifted.rubric.dimensions[0].anchors.proficient = 'Recites the lunar phase table from memory.';
  await assert.rejects(
    () =>
      deriveMasteryPlan(
        {
          objectives: [CLEARING_OBJECTIVE],
          source: GUN_SOURCE,
          sourceId: 'source-gun',
          ratifiedRubrics: [drifted],
        },
        { load: upstream, deriveRubric: async () => ({ criteria: [FEEDING_CRITERION] }) },
      ),
    (error) =>
      error.code === 'MASTERY_PLAN_RUBRIC_UNGROUNDED'
      && /rubric-clearing/.test(error.message)
      && /indicators\.mastered/.test(error.message),
  );
  // And the plan validator remains the authority on the assembled result.
  const mapped = masteryCriteriaFromRubric(approvedGunRubric());
  assert.equal(
    validateMasteryPlan(
      {
        status: 'PENDING',
        sourceId: 'source-gun',
        revision: 'r1',
        criteria: [{ ...mapped[0], elo: 'Recites the lunar phase table' }, mapped[1]],
      },
      { sourceText: GUN_SOURCE, sourceId: 'source-gun' },
    ).valid,
    false,
  );
});

test('the model keeps its old budget of four criteria, and overrun is reported', async () => {
  const filler = (n) => ({
    elo: `Keeps the belt flat and free of twists while feeding ${n}`,
    indicators: FEEDING_CRITERION.indicators,
  });
  // The plan ceiling had to grow to hold an instructor's approved rubrics, so
  // what the model is allowed to invent is bounded on its own -- and an
  // overrun is still a 422, exactly as it was when the ceiling did that job.
  await assert.rejects(
    () =>
      deriveMasteryPlan(
        { objectives: [FEEDING_OBJECTIVE], source: GUN_SOURCE, sourceId: 'source-gun' },
        {
          load: upstream,
          deriveRubric: async () => ({
            criteria: [filler(1), filler(2), filler(3), filler(4), filler(5)],
          }),
        },
      ),
    (error) => error.code === 'MASTERY_PLAN_INVALID' && /remaining slot/.test(error.message),
  );
});
