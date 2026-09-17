import test from 'node:test';
import assert from 'node:assert/strict';
import { narratesTheLesson, groundLessonPages } from '../lib/arsenal-core.js';
import { withoutNarration } from '../lib/learning/narration.js';
import { lessonPagesForSection } from '../lib/learning/lesson-pages.js';

// Observed verbatim in the course generated from the AY27 coursebook on
// 2026-09-17. Every one of these passed the grounding floor, because narrating
// a passage reuses the passage's own words.
test('narration observed in a real generation is caught', () => {
  for (const line of [
    'The lesson says that leaders are responsible for the learning environment.',
    'The lesson begins by exposing you to the levels of war.',
    'This passage explains how the operational level links tactics to strategy.',
    'The reading covers the three levels of war.',
    'According to the passage, the commander owns the decision.',
    'As the lesson explains, doctrine is authoritative but requires judgment.',
    'You will be exposed to the principles of mission command.',
    'This module also introduces the planning process.',
  ]) {
    assert.equal(narratesTheLesson(line), true, line);
  }
});

// The expensive failure is the other direction: a true sentence deleted
// because it happened to contain a listed word.
test('teaching prose about doctrine that owns these words is left alone', () => {
  for (const line of [
    'War is fought at three levels: strategic, operational and tactical.',
    'Section 3 of the order states the commander’s intent.',
    'Chapter 2 defines the six warfighting functions.',
    'The document is authoritative; departure from it requires judgment.',
    'The operational level links tactical actions to strategic objectives.',
    'Read the passage in the order the commander signed it.',
    'A lesson learned during Desert Storm shaped this doctrine.',
    'Cover and concealment are not the same thing.',
    'The course of action must be feasible, acceptable and suitable.',
  ]) {
    assert.equal(narratesTheLesson(line), false, line);
  }
});

test('empty and non-string input is not narration', () => {
  for (const value of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(narratesTheLesson(value), false, String(value));
  }
});

const PASSAGE =
  'War is fought at three levels. The strategic level sets national objectives. ' +
  'The operational level links tactical actions to strategic objectives through ' +
  'campaigns. The tactical level is the ordered arrangement of forces in battle. ' +
  'Leaders are responsible for the learning environment and for the climate in ' +
  'which subordinates are willing to report error honestly.';

test('a narrating block is dropped and the reason names it', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: 'War is fought at three levels: strategic, operational and tactical.',
      pages: [
        {
          title: 'The levels of war',
          blocks: [
            { type: 'p', text: 'The lesson begins by exposing you to the three levels of war.' },
            {
              type: 'p',
              text: 'The operational level links tactical actions to strategic objectives through campaigns.',
            },
          ],
        },
      ],
      labels: [],
    },
    PASSAGE,
  );
  assert.ok(grounded, 'the page survives on its teaching block');
  assert.equal(grounded.pages.length, 1);
  assert.equal(grounded.pages[0].blocks.length, 1);
  assert.match(grounded.pages[0].blocks[0].text, /operational level/);
  assert.ok(
    grounded.dropped.some((entry) => entry.includes('narrates the lesson')),
    `dropped should say why: ${JSON.stringify(grounded.dropped)}`,
  );
});

test('a narrating heading is dropped even though headings make no claim', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [
        {
          title: 'The levels of war',
          blocks: [
            { type: 'h', text: 'What this lesson covers' },
            { type: 'h', text: 'The three levels' },
            { type: 'p', text: 'The strategic level sets national objectives.' },
          ],
        },
      ],
      labels: [],
    },
    PASSAGE,
  );
  assert.ok(grounded);
  const headings = grounded.pages[0].blocks.filter((block) => block.type === 'h').map((block) => block.text);
  assert.deepEqual(headings, ['The three levels']);
});

test('a page that is nothing but narration does not reach the learner', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [
        {
          title: 'About this lesson',
          blocks: [
            { type: 'p', text: 'The lesson says that war is fought at three levels.' },
            { type: 'p', text: 'This page then describes the operational level.' },
          ],
        },
      ],
      labels: [],
    },
    PASSAGE,
  );
  assert.equal(grounded, null, 'nothing survives, so the caller falls back to the micro-lesson');
});

test('the intro may still orient the learner', () => {
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: 'In this lesson you will learn the three levels of war and how the operational level links them.',
      pages: [{ title: 'Levels', blocks: [{ type: 'p', text: 'The strategic level sets national objectives.' }] }],
      labels: [],
    },
    PASSAGE,
  );
  assert.ok(grounded);
  assert.match(grounded.intro, /^In this lesson/, 'the intro is exempt by design');
});


// ASTRA's own quotes from sections 1 and 9, where the narration hangs off a
// copula rather than an exposition verb. The first version of this detector
// missed both.
test('narration carried by a copula is caught', () => {
  for (const line of [
    'The lesson is built to cover what learning means to Marines.',
    'The lesson is organized in a sequence: first the Department of the Navy, then the functions.',
    'This lesson also places learning in a larger setting.',
    'The lesson will show you the characteristics of a successful Marine learner.',
    'This module has three parts.',
    'The reading was written to prepare you for the practical application.',
  ]) {
    assert.equal(narratesTheLesson(line), true, line);
  }
});

test('withoutNarration keeps the doctrine in a half-blurb paragraph', () => {
  const sentences = [
    'The lesson is built to cover what learning means to Marines. ',
    'Learning is a change in behavior that results from experience. ',
    'This lesson also places learning in a larger setting. ',
    'A successful Marine learner is self-directed and reflective.',
  ];
  assert.deepEqual(withoutNarration(sentences), [sentences[1], sentences[3]]);
});

test('withoutNarration returns nothing when every sentence narrates', () => {
  assert.deepEqual(
    withoutNarration(['The lesson says three things. ', 'The lesson then covers the fourth.']),
    [],
  );
  assert.deepEqual(withoutNarration(null), []);
});

// The cliff this closes: pages dropped as narration fall back to the
// micro-lesson, which on a chapter-introduction section is the same blurb.
test('the micro-lesson fallback does not reintroduce the blurb', () => {
  const { items } = lessonPagesForSection({
    title: 'What learning means',
    lesson:
      'The lesson is built to cover what learning means to Marines. ' +
      'Learning is a change in behavior that results from experience. ' +
      'This lesson also places learning in a larger setting.',
  });
  const pages = items.filter((item) => item.type === 'page');
  const prose = pages.flatMap((page) => (page.blocks || []).filter((b) => b.type === 'p').map((b) => b.text));
  assert.ok(prose.length > 0, 'the teaching sentence still reaches the learner');
  for (const text of prose) {
    assert.equal(narratesTheLesson(text), false, `narration survived the fallback: ${text}`);
  }
  assert.ok(prose.some((text) => /change in behavior/.test(text)));
});

test('a section that is nothing but narration gets no lesson page', () => {
  const { items } = lessonPagesForSection({
    title: 'About this lesson',
    lesson: 'The lesson is built to cover what learning means. This lesson also places learning in a setting.',
  });
  const prose = items
    .filter((item) => item.type === 'page')
    .flatMap((page) => (page.blocks || []).filter((b) => b.type === 'p').map((b) => b.text));
  assert.equal(
    prose.some((text) => /built to cover|places learning/.test(text)),
    false,
    'the blurb must not be shown as though it were a lesson',
  );
});
