import assert from 'node:assert/strict';
import test from 'node:test';

import { projectCourseRows } from '../lib/learning/project-course.js';

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

test('projects a Coursewright draft into course, sections and approved items with stable ids', () => {
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
    assert.equal(item.status, 'APPROVED');
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
  assert.match(scenario.items[0].stem, /300 m line[\s\S]*Call the correction/);
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
