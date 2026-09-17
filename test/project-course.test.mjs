import assert from 'node:assert/strict';
import test from 'node:test';

import { projectCourseRows, withPreservedItemStatus } from '../lib/learning/project-course.js';

const DRAFT = {
  title: 'Marksmanship fundamentals',
  sourceIds: ['src_1'],
  sections: [
    {
      title: 'Aiming',
      cite: 'src_1 p.7',
      lesson: 'Sight alignment is the relationship between the front sight post and the rear aperture.',
      pre: [{ stem: 'Where does the post sit?', options: ['Left', 'Centred'], answer: 1 }],
      post: [{ stem: 'Why does alignment matter?', options: [{ text: 'It does not' }, { text: 'Error grows with range' }], answer: 1, rationale: 'Angular error.' }],
    },
    { title: '', lesson: '   ', pre: [{ stem: '' }] },
  ],
  scenario: { situation: 'You are on the 300 m line.', task: 'Call the correction.', coaching: 'Check alignment first. [1]' },
};

test('projects a Coursewright draft into course, sections and pending items with stable ids', () => {
  const rows = projectCourseRows('rec_1', DRAFT, { sourceId: 'TC 3-22.9' });

  assert.deepEqual(rows.course, { id: 'rec_1', title: 'Marksmanship fundamentals', sourceId: 'TC 3-22.9' });
  assert.equal(rows.sections.length, 3);

  const [aiming, empty, scenario] = rows.sections;
  assert.equal(aiming.id, 'rec_1:s1');
  assert.equal(aiming.order, 0);
  assert.deepEqual(aiming.items.map((i) => [i.id, i.kind]), [
    ['rec_1:s1:lesson', 'LESSON'],
    ['rec_1:s1:pre1', 'QUESTION'],
    ['rec_1:s1:post1', 'QUESTION'],
  ]);
  // The section's cite grounds every item in it; page parsed from "p.N".
  for (const item of aiming.items) {
    // Generation proposes; a human ratifies. Nothing is materialised APPROVED.
    assert.equal(item.status, 'PENDING');
    assert.deepEqual(item.citation, { citation: 'src_1 p.7', pubId: 'TC 3-22.9', page: '7' });
  }
  assert.deepEqual(aiming.items[1].options, ['Left', 'Centred']);
  assert.equal(aiming.items[1].answer, 1);
  assert.deepEqual(aiming.items[2].options, ['It does not', 'Error grows with range']);
  assert.equal(aiming.items[2].rationale, 'Angular error.');

  // Blank lesson text and blank stems never become items; the section keeps its slot.
  assert.equal(empty.title, 'Section 2');
  assert.deepEqual(empty.items, []);

  assert.equal(scenario.id, 'rec_1:scenario');
  assert.equal(scenario.items[0].kind, 'SCENARIO');
  assert.equal(scenario.items[0].status, 'PENDING');
  assert.match(scenario.items[0].stem, /300 m line[\s\S]*Call the correction/);
});

// Materialisation is the generator's output and always proposes PENDING. A
// status a human already recorded for the same item id is a decision, and a
// rewrite must not quietly discard it (or, worse, promote it).
test('re-materialisation keeps a status a human already recorded', () => {
  const { sections } = projectCourseRows('rec_1', DRAFT, { sourceId: 'TC 3-22.9' });
  const preserved = withPreservedItemStatus(sections, {
    'rec_1:s1:lesson': 'APPROVED',
    'rec_1:s1:pre1': 'REJECTED',
  });

  const [aiming] = preserved;
  assert.deepEqual(aiming.items.map((item) => [item.id, item.status]), [
    ['rec_1:s1:lesson', 'APPROVED'],
    ['rec_1:s1:pre1', 'REJECTED'],
    ['rec_1:s1:post1', 'PENDING'],
  ]);
  // Only the status moves; content, citation and ids are untouched.
  assert.deepEqual(
    preserved.map((s) => s.items.map((i) => ({ ...i, status: 'PENDING' }))),
    sections.map((s) => s.items),
  );
});

test('preservation accepts a Map, ignores unknown ids and never invents APPROVED', () => {
  const { sections } = projectCourseRows('rec_1', DRAFT, { sourceId: 'TC 3-22.9' });
  const viaMap = withPreservedItemStatus(sections, new Map([['rec_1:s1:post1', 'APPROVED']]));
  assert.equal(viaMap[0].items[2].status, 'APPROVED');
  assert.equal(viaMap[0].items[0].status, 'PENDING');

  // A PENDING row on record, a junk value, or no record at all all leave the
  // proposal as it is -- nothing here can promote an item on its own.
  for (const recorded of [undefined, null, 'PENDING', 'SOMETHING_ELSE']) {
    const out = withPreservedItemStatus(sections, { 'rec_1:s1:lesson': recorded });
    assert.equal(out[0].items[0].status, 'PENDING');
  }
  assert.deepEqual(withPreservedItemStatus(undefined, undefined), []);
});

test('is deterministic, so re-approval replaces rather than duplicates', () => {
  const a = projectCourseRows('rec_2', DRAFT, { sourceId: 'TC 3-22.9' });
  const b = projectCourseRows('rec_2', DRAFT, { sourceId: 'TC 3-22.9' });
  assert.deepEqual(a, b);
});

test('tolerates a bare payload', () => {
  const rows = projectCourseRows('rec_3', {});
  assert.equal(rows.course.title, 'Untitled course');
  assert.equal(rows.course.sourceId, 'unknown');
  assert.deepEqual(rows.sections, []);
  assert.throws(() => projectCourseRows('', {}), TypeError);
});

/* ---------------- per-item citation resolution ----------------
 *
 * A section is grounded in up to four passages since the top-K widening, but
 * `cite` names only the highest-scoring one. Stamping it onto every item makes
 * the per-item review screen show a question drawn from the third passage with
 * the FIRST passage's page number, and then asks a human to ratify it. These
 * tests assert the resolved behaviour against the old behaviour directly: the
 * same draft, projected with and without the passage index.
 */

const PAGE_4 =
  'Sight alignment is the relationship between the front sight post and the rear aperture. The post must be centred in the aperture and level across its top edge.';
const PAGE_5 =
  'Trigger control is the smooth rearward pressure applied straight to the rear without disturbing the sights. Jerking the trigger drives the muzzle off the target.';
const PAGE_6 =
  'A natural point of aim is where the rifle settles when the body is relaxed. Shift the hips rather than muscling the weapon onto the target.';

// The shape lib/arsenal-core.js `sourcePassageIndex` produces: every page part
// carries the bare source labels plus its own "<label> p.N".
const PASSAGES = [
  { labels: ['src_1', 'src_1 p.4'], text: PAGE_4 },
  { labels: ['src_1', 'src_1 p.5'], text: PAGE_5 },
  { labels: ['src_1', 'src_1 p.6'], text: PAGE_6 },
];

function unionDraft(overrides = {}) {
  return {
    title: 'Marksmanship fundamentals',
    sourceIds: ['src_1'],
    sections: [
      {
        title: 'Fundamentals',
        cite: 'src_1 p.4',
        cites: ['src_1 p.4', 'src_1 p.5', 'src_1 p.6'],
        lesson: 'Sight alignment is the relationship between the front sight post and the rear aperture.',
        pre: [{
          stem: 'What does jerking the trigger disturb?',
          options: ['The muzzle', 'The aperture'],
          answer: 0,
          rationale:
            'Jerking the trigger drives the muzzle off the target; smooth rearward pressure straight to the rear does not.',
        }],
        post: [{
          stem: 'How is a natural point of aim corrected?',
          options: ['Shift the hips', 'Muscle the weapon across'],
          answer: 0,
          rationale:
            'A natural point of aim is where the rifle settles when the body is relaxed; shift the hips rather than muscling the weapon.',
        }],
        ...overrides,
      },
    ],
  };
}

const citedPages = (rows) =>
  rows.sections[0].items.map((item) => [item.id, item.citation.citation, item.citation.page]);

const citedLabels = (rows) => [...new Set(citedPages(rows).map(([, cite]) => cite))];

test('an item drawn from the second or third passage cites THAT passage, not the primary', () => {
  const draft = unionDraft();

  // Before: one label, three items, two of them wrong. This is the bug.
  assert.deepEqual(citedPages(projectCourseRows('rec_k', draft, { sourceId: 'TC 3-22.9' })), [
    ['rec_k:s1:lesson', 'src_1 p.4', '4'],
    ['rec_k:s1:pre1', 'src_1 p.4', '4'],
    ['rec_k:s1:post1', 'src_1 p.4', '4'],
  ]);

  // After: the lesson is p.4's prose, the pre-test question is drawn from p.5
  // and the post-test question from p.6, and each is cited where it came from.
  const resolved = projectCourseRows('rec_k', draft, { sourceId: 'TC 3-22.9', passages: PASSAGES });
  assert.deepEqual(citedPages(resolved), [
    ['rec_k:s1:lesson', 'src_1 p.4', '4'],
    ['rec_k:s1:pre1', 'src_1 p.5', '5'],
    ['rec_k:s1:post1', 'src_1 p.6', '6'],
  ]);
  // Only the citation moves. The publication id still names the approved source.
  for (const item of resolved.sections[0].items) {
    assert.equal(item.citation.pubId, 'TC 3-22.9');
    assert.equal(item.status, 'PENDING');
  }
});

test('per-item resolution is deterministic, so re-approval still replaces rather than duplicates', () => {
  const options = { sourceId: 'TC 3-22.9', passages: PASSAGES };
  assert.deepEqual(
    projectCourseRows('rec_k', unionDraft(), options),
    projectCourseRows('rec_k', unionDraft(), options),
  );
});

test('a section with a single label is unchanged, index or no index', () => {
  const single = unionDraft({ cites: ['src_1 p.4'] });
  const before = projectCourseRows('rec_k', single, { sourceId: 'TC 3-22.9' });
  const after = projectCourseRows('rec_k', single, { sourceId: 'TC 3-22.9', passages: PASSAGES });
  // The p.5 and p.6 questions are plainly not from p.4 -- but p.4 is the only
  // page this section declared, so p.4 is the only page it may cite.
  assert.deepEqual(after, before);
  assert.deepEqual(citedLabels(after), ['src_1 p.4']);
});

test('a draft with no cites materialises exactly as it did before', () => {
  const legacy = unionDraft();
  delete legacy.sections[0].cites;
  assert.deepEqual(
    projectCourseRows('rec_k', legacy, { sourceId: 'TC 3-22.9', passages: PASSAGES }),
    projectCourseRows('rec_k', legacy, { sourceId: 'TC 3-22.9' }),
  );
  // And the whole original fixture: blank section, scenario and all.
  assert.deepEqual(
    projectCourseRows('rec_1', DRAFT, { sourceId: 'TC 3-22.9', passages: PASSAGES }),
    projectCourseRows('rec_1', DRAFT, { sourceId: 'TC 3-22.9' }),
  );
});

test('a near tie keeps the primary rather than flipping on noise', () => {
  // Two pages that say almost the same thing. The items are grounded in both,
  // and the second is fractionally closer -- one token of the item's own
  // vocabulary. That is not evidence of provenance, so the primary stands.
  const nearTie = [
    { labels: ['src_1', 'src_1 p.4'], text: 'Sight alignment is the relationship between the front sight post and the rear aperture.' },
    { labels: ['src_1', 'src_1 p.5'], text: 'Sight alignment is the relationship between the front sight post and the rear aperture, centred.' },
  ];
  const draft = unionDraft({
    cites: ['src_1 p.4', 'src_1 p.5'],
    lesson: 'Sight alignment is the relationship between the front sight post and the rear aperture, centred.',
    pre: [{ stem: 'What is sight alignment?', options: ['A relationship', 'A trigger'], answer: 0, rationale: 'The relationship between the front sight post and the rear aperture.' }],
    post: [{ stem: 'What is aligned?', options: ['Post and aperture', 'Hips and muzzle'], answer: 0, rationale: 'The front sight post and the rear aperture.' }],
  });
  assert.deepEqual(
    citedLabels(projectCourseRows('rec_k', draft, { sourceId: 'TC 3-22.9', passages: nearTie })),
    ['src_1 p.4'],
  );
});

test('a resolved citation is always a label the section declared', () => {
  // p.9 is in the persisted index and is a word-for-word match for the item --
  // and is not one of this section's citations. An item may only ever be cited
  // to a passage its section declared, so the primary stands. Fail closed: a
  // citation nobody declared is worse than a coarse one.
  const draft = unionDraft({
    cites: ['src_1 p.4', 'src_1 p.5'],
    post: [{
      stem: 'What does the immediate action drill begin with?',
      options: ['Observe', 'Reload'],
      answer: 0,
      rationale: 'The immediate action drill begins with observing the ejection port for the position of the bolt.',
    }],
  });
  const withStray = [
    ...PASSAGES,
    { labels: ['src_1', 'src_1 p.9'], text: 'The immediate action drill begins with observing the ejection port for the position of the bolt.' },
  ];
  const rows = projectCourseRows('rec_k', draft, { sourceId: 'TC 3-22.9', passages: withStray });
  const declared = new Set(['src_1 p.4', 'src_1 p.5']);
  for (const item of rows.sections[0].items) {
    assert.equal(declared.has(item.citation.citation), true, `${item.id} cites ${item.citation.citation}`);
  }
  assert.equal(rows.sections[0].items.at(-1).citation.citation, 'src_1 p.4');
});

test('an unresolvable label, an empty index and an unrelated index all fall back to the primary', () => {
  // A label naming nothing persisted scores nothing and can never be cited,
  // and neither can an index that resolves none of the declared labels.
  const dangling = unionDraft({ cites: ['src_1 p.4', 'src_1 p.99'] });
  assert.deepEqual(
    citedLabels(projectCourseRows('rec_k', dangling, { sourceId: 'TC 3-22.9', passages: PASSAGES })),
    ['src_1 p.4'],
  );

  for (const passages of [[], undefined, null, [{ labels: ['other'], text: 'Unrelated.' }], [{ labels: ['src_1 p.5'], text: '   ' }]]) {
    assert.deepEqual(
      citedLabels(projectCourseRows('rec_k', unionDraft(), { sourceId: 'TC 3-22.9', passages })),
      ['src_1 p.4'],
    );
  }
});
