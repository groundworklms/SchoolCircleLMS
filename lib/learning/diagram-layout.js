/**
 * Diagram layout: the model says what connects to what, this says where it sits.
 *
 * The first attempt at diagrams asked a language model for SVG primitives with
 * absolute coordinates -- circles at cx/cy, text at x/y -- and shipped what came
 * back. A real generation produced hotspot markers sitting on top of the labels
 * they pointed at ("Edg(4)", "Lea(7)ing Env."), a caption overflowing into the
 * row of boxes above it, four of eight markers floating attached to nothing,
 * and labels reduced to single words. None of that is a model failing at its
 * job. Placing forty coordinates so that nothing collides is a constraint
 * problem, and asking for it in one shot, blind, with no ability to measure
 * text, is asking for the one thing a language model cannot do.
 *
 * So the division of labour changes. The model answers what it is good at --
 * which parts matter, what each one is called, which ones connect, and what the
 * connection is -- and never mentions a coordinate. This module owns every
 * number: box sizes from the text they must hold, rows from the graph's own
 * depth, columns spread evenly across a row, edges routed between box edges,
 * and marker anchors placed at a corner where no label can ever be.
 *
 * The output is deliberately the SAME `{ title, viewBox, elements }` shape the
 * old path produced, because everything downstream of it already works and is
 * tested: `diagramSvg` renders that shape through a strict whitelist,
 * `labelSpots` reads it for hotspots, and the grounding check reads the label
 * text. Only the source of the coordinates changes.
 *
 * Pure and dependency-free. The same graph always lays out identically.
 */

/* Geometry. All of it is here rather than inline, because the one thing this
   module must never do is let two pieces of text overlap, and that is a
   property of how these numbers relate to each other. */
const CHAR_WIDTH = 7.2; // A 13px sans glyph, measured generously.
const NODE_PADDING_X = 14;
const NODE_HEIGHT = 40;
const MIN_NODE_WIDTH = 96;
const MAX_NODE_WIDTH = 190;
const LINE_HEIGHT = 15;
const COLUMN_GAP = 26;
const ROW_GAP = 64;
const MARGIN = 18;
// The caption sits BELOW the diagram in its own reserved band rather than
// inside the drawing, which is what stopped it overflowing into the boxes.
const CAPTION_BAND = 0;

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Break a label into lines that fit a box. Returns the lines and the width
 * they need, so the box is sized to its content instead of the content being
 * cropped to the box.
 */
export function wrapLabel(label, maxWidth = MAX_NODE_WIDTH) {
  const text = clean(label);
  if (!text) return { lines: [], width: MIN_NODE_WIDTH };
  const usable = maxWidth - NODE_PADDING_X * 2;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length * CHAR_WIDTH <= usable || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const widest = Math.max(...lines.map((entry) => entry.length));
  const width = Math.min(
    maxWidth,
    Math.max(MIN_NODE_WIDTH, Math.ceil(widest * CHAR_WIDTH) + NODE_PADDING_X * 2),
  );
  return { lines, width };
}

/**
 * Assign each node a row.
 *
 * A node's row is one below the deepest node pointing at it, so an edge always
 * runs downward and the reading order matches the flow. Cycles are broken by
 * refusing to revisit a node already on the current path: a diagram is a
 * teaching aid, and a cycle drawn as a cycle is unreadable at this size.
 */
export function rowsFor(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.to) && incoming.has(edge.from)) incoming.get(edge.to).push(edge.from);
  }
  const depth = new Map();
  const visit = (id, path) => {
    if (depth.has(id)) return depth.get(id);
    if (path.has(id)) return 0;
    path.add(id);
    const parents = incoming.get(id) || [];
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => visit(parent, path) + 1));
    path.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const node of nodes) visit(node.id, new Set());
  return depth;
}

/**
 * A graph of labelled nodes and edges, laid out.
 *
 * Returns `null` when there is nothing to draw, so a caller can treat an
 * unlayoutable graph exactly like a refused diagram.
 */
export function layoutDiagram(graph) {
  const title = clean(graph?.title);
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .map((node) => ({ id: clean(node?.id), label: clean(node?.label) }))
    .filter((node) => node.id && node.label);
  if (nodes.length < 2) return null;

  const ids = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .map((edge) => ({ from: clean(edge?.from), to: clean(edge?.to), label: clean(edge?.label) }))
    // An edge to a node that does not exist is what left markers floating in
    // empty space last time. It is dropped rather than drawn.
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);

  const depth = rowsFor(nodes, edges);
  const rows = new Map();
  for (const node of nodes) {
    const row = depth.get(node.id) || 0;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(node);
  }

  // Size every box first: a row's width is the sum of its boxes, and the
  // diagram's width is the widest row. Nothing is placed until everything has
  // been measured.
  const measured = new Map();
  for (const node of nodes) measured.set(node.id, wrapLabel(node.label));

  const ordered = [...rows.keys()].sort((a, b) => a - b);
  let contentWidth = 0;
  for (const row of ordered) {
    const width =
      rows.get(row).reduce((total, node) => total + measured.get(node.id).width, 0) +
      COLUMN_GAP * (rows.get(row).length - 1);
    contentWidth = Math.max(contentWidth, width);
  }
  const height = MARGIN * 2 + ordered.length * NODE_HEIGHT + (ordered.length - 1) * ROW_GAP + CAPTION_BAND;
  const width = contentWidth + MARGIN * 2;

  // Place each row centred, so a narrow row sits under the middle of a wide one.
  const placed = new Map();
  ordered.forEach((row, rowIndex) => {
    const inRow = rows.get(row);
    const rowWidth =
      inRow.reduce((total, node) => total + measured.get(node.id).width, 0) + COLUMN_GAP * (inRow.length - 1);
    let x = (width - rowWidth) / 2;
    const y = MARGIN + rowIndex * (NODE_HEIGHT + ROW_GAP);
    for (const node of inRow) {
      const size = measured.get(node.id);
      placed.set(node.id, { ...node, x, y, w: size.width, h: NODE_HEIGHT, lines: size.lines });
      x += size.width + COLUMN_GAP;
    }
  });

  const elements = [];
  // Edges first, so a box always paints over a line rather than under it.
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    const [top, bottom] = from.y <= to.y ? [from, to] : [to, from];
    elements.push({
      type: 'line',
      x1: top.x + top.w / 2,
      y1: top.y + top.h,
      x2: bottom.x + bottom.w / 2,
      y2: bottom.y,
      stroke: 'dim',
    });
    if (edge.label) {
      // Midway along the edge, in the gap between rows, where no box is.
      elements.push({
        type: 'text',
        x: (top.x + top.w / 2 + bottom.x + bottom.w / 2) / 2,
        y: (top.y + top.h + bottom.y) / 2 + 4,
        text: edge.label,
        anchor: 'middle',
        role: 'edge',
      });
    }
  }
  for (const node of placed.values()) {
    elements.push({ type: 'rect', x: node.x, y: node.y, w: node.w, h: node.h, stroke: 'glow', fill: 'none' });
    const first = node.y + node.h / 2 - ((node.lines.length - 1) * LINE_HEIGHT) / 2 + 4;
    node.lines.forEach((line, index) => {
      elements.push({
        type: 'text',
        x: node.x + node.w / 2,
        y: first + index * LINE_HEIGHT,
        text: line,
        anchor: 'middle',
        role: 'node',
      });
    });
  }

  /* Marker anchors, computed here rather than derived from text positions.
     Deriving them from text is what put a marker on top of every label: the
     marker and the label were asked to occupy the same point. A corner of the
     box is a place no label can ever be. */
  const spots = [...placed.values()].map((node) => ({
    id: node.id,
    label: node.label,
    x: Number((((node.x + node.w - 9) / width) * 100).toFixed(2)),
    y: Number((((node.y + 9) / height) * 100).toFixed(2)),
  }));

  return { title, viewBox: `0 0 ${Math.round(width)} ${Math.round(height)}`, elements, spots };
}
