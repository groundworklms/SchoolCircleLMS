/**
 * Lesson pages -- the learner-facing shape of one generated course section.
 *
 * Coursewright writes a section as a bundle of grounded artifacts: a
 * micro-lesson paragraph, a labelled diagram, pre/post questions and
 * flashcards, plus (when expandLessonPages ran) an intro, authored pages and
 * one-sentence explanations for each diagram label. The lesson player wants an
 * ORDERED LIST OF ITEMS, one idea per screen, in the vocabulary
 * app/prototype/lessonContent.js documents: page{blocks}, check, and blocks
 * p/h/list/callout/terms/figure/example/accordion/hotspots/flashcards.
 *
 * This module is the pure, deterministic mapping between the two. It never
 * invents content: every string on a screen came out of the section. It runs
 * on the client against the learner projection (no answer keys) and on the
 * instructor side against the full payload (keys present, so a preview can
 * grade locally) -- the `answers[].correct` flag is simply absent in the first
 * case and the player asks the server instead.
 */

import { withoutNarration } from './narration.js';

const DIAGRAM_COLORS = {
  dim: 'var(--p-faint)',
  glow: 'var(--p-accent)',
  glow2: 'var(--p-good)',
  danger: 'var(--p-critical)',
  readout: 'var(--p-text)',
  none: 'none',
};

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paint(color, fallback) {
  const key = text(color).toLowerCase();
  return DIAGRAM_COLORS[key] || fallback;
}

function viewBoxOf(diagram) {
  const parts = text(diagram?.viewBox).split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) return parts;
  return [0, 0, 340, 200];
}

/**
 * Render a Coursewright diagram (circle/rect/line/text primitives in a
 * six-colour palette) as an inline SVG string. Coordinates and text are
 * escaped; nothing from the model reaches the DOM as markup.
 */
export function diagramSvg(diagram) {
  const elements = Array.isArray(diagram?.elements) ? diagram.elements : [];
  if (!elements.length) return '';
  const [x, y, w, h] = viewBoxOf(diagram);
  const body = elements.map((el) => {
    switch (text(el?.type)) {
      case 'circle':
        return `<circle cx="${num(el.cx)}" cy="${num(el.cy)}" r="${Math.max(1, num(el.r, 6))}" style="fill:${paint(el.fill, 'none')};stroke:${paint(el.stroke, 'var(--p-text)')};stroke-width:2"/>`;
      case 'rect':
        return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${Math.max(1, num(el.w, 40))}" height="${Math.max(1, num(el.h, 20))}" rx="3" style="fill:${paint(el.fill, 'none')};stroke:${paint(el.stroke, 'var(--p-text)')};stroke-width:2"/>`;
      case 'line':
        return `<line x1="${num(el.x1)}" y1="${num(el.y1)}" x2="${num(el.x2)}" y2="${num(el.y2)}" style="stroke:${paint(el.stroke, 'var(--p-dim)')};stroke-width:2"/>`;
      case 'text':
        return `<text x="${num(el.x)}" y="${num(el.y)}" style="fill:var(--p-text);font-size:12px;font-family:inherit">${esc(el.text)}</text>`;
      default:
        return '';
    }
  }).join('');
  return `<svg viewBox="${x} ${y} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(diagram?.title || 'Diagram')}">${body}</svg>`;
}

/* Diagram label positions as percentages of the viewBox, so the player can
   drop a hotspot on each labelled part. */
function labelSpots(diagram, labels) {
  const [x0, y0, w, h] = viewBoxOf(diagram);
  const texts = (Array.isArray(diagram?.elements) ? diagram.elements : [])
    .filter((el) => text(el?.type) === 'text' && text(el?.text));
  const explained = new Map(
    (Array.isArray(labels) ? labels : [])
      .filter((l) => text(l?.label) && text(l?.text))
      .map((l) => [text(l.label).toLowerCase(), text(l.text)]),
  );
  const spots = [];
  for (const el of texts) {
    const label = text(el.text);
    const explanation = explained.get(label.toLowerCase());
    if (!explanation) continue;
    spots.push({
      x: Math.min(97, Math.max(3, ((num(el.x) - x0) / w) * 100)),
      y: Math.min(97, Math.max(3, ((num(el.y) - y0) / h) * 100 - 3)),
      title: label,
      text: explanation,
    });
  }
  return spots;
}

function checkItem(question, { phase, index, title }) {
  const stem = text(question?.stem || question?.prompt);
  const options = Array.isArray(question?.options) ? question.options : [];
  const answers = options
    .map((option) => (typeof option === 'string' ? option : text(option?.text)))
    .filter(Boolean)
    .map((t) => ({ text: t }));
  if (!stem || answers.length < 2) return null;
  const keyed = Number.isInteger(question.answer) ? question.answer : Number.isInteger(question.answerIndex) ? question.answerIndex : null;
  const item = { type: 'check', title, q: stem, answers, ref: { phase, index } };
  if (text(question.id)) item.itemId = text(question.id);
  if (keyed != null && keyed >= 0 && keyed < answers.length) {
    item.answers = answers.map((a, i) => ({ ...a, correct: i === keyed }));
    if (text(question.rationale)) item.rationale = text(question.rationale);
  }
  return item;
}

const BLOCK_TYPES = new Set(['p', 'h', 'list', 'callout', 'terms', 'example', 'accordion']);

/* Authored pages come from the model and were grounding-checked on the way
   in; this is the shape check so a malformed block can never crash a screen. */
function entriesOf(block) {
  if (Array.isArray(block?.entries)) return block.entries;
  if (Array.isArray(block?.items)) return block.items;
  return [];
}

function cleanBlock(block) {
  const type = text(block?.type);
  if (!BLOCK_TYPES.has(type)) return null;
  switch (type) {
    case 'p':
    case 'h':
      return text(block.text) ? { type, text: text(block.text) } : null;
    case 'list': {
      const items = entriesOf(block).map(text).filter(Boolean);
      return items.length ? { type, items } : null;
    }
    case 'callout': {
      const kind = ['note', 'tip', 'warn'].includes(text(block.kind)) ? text(block.kind) : 'note';
      return text(block.text) ? { type, kind, title: text(block.title) || (kind === 'warn' ? 'Caution' : kind === 'tip' ? 'Tip' : 'Note'), text: text(block.text) } : null;
    }
    case 'terms': {
      const items = entriesOf(block)
        .map((entry) => (Array.isArray(entry) ? [text(entry[0]), text(entry[1])] : [text(entry?.term), text(entry?.definition)]))
        .filter(([t, d]) => t && d);
      return items.length ? { type, items } : null;
    }
    case 'example': {
      const steps = (Array.isArray(block.steps) ? block.steps : []).map(text).filter(Boolean);
      return steps.length ? { type, title: text(block.title) || 'Worked example', steps, result: text(block.result) } : null;
    }
    case 'accordion': {
      const items = entriesOf(block)
        .map((entry) => ({ title: text(entry?.title), text: text(entry?.text || entry?.body) }))
        .filter((entry) => entry.title && entry.text);
      return items.length ? { type, items } : null;
    }
    default:
      return null;
  }
}

export function cleanPages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((page) => ({
      title: text(page?.title),
      blocks: (Array.isArray(page?.blocks) ? page.blocks : []).map(cleanBlock).filter(Boolean),
    }))
    .filter((page) => page.title && page.blocks.length);
}

/**
 * One section -> { intro, items, authored }. `authored` is true when the
 * section carries model-written pages; otherwise the screens are built from
 * the micro-lesson alone and the player labels them as such.
 */
/* A Coursewright citation is "<source record id> p.N" -- the record id is the
   authenticated key, not a name. Show the source's title when the caller can
   name it, and never a bare cuid. */
export function citationLabel(cite, sourceTitles = {}) {
  const raw = text(cite);
  if (!raw) return '';
  const match = /^(\S+)(\s+p\.\s*\S+)?$/.exec(raw);
  if (!match) return raw;
  const [, key, page] = match;
  const title = sourceTitles && sourceTitles[key];
  if (title) return `${title}${page ? `, ${page.trim()}` : ''}`;
  if (/^c[a-z0-9]{20,}$/i.test(key)) return page ? `approved source, ${page.trim()}` : 'approved source';
  return raw;
}

export function lessonPagesForSection(section, { id, sourceLabel = '', sourceTitles = {} } = {}) {
  const s = section && typeof section === 'object' ? section : {};
  const lesson = text(s.lesson);
  const pages = cleanPages(s.pages);
  const authored = pages.length > 0;
  // Without an authored intro, the overview opens with the first two
  // sentences of the micro-lesson; the lesson itself is read on its page.
  const sentences = lesson.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [lesson];
  const intro = text(s.intro) || sentences.slice(0, 2).join('').trim();
  const pre = Array.isArray(s.pre) ? s.pre : [];
  const post = Array.isArray(s.post) ? s.post : [];
  const items = [];

  const preChecks = pre.map((q, i) => checkItem(q, { phase: 'pre', index: i, title: i === 0 ? 'Before you read' : 'Quick check' })).filter(Boolean);
  const postChecks = post.map((q, i) => checkItem(q, { phase: 'post', index: i, title: `Check ${i + 1}: ${text(s.title) || 'this section'}` })).filter(Boolean);

  // The first pre-check opens the lesson; the rest follow the first page of
  // reading. Coursewright asks for two but the model is not capped, and every
  // check here was approved by name: one that is never placed is one a
  // learner was promised and cannot answer.
  const [firstPre, ...laterPre] = preChecks;
  if (firstPre) items.push(firstPre);

  if (s.withheld) {
    // The section stays, its approved checks stay, and the missing prose is
    // named. Hiding the section would make the course silently shrink for some
    // readers and orphan any check in it that HAD been approved; a blank page
    // is indistinguishable from a broken one. PENDING and withheld read the
    // same: which way an instructor is leaning is not a learner's to read off
    // a screen. Nothing else the row carried (pages, diagram, cards) is shown,
    // because it rides on the same unreleased row.
    const hasChecks = preChecks.length + postChecks.length > 0;
    items.push({
      type: 'page',
      title: 'Lesson text not released',
      blocks: [{
        type: 'callout',
        kind: 'note',
        title: 'Lesson text not released',
        text: `SchoolCircle drafted this section from ${text(s.publication) || 'the approved source'}, and your instructor has not approved the text. Nothing unreviewed reaches a student, so it is not shown here. ${hasChecks ? 'The checks in this lesson were approved separately and are yours to answer now.' : 'Nothing else in this section has been approved yet either, so there is nothing here to work through until your instructor has reviewed it.'}`,
      }],
    });
    items.push(...laterPre);
  } else if (authored) {
    pages.forEach((page, i) => {
      items.push({ type: 'page', title: page.title, blocks: page.blocks });
      if (i === 0) items.push(...laterPre);
    });
  } else if (lesson) {
    // Split the micro-lesson into readable paragraphs, three sentences
    // each. It is still one page; the shape just breathes.
    //
    // Narrating sentences are dropped first. This is the path a section takes
    // when its authored pages were all dropped as narration, and on a section
    // built from a chapter introduction the micro-lesson is that same blurb --
    // so without this the page writer's work is undone right here.
    const teaching = withoutNarration(sentences);
    const blocks = [];
    for (let i = 0; i < teaching.length; i += 3) {
      blocks.push({ type: 'p', text: teaching.slice(i, i + 3).join('').trim() });
    }
    // A lesson that was nothing but narration gets no lesson page. The
    // section's questions and cards still stand on their own.
    if (blocks.length) items.push({ type: 'page', title: text(s.title) || 'The lesson', blocks });
    items.push(...laterPre);
  } else {
    items.push(...laterPre);
  }

  const svg = diagramSvg(s.diagram);
  if (svg) {
    const spots = labelSpots(s.diagram, s.labels);
    const caption = text(s.diagram?.title) || 'Diagram';
    items.push({
      type: 'page',
      title: caption,
      blocks: spots.length >= 2
        ? [{ type: 'p', text: 'Tap each point on the diagram.' }, { type: 'hotspots', svg, caption, spots }]
        : [{ type: 'figure', svg, caption }],
    });
  }

  for (const check of postChecks) items.push(check);

  const cards = (Array.isArray(s.flashcards) ? s.flashcards : [])
    .map((c) => ({ front: text(c?.front), back: text(c?.back) }))
    .filter((c) => c.front && c.back);
  if (cards.length) {
    items.push({
      type: 'page',
      title: 'Flashcards: terms to know cold',
      blocks: [{ type: 'p', text: 'Flip each card.' }, { type: 'flashcards', cards }],
    });
  }

  const cite = citationLabel(s.cite, sourceTitles);
  const objective = text(s.objective);
  // Provenance closes a lesson that has something in it; a section with
  // nothing released yet gets no screens at all.
  if (!s.withheld && items.length > 0 && (cite || sourceLabel || objective)) {
    const blocks = [];
    if (objective) blocks.push({ type: 'callout', kind: 'note', title: 'Objective', text: objective });
    blocks.push({
      type: 'p',
      text: `Everything in this lesson was written from, and checked against, ${cite || sourceLabel || 'the approved source'}. Nothing here is invented: each page, question and card had to overlap the cited passage before it could be shown.`,
    });
    if (cite) blocks.push({ type: 'terms', items: [['Citation', cite]] });
    items.push({ type: 'page', title: 'Where this came from', blocks });
  }

  const prefix = id || text(s.id) || 'section';
  return {
    intro,
    authored,
    items: items.map((it, i) => ({ ...it, id: `${prefix}#${i + 1}` })),
  };
}

/** Every section of a course payload, in order, with stable ids. */
export function lessonPagesForCourse(course, { sourceLabel = '', sourceTitles = {} } = {}) {
  const sections = Array.isArray(course?.sections) ? course.sections : [];
  return sections.map((section, i) => {
    const id = text(section?.id) || `s${i + 1}`;
    return {
      id,
      title: text(section?.title) || `Section ${i + 1}`,
      cite: citationLabel(section?.cite, sourceTitles),
      annex: section?.annex && typeof section.annex === 'object' ? section.annex : null,
      code: typeof section?.code === 'string' ? section.code : '',
      refused: section?.refused === true,
      ...lessonPagesForSection(section, { id, sourceLabel, sourceTitles }),
    };
  });
}
