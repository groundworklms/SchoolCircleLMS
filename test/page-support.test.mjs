import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distinctiveTerms,
  itemClaim,
  itemsBeyondPages,
  pageText,
  termsNotOnPage,
} from '../lib/learning/page-support.js';
import { learnerCourseProjection } from '../lib/learning/core.js';

// ASTRA section 9: the page is a roadmap of the Department of the Navy and
// every item is about the Coast Guard.
const NAVY_SECTION = {
  title: 'Marine and Navy organizations',
  pages: [
    {
      title: 'Marine and Navy organizations',
      blocks: [
        {
          type: 'p',
          text:
            'The Department of the Navy comprises the United States Navy and the United States ' +
            'Marine Corps. The Navy provides platforms, fleets and functions across the maritime domain.',
        },
        {
          type: 'p',
          text:
            'The Marine Corps organizes for combat as Marine Air-Ground Task Forces, which combine ' +
            'command, ground, aviation and logistics elements under a single commander.',
        },
      ],
    },
  ],
  pre: [
    {
      stem: 'Within which department does the Coast Guard reside, and under which titles does it support DoD?',
      options: [
        'The Department of Homeland Security, under Titles 10 and 14 of the U.S. Code',
        'The Department of the Navy',
        'The Department of the Army',
        'The Department of State',
      ],
      answer: 0,
      rationale:
        'The passage states that the Coast Guard is a unique Military Service residing within the ' +
        'Department of Homeland Security.',
    },
    {
      stem: 'Which elements make up a Marine Air-Ground Task Force?',
      options: [
        'Command, ground, aviation and logistics elements',
        'Fleets and platforms only',
        'Titles 10 and 14',
        'Ice operations and port security',
      ],
      answer: 0,
      rationale:
        'The Marine Corps organizes for combat as Marine Air-Ground Task Forces combining command, ' +
        'ground, aviation and logistics elements.',
    },
  ],
  post: [],
};

test('pageText gathers every string a learner can read, and nothing else', () => {
  const text = pageText({
    intro: 'An intro sentence.',
    pages: [
      {
        title: 'Page title',
        blocks: [
          { type: 'p', text: 'A paragraph.' },
          { type: 'terms', entries: [['Term', 'A definition.']] },
          { type: 'example', title: 'Worked example', steps: ['Step one.'], result: 'A result.' },
          { type: 'accordion', entries: [{ title: 'Case', text: 'An explanation.' }] },
        ],
      },
    ],
  });
  for (const part of [
    'An intro sentence.',
    'Page title',
    'A paragraph.',
    'Term',
    'A definition.',
    'Step one.',
    'A result.',
    'An explanation.',
  ]) {
    assert.match(text, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), part);
  }
});

test('itemClaim reads the stem, the keyed answer and the rationale, never a distractor', () => {
  const claim = itemClaim({
    stem: 'Which authority is inherent in COCOM?',
    options: ['Operational control', 'A plausible wrong answer'],
    answer: 0,
    rationale: 'OPCON is inherent in COCOM.',
  });
  assert.match(claim, /Which authority/);
  assert.match(claim, /Operational control/);
  assert.match(claim, /OPCON is inherent/);
  assert.doesNotMatch(claim, /plausible wrong answer/, 'a distractor is supposed to be wrong');
});

test('an item about something the page never covers is reported', () => {
  const beyond = itemsBeyondPages(NAVY_SECTION);
  assert.equal(beyond.length, 1, JSON.stringify(beyond));
  assert.equal(beyond[0].phase, 'pre');
  assert.equal(beyond[0].index, 0);
  assert.match(beyond[0].stem, /Coast Guard/);
  assert.ok(beyond[0].overlap < 0.25);
});

test('an item the page does teach is left alone', () => {
  const beyond = itemsBeyondPages(NAVY_SECTION);
  assert.equal(
    beyond.some((entry) => entry.index === 1),
    false,
    'the MAGTF item is answerable from the page and must not be reported',
  );
});

test('a section still on its micro-lesson reports nothing', () => {
  assert.deepEqual(itemsBeyondPages({ lesson: 'A paragraph.', pre: NAVY_SECTION.pre, post: [] }), []);
  assert.deepEqual(itemsBeyondPages({}), []);
  assert.deepEqual(itemsBeyondPages(null), []);
});

// ASTRA P1.1: the page says "the act and later reforms"; the item names the
// statute. Overlap cannot see this -- one term out of forty barely moves a
// ratio -- so the distinctive-term check is what catches it.
const CHIEFS_SECTION = {
  pages: [
    {
      title: 'Service Chiefs',
      blocks: [
        {
          type: 'p',
          text:
            'Under the act and later reforms, the Service Chiefs are responsible for organizing, ' +
            'training and equipping their forces. They do not exercise operational command over ' +
            'forces assigned to combatant commanders.',
        },
      ],
    },
  ],
};

test('a named statute the page never mentions is reported', () => {
  const item = {
    stem: 'Under the Goldwater-Nichols DoD Reorganization Act of 1986, what is the primary responsibility of the Service Chiefs?',
    options: ['To organize, train and equip their forces', 'To exercise operational command', 'x', 'y'],
    answer: 0,
    rationale: 'The Service Chiefs are responsible for organizing, training and equipping their forces.',
  };
  assert.equal(itemsBeyondPages({ ...CHIEFS_SECTION, pre: [item], post: [] }).length, 0, 'overlap alone passes it');
  assert.deepEqual(termsNotOnPage(item, CHIEFS_SECTION), ['Goldwater-Nichols DoD Reorganization Act', '1986']);
});

test('an item that stays inside the page reports no missing terms', () => {
  const item = {
    stem: 'What are the Service Chiefs responsible for?',
    options: ['Organizing, training and equipping their forces', 'x', 'y', 'z'],
    answer: 0,
    rationale: 'The Service Chiefs organize, train and equip their forces.',
  };
  assert.deepEqual(termsNotOnPage(item, CHIEFS_SECTION), []);
});

// ASTRA P4.4: acronyms used and never expanded where the learner can see them.
test('an acronym the page never expands is reported once, without its furniture', () => {
  const item = {
    stem: 'Which NME element sets strategy?',
    options: ['The Secretary of Defense', 'x', 'y', 'z'],
    answer: 0,
    rationale: 'The NME includes the Secretary of Defense.',
  };
  assert.deepEqual(termsNotOnPage(item, CHIEFS_SECTION), ['NME']);
});

test('distinctiveTerms keeps names and drops sentence case', () => {
  const terms = [...distinctiveTerms('Which statement best describes the Department of the Navy in 1986?').values()];
  assert.deepEqual(terms, ['1986'], 'single ordinary capitalised words are sentence case');
  assert.deepEqual(
    [...distinctiveTerms('The Goldwater-Nichols Act changed the Joint Staff.').values()],
    ['Goldwater-Nichols Act', 'Joint Staff'],
  );
  assert.deepEqual([...distinctiveTerms('').values()], []);
  assert.deepEqual([...distinctiveTerms(null).values()], []);
});

// This field quotes stems, post-test stems included. It is review evidence for
// the author and an answer-key sketch for anyone else.
test('itemsBeyondPages never reaches a learner', () => {
  const projected = learnerCourseProjection({
    title: 'A course',
    sections: [
      {
        title: 'A section',
        cite: 'pub p.1',
        itemsBeyondPages: [{ phase: 'post', index: 0, stem: 'A post-test stem', terms: ['NME'] }],
      },
    ],
  });
  const wire = JSON.stringify(projected);
  assert.doesNotMatch(wire, /itemsBeyondPages/);
  assert.doesNotMatch(wire, /A post-test stem/);
});
