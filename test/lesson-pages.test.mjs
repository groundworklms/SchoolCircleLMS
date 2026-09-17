import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCoursePages, groundLessonPages, passageForCitation } from '../lib/arsenal-core.js';
import { diagramSvg, lessonPagesForSection, lessonPagesForCourse } from '../lib/learning/lesson-pages.js';

const PASSAGE =
  'A transformer moves electrical energy from one circuit to another through a shared magnetic field. ' +
  'Two coils, the primary and the secondary, are wound on a laminated iron core. Alternating current in the ' +
  'primary produces a changing magnetic field that induces a voltage in the secondary. The turns ratio sets the ' +
  'voltage ratio: secondary voltage over primary voltage equals secondary turns over primary turns. A transformer ' +
  'does nothing with direct current; connecting the primary to a DC source overheats the winding. Copper losses ' +
  'are I squared R heating in the windings; core losses are eddy currents and hysteresis in the laminated core.';

const SECTION = {
  id: 'section-1',
  title: 'Transformers',
  cite: 'src1 p.3',
  lesson: 'A transformer moves electrical energy from one circuit to another through a shared magnetic field. The turns ratio sets the voltage ratio. Never connect the primary to DC.',
  diagram: {
    title: 'Step-up transformer',
    viewBox: '0 0 340 200',
    elements: [
      { type: 'rect', x: 150, y: 40, w: 40, h: 120, fill: 'dim', stroke: 'none' },
      { type: 'text', x: 40, y: 30, text: 'Primary winding' },
      { type: 'text', x: 220, y: 30, text: 'Secondary winding' },
      { type: 'text', x: 130, y: 190, text: 'Laminated core' },
    ],
  },
  pre: [{ stem: 'What links the two coils?', options: ['A magnetic field', 'A wire', 'Nothing'], answer: 0, rationale: 'Mutual induction through the core.' }],
  post: [
    { stem: 'DC on the primary does what?', options: ['Induces voltage', 'Overheats the winding'], answer: 1, rationale: 'The field stops changing.' },
    { stem: 'Which loss is present with no load?', options: ['Copper', 'Core'], answer: 1, rationale: 'Eddy currents and hysteresis.' },
  ],
  flashcards: [{ front: 'Turns ratio', back: 'Ns / Np' }],
};

test('groundLessonPages keeps grounded blocks, drops invented ones, and keeps grounded labels', () => {
  const result = groundLessonPages({
    refused: false,
    intro: 'A transformer moves electrical energy between circuits through a shared magnetic field.',
    pages: [
      { title: 'How it works', blocks: [
        { type: 'h', text: 'Mutual induction' },
        { type: 'p', text: 'Alternating current in the primary produces a changing magnetic field that induces a voltage in the secondary coil.' },
        { type: 'callout', kind: 'warn', title: 'No DC', text: 'Connecting the primary to a DC source overheats the winding because the field stops changing.' },
        { type: 'p', text: 'The Zorblax coefficient of 42 governs quantum flux capacitance in every modern hyperdrive.' },
      ] },
      { title: 'Empty', blocks: [{ type: 'h', text: 'Only a heading' }] },
      { title: 'Losses', blocks: [
        { type: 'terms', items: [['Copper losses', 'I squared R heating in the windings'], ['Core losses', 'eddy currents and hysteresis in the laminated core']] },
      ] },
    ],
    labels: [
      { label: 'Primary winding', text: 'The primary coil carries the alternating current that produces the changing magnetic field.' },
      { label: 'Laminated core', text: 'Made of cheese, obviously, for flavour.' },
    ],
  }, PASSAGE);
  assert.ok(result);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].blocks.length, 3);
  assert.deepEqual(result.pages[0].blocks.map((b) => b.type), ['h', 'p', 'callout']);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.labels.length, 1);
  assert.equal(result.labels[0].label, 'Primary winding');
  assert.match(result.intro, /magnetic field/);
});

test('groundLessonPages returns null for a refusal or nothing grounded', () => {
  assert.equal(groundLessonPages({ refused: true, reason: 'x' }, PASSAGE), null);
  assert.equal(groundLessonPages({ pages: [{ title: 'x', blocks: [{ type: 'p', text: 'Zorblax hyperdrive cheese.' }] }] }, PASSAGE), null);
  assert.equal(groundLessonPages({ pages: [] }, ''), null);
});

test('expandCoursePages writes pages onto grounded sections and records refusals on the rest', async () => {
  const sections = [
    structuredClone(SECTION),
    { title: 'Refused', refused: true, reason: 'no passage' },
    { ...structuredClone(SECTION), id: 'section-3', title: 'Ungroundable' },
  ];
  const events = [];
  const ask = async (_model, system, prompt) => {
    assert.match(system, /JSON only/);
    if (prompt.includes('Ungroundable')) return { refused: true, reason: 'cannot' };
    return {
      refused: false,
      intro: 'A transformer moves electrical energy between circuits through a shared magnetic field.',
      pages: [{ title: 'How it works', blocks: [{ type: 'p', text: 'Alternating current in the primary produces a changing magnetic field that induces a voltage in the secondary.' }] }],
      labels: [{ label: 'Laminated core', text: 'Two coils are wound on a laminated iron core.' }],
    };
  };
  const { expanded } = await expandCoursePages(
    { sections, passageFor: () => PASSAGE },
    { ask, emit: (e) => events.push(e) },
  );
  assert.equal(expanded, 1);
  assert.equal(sections[0].pages.length, 1);
  assert.equal(sections[0].labels.length, 1);
  assert.ok(sections[0].intro);
  assert.equal(sections[1].pages, undefined);
  assert.equal(sections[2].refusals.pages, 'pages not grounded in the passage');
  assert.deepEqual(events.map((e) => e.ok), [true, false]);
});

test('passageForCitation resolves a citation label and falls back to the corpus', () => {
  const documents = [
    { text: 'page one text', source: 'src1 p.1' },
    { text: 'page three text', source: 'src1 p.3' },
  ];
  assert.equal(passageForCitation(documents, 'src1 p.3'), 'page three text');
  assert.equal(passageForCitation(documents, 'unknown'), 'page one text\n\npage three text');
  assert.equal(passageForCitation([], 'x'), null);
});

test('lessonPagesForSection builds the transformer-lesson item shape from a bare Coursewright section', () => {
  const learner = structuredClone(SECTION);
  for (const phase of ['pre', 'post']) learner[phase] = learner[phase].map(({ answer, rationale, ...q }) => q);
  const out = lessonPagesForSection(learner, { id: 'section-1', sourceLabel: 'TC 3-22.9' });
  assert.equal(out.authored, false);
  assert.equal(out.intro, 'A transformer moves electrical energy from one circuit to another through a shared magnetic field. The turns ratio sets the voltage ratio.');
  const types = out.items.map((it) => `${it.type}:${it.title}`);
  assert.deepEqual(types, [
    'check:Before you read',
    'page:Transformers',
    'page:Step-up transformer',
    'check:Check 1: Transformers',
    'check:Check 2: Transformers',
    'page:Flashcards: terms to know cold',
    'page:Where this came from',
  ]);
  // Learner projection: no key on the check, and a figure (no explanations => no hotspots).
  assert.equal(out.items[0].answers.every((a) => a.correct === undefined), true);
  assert.deepEqual(out.items[0].ref, { phase: 'pre', index: 0 });
  assert.equal(out.items[2].blocks[0].type, 'figure');
  assert.match(out.items[2].blocks[0].svg, /<svg/);
  assert.ok(out.items.every((it, i) => it.id === `section-1#${i + 1}`));
});

test('lessonPagesForSection uses authored pages, hotspots for explained labels, and keys when present', () => {
  const s = structuredClone(SECTION);
  s.intro = 'Why this matters.';
  s.pages = [
    { title: 'How a transformer works', blocks: [{ type: 'p', text: 'x' }, { type: 'bogus' }, { type: 'terms', items: [['a', 'b']] }] },
    { title: 'Losses', blocks: [{ type: 'accordion', items: [{ title: 'Open', text: 'Infinite' }] }] },
  ];
  s.labels = [
    { label: 'Primary winding', text: 'Source side.' },
    { label: 'secondary winding', text: 'Load side.' },
  ];
  const out = lessonPagesForSection(s, { id: 's1' });
  assert.equal(out.authored, true);
  assert.equal(out.intro, 'Why this matters.');
  assert.equal(out.items[1].title, 'How a transformer works');
  assert.equal(out.items[1].blocks.length, 2);
  const diagram = out.items.find((it) => it.title === 'Step-up transformer');
  const hs = diagram.blocks.find((b) => b.type === 'hotspots');
  assert.ok(hs);
  assert.equal(hs.spots.length, 2);
  assert.ok(hs.spots.every((sp) => sp.x > 0 && sp.x < 100 && sp.y > 0 && sp.y < 100));
  const check = out.items.find((it) => it.type === 'check');
  assert.equal(check.answers[0].correct, true);
  assert.equal(check.rationale, 'Mutual induction through the core.');
});

test('diagramSvg escapes model text and maps the palette', () => {
  const svg = diagramSvg({ viewBox: '0 0 10 10', elements: [{ type: 'text', x: 1, y: 2, text: '<img onerror=alert(1)>' }, { type: 'circle', cx: 1, cy: 1, r: 2, stroke: 'danger' }] });
  assert.ok(!svg.includes('<img'));
  assert.ok(svg.includes('&lt;img'));
  assert.ok(svg.includes('var(--p-critical)'));
  assert.equal(diagramSvg(null), '');
});

test('lessonPagesForCourse numbers sections and keeps refusals visible', () => {
  const out = lessonPagesForCourse({ sections: [SECTION, { title: 'Nope', refused: true }] });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'section-1');
  assert.equal(out[1].refused, true);
  assert.equal(out[1].items.length, 0);
});
