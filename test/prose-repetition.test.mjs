import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionProse, openingPhrase, tooSimilar, sentencesOf } from '../lib/learning/repetition.js';
import { groundLessonPages, expandCoursePages } from '../lib/arsenal-core.js';

const JOINT =
  'The combatant commanders are responsible for the planning and execution of joint operations.';
const RESTATED =
  'The combatant commanders are responsible for planning and the execution of joint operations worldwide.';
const STAFF =
  'The Joint Staff supports the Chairman in advising the President and the Secretary on joint matters.';

test('openingPhrase normalises the frame a reader recognises', () => {
  assert.equal(openingPhrase('This matters because authority must sit somewhere.'), 'this matters because authority');
  assert.equal(openingPhrase('  This  matters, because authority must sit somewhere.'), 'this matters because authority');
  assert.equal(openingPhrase('Taken together, the three levels describe one war.'), 'taken together the three');
  assert.equal(openingPhrase('Too short.'), '', 'nothing to recognise in three words');
  assert.equal(openingPhrase(null), '');
});

// ASTRA: section 5 repeats this sentence in two consecutive paragraphs.
test('a restated sentence is recognised, a different one is not', () => {
  assert.equal(tooSimilar(JOINT, RESTATED), true);
  assert.equal(tooSimilar(JOINT, STAFF), false);
});

test('short sentences are allowed to recur', () => {
  assert.equal(tooSimilar('This is required.', 'This is required.'), false);
  assert.equal(tooSimilar('The answer is no.', 'The answer is no.'), false);
});

test('sentencesOf keeps punctuation and handles a paragraph with no terminator', () => {
  assert.deepEqual(sentencesOf('One. Two!'), ['One. ', 'Two!']);
  assert.deepEqual(sentencesOf('No terminator here'), ['No terminator here']);
  assert.deepEqual(sentencesOf(''), []);
});

test('the section memory keeps the first statement and drops the restatement', () => {
  const said = createSectionProse();
  assert.equal(said.keepNew(JOINT), JOINT);
  assert.equal(said.keepNew(RESTATED), '');
  assert.equal(said.keepNew(STAFF), STAFF);
});

test('a half-restated paragraph keeps the half that is new', () => {
  const said = createSectionProse();
  said.keepNew(JOINT);
  const kept = said.keepNew(
    JOINT + ' They exercise combatant command authority over assigned forces under title ten.',
  );
  assert.match(kept, /combatant command authority/);
  assert.doesNotMatch(kept, /responsible for the planning/);
});

const PASSAGE =
  'The combatant commanders are responsible for the planning and execution of joint operations ' +
  'in their areas of responsibility. They exercise combatant command authority over assigned ' +
  'forces under title ten of the United States Code. The Joint Staff supports the Chairman in ' +
  'advising the President and the Secretary of Defense on joint matters.';

test('a restated paragraph does not reach the learner, and the drop says why', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [{ title: 'Combatant command', blocks: [{ type: 'p', text: JOINT }, { type: 'p', text: RESTATED }] }],
      labels: [],
    },
    PASSAGE,
  );
  assert.equal(grounded.pages[0].blocks.length, 1);
  assert.ok(grounded.dropped.some((entry) => entry.includes('already said')), JSON.stringify(grounded.dropped));
});

test('the check runs across pages, not just neighbouring blocks', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [
        { title: 'One', blocks: [{ type: 'p', text: JOINT }] },
        { title: 'Two', blocks: [{ type: 'p', text: STAFF }] },
        { title: 'Three', blocks: [{ type: 'p', text: RESTATED }] },
      ],
      labels: [],
    },
    PASSAGE,
  );
  assert.deepEqual(
    grounded.pages.map((page) => page.title),
    ['One', 'Two'],
    'page three was nothing but a restatement',
  );
});

test('grounding stays pure: the input blocks are not edited in place', () => {
  const input = {
    refused: false,
    intro: '',
    pages: [{ title: 'Combatant command', blocks: [{ type: 'p', text: `${JOINT} ${RESTATED}` }] }],
    labels: [],
  };
  const before = input.pages[0].blocks[0].text;
  const first = groundLessonPages(input, PASSAGE);
  assert.equal(input.pages[0].blocks[0].text, before, 'the input block was not trimmed');
  const second = groundLessonPages(input, PASSAGE);
  assert.deepEqual(second.pages, first.pages, 'a second call yields the same pages');
});

test('later sections are told which openings the course has already spent', async () => {
  const seen = [];
  const sections = [
    { title: 'A', lesson: 'x', cite: 'p.1' },
    { title: 'B', lesson: 'x', cite: 'p.1' },
    { title: 'C', lesson: 'x', cite: 'p.1' },
  ];
  const passage =
    'This matters because the commander owns the decision and the staff owns the analysis that ' +
    'supports it in the planning and execution of joint operations under a combatant commander.';
  let call = 0;
  const ask = async (_role, _system, prompt) => {
    seen.push(prompt);
    call += 1;
    // askJson hands the ask's value straight back, so a mock returns the
    // object rather than the JSON text a real provider would send.
    return {
      refused: false,
      intro: '',
      pages: [
        {
          title: 'Page',
          blocks: [
            {
              type: 'p',
              text:
                `This matters because the commander owns the decision ${call} and the staff owns ` +
                'the analysis that supports it in the planning and execution of joint operations.',
            },
          ],
        },
      ],
      labels: [],
    };
  };
  await expandCoursePages({ sections, passageFor: () => passage }, { ask });

  assert.equal(seen.length, 3);
  assert.doesNotMatch(seen[0], /already open paragraphs/, 'nothing is spent before the first section');
  assert.doesNotMatch(seen[1], /already open paragraphs/, 'one use is a coincidence, not a habit');
  assert.match(seen[2], /already open paragraphs/, 'by the third, the course knows the habit');
  assert.match(seen[2], /this matters because the/);
});
