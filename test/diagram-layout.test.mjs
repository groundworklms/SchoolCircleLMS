import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDiagram, rowsFor, wrapLabel } from '../lib/learning/diagram-layout.js';
import { diagramSvg } from '../lib/learning/lesson-pages.js';
import { groundLessonPages } from '../lib/arsenal-core.js';

// The diagram the first attempt shipped broken, as a graph.
const GRAPH = {
  title: 'Who supports the learning environment',
  nodes: [
    { id: 'leader', label: 'Leader' },
    { id: 'instructor', label: 'Instructor' },
    { id: 'learner', label: 'Learner' },
    { id: 'env', label: 'Learning environment' },
  ],
  edges: [
    { from: 'leader', to: 'instructor', label: 'sets climate' },
    { from: 'leader', to: 'env', label: 'owns' },
    { from: 'instructor', to: 'learner', label: 'teaches' },
    { from: 'env', to: 'learner', label: 'supports' },
  ],
};

/** Every text element's approximate bounding box, in viewBox units. */
function textBoxes(laid) {
  const [, , width] = laid.viewBox.split(' ').map(Number);
  return laid.elements
    .filter((element) => element.type === 'text')
    .map((element) => {
      const w = element.text.length * 7.2;
      const half = element.anchor === 'middle' ? w / 2 : 0;
      return { text: element.text, x0: element.x - half, x1: element.x - half + w, y: element.y, width };
    });
}

test('no two labels overlap', () => {
  const boxes = textBoxes(layoutDiagram(GRAPH));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const sameLine = Math.abs(a.y - b.y) < 13;
      const across = a.x0 < b.x1 && b.x0 < a.x1;
      assert.ok(!(sameLine && across), `"${a.text}" overlaps "${b.text}"`);
    }
  }
});

test('every label stays inside the viewBox', () => {
  const laid = layoutDiagram(GRAPH);
  for (const box of textBoxes(laid)) {
    assert.ok(box.x0 >= -1, `"${box.text}" starts left of the frame at ${box.x0}`);
    assert.ok(box.x1 <= box.width + 1, `"${box.text}" runs past the frame at ${box.x1}`);
  }
});

// Four of the eight markers in the shipped diagram pointed at nothing.
test('every edge connects two nodes that exist, and the rest are dropped', () => {
  const laid = layoutDiagram({
    ...GRAPH,
    edges: [...GRAPH.edges, { from: 'leader', to: 'nowhere', label: 'x' }, { from: 'ghost', to: 'learner' }],
  });
  assert.equal(laid.elements.filter((element) => element.type === 'line').length, GRAPH.edges.length);
});

test('a self-edge is not drawn', () => {
  const laid = layoutDiagram({ ...GRAPH, edges: [{ from: 'leader', to: 'leader', label: 'itself' }] });
  assert.equal(laid.elements.filter((element) => element.type === 'line').length, 0);
});

// A marker on top of the label it points at is what printed "Edg(4)".
test('marker anchors sit clear of every label', () => {
  const laid = layoutDiagram(GRAPH);
  const [, , width, height] = laid.viewBox.split(' ').map(Number);
  assert.equal(laid.spots.length, GRAPH.nodes.length);
  for (const spot of laid.spots) {
    const x = (spot.x / 100) * width;
    const y = (spot.y / 100) * height;
    for (const box of textBoxes(laid)) {
      const onIt = x > box.x0 - 2 && x < box.x1 + 2 && Math.abs(y - box.y) < 9;
      assert.ok(!onIt, `marker for "${spot.label}" lands on "${box.text}"`);
    }
  }
});

test('a node with no parent is on the first row and its child is below it', () => {
  const depth = rowsFor(GRAPH.nodes, GRAPH.edges);
  assert.equal(depth.get('leader'), 0);
  assert.equal(depth.get('instructor'), 1);
  assert.equal(depth.get('env'), 1);
  assert.equal(depth.get('learner'), 2);
});

test('a cycle lays out instead of hanging', () => {
  const laid = layoutDiagram({
    title: 'A cycle',
    nodes: [{ id: 'a', label: 'Plan' }, { id: 'b', label: 'Act' }, { id: 'c', label: 'Assess' }],
    edges: [
      { from: 'a', to: 'b', label: 'leads to' },
      { from: 'b', to: 'c', label: 'leads to' },
      { from: 'c', to: 'a', label: 'informs' },
    ],
  });
  assert.ok(laid, 'a cycle still produces a diagram');
  assert.equal(laid.elements.filter((element) => element.type === 'rect').length, 3);
});

test('a graph too small to be a diagram refuses', () => {
  assert.equal(layoutDiagram({ title: 'x', nodes: [{ id: 'a', label: 'Only one' }], edges: [] }), null);
  assert.equal(layoutDiagram({ nodes: [], edges: [] }), null);
  assert.equal(layoutDiagram(null), null);
  assert.equal(
    layoutDiagram({ nodes: [{ id: 'a' }, { id: 'b', label: '' }], edges: [] }),
    null,
    'a node with no label is not a node',
  );
});

test('a long label wraps instead of running out of its box', () => {
  const { lines, width } = wrapLabel('Marine Air-Ground Task Force command element');
  assert.ok(lines.length > 1, 'it wrapped');
  assert.ok(width <= 190, `box stays within the maximum, got ${width}`);
  for (const line of lines) {
    assert.ok(line.length * 7.2 <= width, `"${line}" fits its box`);
  }
  assert.equal(lines.join(' '), 'Marine Air-Ground Task Force command element', 'nothing was lost');
});

test('layout is deterministic', () => {
  assert.deepEqual(layoutDiagram(GRAPH), layoutDiagram(GRAPH));
});

test('the rendered svg centres node labels and marks edge labels as secondary', () => {
  const svg = diagramSvg(layoutDiagram(GRAPH));
  assert.match(svg, /text-anchor="middle"/);
  assert.match(svg, /Learning environment/);
  assert.match(svg, /sets climate/);
  // Edge labels are dimmer and smaller than node labels.
  assert.match(svg, /font-size:10\.5px/);
  assert.match(svg, /font-size:12px/);
});

test('the svg still refuses anything outside its whitelist', () => {
  const svg = diagramSvg({
    viewBox: '0 0 100 100',
    elements: [
      { type: 'script', text: 'alert(1)' },
      { type: 'text', x: 10, y: 10, text: '<script>alert(1)</script>', anchor: 'evil' },
    ],
  });
  assert.doesNotMatch(svg, /<script/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /text-anchor="start"/, 'an unknown anchor falls back, it does not pass through');
});

// The shipped course carried a lesson page titled "Diagram Labels" whose body
// was an accordion of SVG label fragments. The prompt now forbids it; this is
// the floor under the prompt.
test('a page that is nothing but the diagram labels is dropped', () => {
  const passage =
    'A leader sets the climate of the learning environment. The instructor teaches the learner ' +
    'within it, and the learning environment supports the learner in turn.';
  const labelText = 'A leader sets the climate of the learning environment.';
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [
        {
          title: 'Diagram Labels',
          blocks: [{ type: 'p', text: labelText }],
        },
        {
          title: 'The learning environment',
          blocks: [
            { type: 'p', text: 'The instructor teaches the learner within the learning environment.' },
          ],
        },
      ],
      labels: [{ label: 'Leader', text: labelText }],
    },
    passage,
  );
  assert.deepEqual(
    grounded.pages.map((page) => page.title),
    ['The learning environment'],
  );
  assert.ok(grounded.dropped.some((entry) => entry.includes('nothing but diagram labels')));
  assert.equal(grounded.labels.length, 1, 'the label itself still reaches the diagram');
});

test('a page that merely mentions a labelled part is kept', () => {
  const passage =
    'A leader sets the climate of the learning environment and is accountable for it. The ' +
    'instructor teaches the learner within that environment.';
  const grounded = groundLessonPages(
    {
      refused: false,
      intro: '',
      pages: [
        {
          title: 'The leader',
          blocks: [
            { type: 'p', text: 'A leader sets the climate of the learning environment.' },
            { type: 'p', text: 'The leader is accountable for that environment.' },
          ],
        },
      ],
      labels: [{ label: 'Leader', text: 'A leader sets the climate of the learning environment.' }],
    },
    passage,
  );
  assert.equal(grounded.pages.length, 1, 'a page with its own teaching survives');
});
