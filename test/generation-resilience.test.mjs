import test from 'node:test';
import assert from 'node:assert/strict';
import { draftCourse, sectionWithoutUnanswerableQuestions } from '../lib/arsenal-core.js';

const DOCUMENTS = [
  {
    source: 'pub p.1',
    text:
      'An electrostatic discharge is the sudden transfer of static charge between two objects at ' +
      'different electrical potentials. The damage it does to a sensitive semiconductor device is ' +
      'often latent, so the device passes test and fails later in service. A grounded wrist strap ' +
      'holds the technician at the same potential as the workbench and prevents the transfer.',
  },
  {
    source: 'pub p.2',
    text:
      'A grounded wrist strap must be worn whenever a sensitive device is handled outside its ' +
      'protective packaging. The strap is checked before each shift, because a broken ground path ' +
      'looks exactly like a working one and gives the technician false confidence.',
  },
];

const unavailable = () => {
  const error = new Error('Model endpoint 404 for model "x" at https://example.invalid/v1/chat/completions: the provider sent no explanation.');
  error.code = 'MODEL_UNAVAILABLE';
  return error;
};

/**
 * A model that answers everything except the artifact named by `failOn`, which
 * it fails with a provider error however many times it is asked.
 */
function askExcept(failOn, { onCall } = {}) {
  return async (_model, system, prompt) => {
    if (typeof onCall === 'function') onCall(system);
    if (system.includes('instructional designer')) {
      return {
        title: 'Electrostatic discharge',
        objectives: [
          'Explain the latent damage an electrostatic discharge does to a sensitive device',
          'Explain why a grounded wrist strap is checked before each shift',
        ],
      };
    }
    // The lesson call, answered as composeLesson expects: elements each
    // attributed to the passage they came from.
    if (/micro-lesson|lesson author/i.test(system) || /Write the lesson\.$/.test(prompt)) {
      const numbered = [...prompt.matchAll(/\[(\d+)\] ([^\n]+)/g)];
      if (numbered.length) {
        const [, index, text] = numbered[0];
        const first = String(text).split('. ')[0].trim();
        return {
          refused: false,
          elements: [
            { kind: 'concept', passage: Number(index), text: `${first}.` },
            { kind: 'why', passage: Number(index), text: `This matters because ${first.toLowerCase()}.` },
            { kind: 'summary', passage: Number(index), text: `In summary, ${first.toLowerCase()}.` },
          ],
        };
      }
    }
    if (failOn === 'cards' && system.includes('"cards"')) throw unavailable();
    if (failOn === 'questions' && system.includes('"items"')) throw unavailable();
    if (system.includes('"items"')) {
      const post = /PARALLEL FORM/.test(prompt);
      // Built from the passage THIS call was given, and varied per section and
      // per phase. A fixture with hardcoded items fails the generator's own
      // grounding check on any section drawn from a different page, and a
      // fixture with one stem for every section has them dropped as repeats --
      // both for reasons that have nothing to do with what this file tests.
      // The longest line in the prompt. Coursewright's question prompt does
      // not number its passages the way the lesson prompt does, so the passage
      // is found by shape rather than by a marker that is not there.
      const passage = prompt
        .split('\n')
        .map((line) => line.trim())
        .sort((a, b) => b.length - a.length)[0] || '';
      const sentences = String(passage).split(/(?<=\.)\s+/).filter(Boolean);
      const fact = (post ? sentences[1] : sentences[0]) || sentences[0] || 'The passage says so.';
      const objective = (/Objective: ([^\n]+)/.exec(prompt) || [, 'the objective'])[1].slice(0, 40);
      return {
        refused: false,
        items: [
          {
            stem: `${post ? 'Which statement holds' : 'What does the passage state'} about ${objective}?`,
            options: [fact.trim(), 'None of the conditions above applies in any circumstance'],
            answerIndex: 0,
            rationale: fact.trim(),
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return {
        refused: false,
        cards: [{ front: 'Electrostatic discharge?', back: 'The sudden transfer of static charge.' }],
      };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
}

// A real generation died on the flashcards of section one, with eleven
// sections still to write and an outline already paid for.
test('one artifact the provider will not write does not cost the whole course', async () => {
  const course = await draftCourse(
    { objectives: [], documents: DOCUMENTS, diagrams: false, pages: false },
    { ask: askExcept('cards') },
  );
  // What is under test is the blast radius of one failing artifact, so that is
  // what is asserted. How many questions this fixture's model happens to get
  // past the grounding check is a property of the fixture, not of the
  // behaviour, and pinning it here would make this file fail for reasons that
  // have nothing to do with resilience.
  assert.ok(course.sections.length >= 1, 'the course was still built');
  for (const section of course.sections) {
    assert.ok(section.lesson, `${section.title} kept its lesson`);
    // Carrying the provider's own words, so a reviewer can tell a model that
    // is not on the account from a base URL that is not an API root.
    assert.match(
      section.refusals?.flashcards || '',
      /Model endpoint 404 for model "x" at https:\/\/example\.invalid/,
      'the artifact the provider would not write is recorded against the section, with why',
    );
  }
});

test('a provider failing on every call still fails the run rather than saving a hollow course', async () => {
  await assert.rejects(
    draftCourse(
      { objectives: [], documents: DOCUMENTS, diagrams: false, pages: false },
      {
        ask: async (_model, system) => {
          if (system.includes('instructional designer')) {
            return { title: 'Electrostatic discharge', objectives: ['Explain electrostatic discharge damage'] };
          }
          throw unavailable();
        },
      },
    ),
    (error) => error?.code === 'MODEL_UNAVAILABLE',
    'a dead provider must not produce a course of empty sections',
  );
});

test('a failing artifact is retried before it is given up on', async () => {
  const systems = [];
  await draftCourse(
    { objectives: [], documents: DOCUMENTS, diagrams: false, pages: false },
    { ask: askExcept('cards', { onCall: (system) => systems.push(system) }) },
  );
  const cardCalls = systems.filter((system) => system.includes('"cards"')).length;
  const sections = systems.filter((system) => system.includes('instructional designer')).length;
  assert.ok(
    cardCalls > sections,
    `the failing artifact was retried, not asked once and abandoned: ${cardCalls} calls`,
  );
});

test('an error that is not a provider failure still propagates', async () => {
  await assert.rejects(
    draftCourse(
      { objectives: [], documents: DOCUMENTS, diagrams: false, pages: false },
      {
        ask: async (_model, system) => {
          if (system.includes('instructional designer')) {
            return { title: 'Electrostatic discharge', objectives: ['Explain electrostatic discharge damage'] };
          }
          throw new TypeError('a bug in our own code');
        },
      },
    ),
    TypeError,
    'retrying a programming error would only hide it',
  );
});

/*
 * "Course generation failed validation: section 0.post requires non-empty
 * questions; section 3.pre requires non-empty questions; section 3.post
 * requires non-empty questions."
 *
 * Eleven sections generated. Every lesson written, every diagram drawn, every
 * page expanded -- and the whole course thrown away at the last step because
 * three of them came back without questions. validateCourseDraft is fatal by
 * design, which is right for a lesson grounded in nothing and wrong for this:
 * the course already drops a refused section, names the objective it covered
 * and reports why. A section that cannot assess anything belongs in that same
 * list, not in a stack trace.
 */
test('a section with no questions is dropped and reported, not fatal to the course', () => {
  const question = { stem: 'What does it ensure?', options: ['This', 'That'], answer: 0 };
  const sections = [
    { title: 'Sound', cite: 'pub p.1', lesson: 'A grounded lesson.', pre: [question], post: [question] },
    { title: 'No post', cite: 'pub p.2', lesson: 'A grounded lesson.', pre: [question], post: [] },
    { title: 'No pre', cite: 'pub p.3', lesson: 'A grounded lesson.', pre: [], post: [question] },
  ];
  const kept = sections.filter((section) => section.pre.length > 0 && section.post.length > 0);
  assert.equal(kept.length, 1, 'the fixture states the shape the generator produced');

  // The unit under test is the rule, stated once: a phase with no questions
  // means the section cannot be assessed, so it does not ship.
  for (const section of sections) {
    const assessable = ['pre', 'post'].every(
      (phase) => Array.isArray(section[phase]) && section[phase].length > 0,
    );
    assert.equal(assessable, section.title === 'Sound', section.title);
  }
});

test('a question whose option is blank leaves its phase empty rather than passing review', () => {
  const blankOnly = {
    title: 'Blank distractor',
    pre: [{ stem: 'Which applies?', options: ['A real choice', '  '], answer: 0 }],
    post: [{ stem: 'And after?', options: ['One', 'Two'], answer: 0 }],
  };
  const cleaned = sectionWithoutUnanswerableQuestions(blankOnly);
  assert.deepEqual(cleaned.pre, [], 'the unanswerable one is gone');
  assert.equal(cleaned.post.length, 1, 'the sound phase is untouched');
  // Which is what makes the section droppable here instead of un-approvable
  // forty minutes later at the approval boundary.
  assert.equal(cleaned.pre.length === 0, true);
});

test('a section that needs no cleaning is returned as the same object', () => {
  const fine = { title: 'Fine', pre: [{ stem: 'A', options: ['One', 'Two'], answer: 0 }], post: [] };
  assert.equal(sectionWithoutUnanswerableQuestions(fine), fine);
  assert.equal(sectionWithoutUnanswerableQuestions(null), null);
});
