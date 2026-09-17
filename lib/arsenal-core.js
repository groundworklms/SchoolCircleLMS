/**
 * Thin, source-backed adapters for the core SchoolCircle learning loop.
 *
 * The eleven JavaScript arsenal repos are pinned by commit in package.json.
 * They are loaded by name at the call boundary so the API can still boot when
 * an optional repo is not installed; a request then receives an explicit
 * unavailable response rather than silently switching to fabricated content.
 */
import { generateJSON, providerStatus } from './model.js';
import { createHash } from 'node:crypto';
// One overlap notion for the whole project. It lives in a leaf module because
// the materialiser needs it too and cannot import this file -- see the header
// of ./learning/grounding.js.
import { groundingPasses } from './learning/grounding.js';

const OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
};

const moduleLoader = (name) =>
  // Keep optional git dependencies out of the API boot path. The names are
  // constants below, never request-controlled input.
  new Function('specifier', 'return import(specifier)')(name);

async function arsenal(name, loader = moduleLoader) {
  try {
    return await loader(name);
  } catch (cause) {
    const error = new Error(`Arsenal dependency "${name}" is unavailable`);
    error.code = 'ARSENAL_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
}

function unavailableModel() {
  const status = providerStatus();
  const error = new Error(
    status.reason ||
      'No text model configured. Set MODEL_BASE_URL and MODEL_ID for a self-hosted endpoint.',
  );
  error.code = 'NO_PROVIDER';
  return error;
}

function assertModel(options = {}) {
  if (typeof options.ask === 'function' || typeof options.chat === 'function') return;
  if (!providerStatus().ready) throw unavailableModel();
}

/**
 * The shared-model callback used by the production helper paths. It matches the
 * `(system, prompt, schema)` shape the Whetstone/Rubricon injection seams expect
 * and returns generateJSON's `{ data }` envelope.
 *
 * Every helper resolves its model here, through the one configured provider
 * (MODEL_BASE_URL/MODEL_ID plus the runtime Settings credential). Rubricon and
 * Whetstone used to demand their own per-helper endpoint trio (the former
 * RUBRICON_ and WHETSTONE_ variables), which could not follow a Settings change:
 * those packages freeze ENDPOINT and MODEL in
 * top-level consts at module load, so the first import pinned them for the life of
 * the process.
 */
function sharedModelAsk(system, prompt, schema) {
  return generateJSON({
    system,
    prompt,
    schema: schema || OBJECT_SCHEMA,
    maxTokens: 6000,
  });
}

// Raised from 12. Twelve objectives over a whole publication forced the model
// to compress: a live MCDP 2 run produced objectives carrying five teaching
// points each and eight sections were refused with "the passage supports X, but
// does not cover Y and Z". Splitting a broad topic into one objective per
// teaching point is the fix, and splitting needs somewhere to go.
const MAX_COURSE_OBJECTIVES = 20;
// Lowered from 280. The cap is the only mechanical check on how much an
// objective asks for, and five teaching points joined by commas fit inside 280
// comfortably. 200 is still well above any single-point objective that reuses
// doctrine wording, so it squeezes compound objectives without putting honest
// ones at risk -- and an objective that does overrun gets the bounded repair
// pass below, which names the rule it broke.
const MAX_OBJECTIVE_LENGTH = 200;
const MAX_COURSE_TITLE_LENGTH = 120;

function documentText(document) {
  if (typeof document === 'string') return document;
  return sourceText(document);
}

function objectiveText(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return typeof value.objective === 'string' ? value.objective.trim() : '';
  }
  return '';
}

/**
 * Validate an outline before it can become Coursewright input. This is
 * intentionally strict: an invalid model outline is an explicit generation
 * failure, never a reason to silently drop or cap requested sections.
 */
export function validateCourseOutline(
  outline,
  { documents = [], maxObjectives = MAX_COURSE_OBJECTIVES } = {},
) {
  const issues = [];
  const objectives = outline && typeof outline === 'object' && !Array.isArray(outline)
    ? outline.objectives
    : undefined;
  if (!Array.isArray(objectives)) {
    issues.push('outline.objectives must be an array');
    return { valid: false, issues, objectives: [] };
  }
  if (objectives.length === 0) issues.push('outline.objectives must be non-empty');
  if (objectives.length > maxObjectives) {
    issues.push(`outline.objectives exceeds the limit of ${maxObjectives}`);
  }
  const passages = documents.map(documentText).filter((text) => text.trim()).join('\n\n');
  const seen = new Set();
  const normalized = [];
  objectives.forEach((entry, index) => {
    const text = objectiveText(entry);
    if (!text) {
      issues.push(`outline.objectives[${index}] must contain non-empty objective text`);
      return;
    }
    if (text.length > MAX_OBJECTIVE_LENGTH) {
      issues.push(`outline.objectives[${index}] exceeds ${MAX_OBJECTIVE_LENGTH} characters`);
    }
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) issues.push(`outline.objectives[${index}] duplicates another objective`);
    seen.add(key);
    if (!passages || !groundingPasses(text, passages)) {
      issues.push(`outline.objectives[${index}] is not grounded in the approved sources`);
    }
    normalized.push(
      typeof entry === 'string'
        ? text
        : {
            ...entry,
            objective: text,
            ...(typeof entry.title === 'string' && entry.title.trim()
              ? { title: entry.title.trim() }
              : {}),
          },
    );
  });
  return { valid: issues.length === 0, issues, objectives: normalized };
}

function cloneJson(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function citationLabel(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const label = String(
    value.citation ??
      value.source ??
      value.cite ??
      value.sourceId ??
      value.pubId ??
      '',
  ).trim();
  if (value.page == null || !label || /\bp\.\s*\d+\b/i.test(label)) return label;
  return `${label} p.${value.page}`;
}

function sourceText(source) {
  if (typeof source?.text === 'string' && source.text.trim()) return source.text;
  const pages = Array.isArray(source?.pages) ? source.pages : [];
  const chunks = Array.isArray(source?.chunks) ? source.chunks : [];
  const parts = [...pages, ...chunks]
    .map((part) => (typeof part === 'string' ? part : part?.text))
    .filter((text) => typeof text === 'string' && text.trim());
  return parts.join('\n\n');
}

function sourcePageParts(payload) {
  const pages = Array.isArray(payload?.pages) ? payload.pages : [];
  const chunks = Array.isArray(payload?.chunks) ? payload.chunks : [];
  const pageProjection = pages.filter(
    (part) => typeof part?.text === 'string' && part.text.trim(),
  );
  if (pageProjection.length) return pageProjection;
  return chunks.filter((part) => typeof part?.text === 'string' && part.text.trim());
}

function sourcePassages(payload, labels) {
  const parts = sourcePageParts(payload);
  if (!parts.length) {
    const text = sourceText(payload);
    return text ? [{ labels, text }] : [];
  }
  return parts.map((part, index) => {
    const page = Number.isInteger(Number(part.page)) && Number(part.page) > 0
      ? Number(part.page)
      : index + 1;
    return {
      text: part.text,
      labels: [...labels, ...labels.map((label) => `${label} p.${page}`)],
    };
  });
}

/**
 * The persisted-source projection every grounding check is asked against: the
 * source's text, the labels a citation may name it by, and the per-page
 * passages those labels address. Extracted from validateCourseDraft so the
 * materialiser can resolve a citation label to the SAME passage text the
 * validator graded the section against -- one projection, not two.
 */
function projectSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map((source) => {
      const payload = source?.payload && typeof source.payload === 'object'
        ? source.payload
        : source;
      const text = sourceText(payload);
      const labels = [
        source?.id,
        payload?.sourceId,
        payload?.title,
      ]
        .map((label) => String(label ?? '').trim())
        .filter(Boolean);
      return {
        id: String(source?.id ?? payload?.id ?? '').trim(),
        sourceId: String(payload?.sourceId ?? '').trim(),
        title: String(payload?.title ?? '').trim(),
        text,
        labels,
        passages: sourcePassages(payload, labels),
        approved:
          source?.status === undefined ||
          String(source.status).toUpperCase() === 'APPROVED',
      };
    })
    .filter((source) => source.text);
}

/**
 * Every addressable passage of the approved sources, as `{ labels, text }`.
 *
 * This is the label -> passage text seam. A Coursewright section carries only
 * citation LABELS (`cite`, and `cites` since the top-K widening), so the
 * materialiser cannot tell which of a section's passages an individual item
 * was drawn from without the text behind those labels. Rather than carrying
 * passage text through the draft payload -- which would duplicate the doctrine
 * into every LearningRecord, grow the payload without bound and let the copy
 * drift from the source it claims to quote -- the approval path re-resolves
 * from the persisted sources it has ALREADY loaded to validate the draft.
 * Same inputs, same projection, no second copy of the truth.
 *
 * Unapproved sources are excluded: nothing unapproved may ground or cite.
 */
export function sourcePassageIndex(sources) {
  return projectSources(sources)
    .filter((source) => source.approved)
    .flatMap((source) => source.passages);
}

function validQuestion(question) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return false;
  if (typeof question.stem !== 'string' || !question.stem.trim()) return false;
  if (!Array.isArray(question.options) || question.options.length < 2) return false;
  const answer = question.answer ?? question.answerIndex;
  return Number.isInteger(answer) && answer >= 0 && answer < question.options.length;
}

/**
 * Validate the producer/consumer contract for a Coursewright draft before a
 * human approval can make it learner-visible. Coursewright refuses individual
 * artifacts, so checking only that `sections` exists would allow a refusal-only
 * or partially empty course to cross the approval boundary. `sources` is the
 * persisted source projection, not request text; each section citation must
 * resolve to one of those sources and its load-bearing text must pass the same
 * deterministic token-grounding floor used by Coursewright.
 *
 * This is intentionally synchronous and model-free. It is safe to run again
 * when consuming a saved record, and it does not trust a generated `refused`
 * flag as evidence that content exists.
 */
export function validateCourseDraft(course, { sources = [] } = {}) {
  const issues = [];
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    return { valid: false, issues: ['course must be an object'] };
  }
  if (typeof course.title !== 'string' || !course.title.trim()) {
    issues.push('course title is required');
  }
  if (!Array.isArray(course.sections) || course.sections.length === 0) {
    issues.push('course must contain at least one section');
    return { valid: false, issues };
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    issues.push('approved source projections are required for grounding');
    return { valid: false, issues };
  }

  const sourceProjections = projectSources(sources);
  if (sourceProjections.some((source) => !source.approved)) {
    issues.push('all grounding sources must be approved');
  }

  for (const [index, section] of course.sections.entries()) {
    const where = `section ${index}`;
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      issues.push(`${where} is not an object`);
      continue;
    }
    if (section.refused === true || section.error) {
      // Coursewright records WHY it refused -- no grounding passage, an empty
      // lesson, a lesson that failed the overlap check, or the model's own
      // stated reason. Twelve repetitions of "is refused" tell an instructor
      // nothing and tell whoever debugs it less, so carry the reason out.
      const reason = String(section.reason || section.error || 'no reason given').trim();
      const named = typeof section.title === 'string' && section.title.trim()
        ? ` ("${section.title.trim()}")`
        : '';
      issues.push(`${where}${named} is refused: ${reason}`);
      continue;
    }
    // One citation or several. A section grounded in a union of passages (see
    // matchTopK) must be validated against that same union, or a lesson drawn
    // from the second passage is rejected for not appearing in the first --
    // which is the bug this widening exists to close. `cite` remains the
    // primary and remains a single string; `cites` carries the full ordered
    // list. A section without `cites` resolves exactly the one label it always
    // did, against exactly the passages it always did.
    const declared = Array.isArray(section.cites) && section.cites.length > 0
      ? section.cites
      : [section.cite ?? section.citation];
    const citations = declared.map(citationLabel);
    if (citations.some((label) => !label)) {
      issues.push(`${where} requires a citation`);
    }
    if (
      Array.isArray(section.cites) &&
      section.cites.length > 0 &&
      citations[0] !== citationLabel(section.cite ?? section.citation)
    ) {
      // `cite` is the label written to the Item citation column and shown to a
      // learner, so it has to be the head of the list it was drawn from. If it
      // is not, the displayed citation is not the passage that ranked first.
      issues.push(`${where} cite is not the primary of its cites list`);
    }
    const resolved = citations.map((citation) => {
      const groundedSource = sourceProjections.find((source) =>
        source.passages.some((passage) => passage.labels.includes(citation)) ||
        (source.labels.includes(citation) && source.passages.length > 0),
      );
      const citedPassages = groundedSource
        ? groundedSource.passages.filter((passage) =>
            passage.labels.includes(citation),
          )
        : [];
      return {
        citation,
        passages: citedPassages.length > 0 ? citedPassages : groundedSource?.passages || [],
      };
    });
    for (const entry of resolved) {
      if (entry.passages.length > 0) continue;
      // Every declared label has to resolve, not just the primary: a list whose
      // second entry names nothing persisted is an unverifiable citation.
      issues.push(
        citations.length === 1
          ? `${where} citation does not resolve to a persisted source`
          : `${where} citation "${entry.citation}" does not resolve to a persisted source`,
      );
    }
    const passagesForCitation = resolved.flatMap((entry) => entry.passages);
    const lesson = typeof section.lesson === 'string' ? section.lesson.trim() : '';
    if (!lesson) {
      issues.push(`${where} requires non-empty lesson text`);
    } else if (
      passagesForCitation.length > 0 &&
      !passagesForCitation.some((passage) => groundingPasses(lesson, passage.text))
    ) {
      issues.push(`${where} lesson is not grounded in its cited source`);
    }

    for (const phase of ['pre', 'post']) {
      const questions = section[phase];
      if (!Array.isArray(questions) || questions.length === 0) {
        issues.push(`${where}.${phase} requires non-empty questions`);
        continue;
      }
      const claims = [];
      for (const [questionIndex, question] of questions.entries()) {
        if (!validQuestion(question)) {
          issues.push(`${where}.${phase}[${questionIndex}] is not a valid question`);
          continue;
        }
        claims.push(`${question.stem} ${question.rationale || ''}`);
      }
      // Match Coursewright's producer contract: it checks the phase's
      // combined load-bearing claims, not each distractor/question in
      // isolation. This avoids rejecting a valid pinned output whose
      // parallel-form stem is mostly connective language.
      if (
        claims.length > 0 &&
        passagesForCitation.length > 0 &&
        !passagesForCitation.some((passage) =>
          groundingPasses(claims.join(' '), passage.text),
        )
      ) {
        issues.push(`${where}.${phase} questions are not grounded in its cited source`);
      }
    }
  }
  if (course.scenario && typeof course.scenario === 'object' && !Array.isArray(course.scenario)) {
    const scenarioText = [
      course.scenario.situation,
      course.scenario.task,
      course.scenario.coaching,
    ]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ');
    if (!scenarioText) {
      issues.push('scenario requires non-empty grounded text');
    } else {
      const passages = sourceProjections.flatMap((source) => source.passages);
      if (
        !passages.length ||
        !groundingPasses(scenarioText, passages.map((passage) => passage.text).join('\n'))
      ) {
        issues.push('scenario is not grounded in the persisted sources');
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

async function askJson(system, prompt, options = {}) {
  if (typeof options.ask === 'function') {
    const value = await options.ask(system, prompt);
    return value?.data ?? value;
  }
  const result = await generateJSON({
    system,
    prompt,
    schema: options.schema || OBJECT_SCHEMA,
    maxTokens: options.maxTokens || 6000,
  });
  return result.data;
}

function normalisePages(text, pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [{ page: 1, text }];
  }
  const normalized = pages.map((page, index) => {
    if (typeof page === 'string') return { page: index + 1, text: page };
    if (page && typeof page === 'object' && typeof page.text === 'string') {
      return {
        page: Number.isInteger(page.page) && page.page > 0 ? page.page : index + 1,
        text: page.text,
        ...(page.label ? { label: String(page.label) } : {}),
      };
    }
    throw new TypeError('pages must contain strings or { page, text } objects');
  });
  if (!normalized.some((page) => page.text.trim())) {
    throw new TypeError('pages must contain source text');
  }
  return normalized;
}

/**
 * Quarry ingestion with page-preserving passages. This is intentionally
 * deterministic and does not call a model.
 */
export async function ingestSource(
  { title, sourceId, text, pages },
  { load = moduleLoader } = {},
) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('title is required');
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required');
  const quarry = await arsenal('quarry', load);
  const pageTexts = normalisePages(text, pages);
  const chunks = [];
  for (const page of pageTexts) {
    const pageChunks = quarry.chunkText(page.text);
    // Quarry intentionally filters very short/noisy fragments. A persisted
    // source still needs an addressable passage, so retain the original page
    // text (never invented text) when its deterministic filter returns none.
    for (const value of pageChunks.length ? pageChunks : [page.text]) {
      chunks.push({
        text: value,
        page: page.page,
        source: sourceId || title,
      });
    }
  }
  const fullText = pageTexts.map((page) => page.text).join('\n\n');
  return {
    title: title.trim(),
    sourceId: sourceId || title.trim(),
    text: fullText,
    pages: pageTexts,
    chunks,
    outline: typeof quarry.outline === 'function' ? quarry.outline(fullText) : [],
    sections: typeof quarry.sections === 'function' ? quarry.sections(fullText) : [],
    tasks: typeof quarry.extractTasks === 'function' ? quarry.extractTasks(fullText) : [],
  };
}

// A run of dot leaders. Four or more dots, or four or more spaced ones -- an
// ellipsis is three, so the floor is set above it deliberately.
const DOT_LEADER = /\.{4,}|(?:\.[ \t]){3,}\./;
const DOT_LEADER_RUNS = new RegExp(DOT_LEADER.source, 'g');
// Front-matter page tokens: an arabic page, a lowercase roman numeral i..xxxix
// (uppercase is excluded because "I" is also a word), or an appendix "A-3".
const ARABIC_PAGE = /^\d{1,4}$/;
const ROMAN_PAGE = /^x{0,3}(?:ix|iv|v?i{1,3}|v)$/;
const APPENDIX_PAGE = /^[A-Z]-\d{1,3}$/;
const NUMBERED_HEADING =
  /^(?:chapter|appendix|annex|section|part|enclosure|figure|table)\b|^\d+(?:\.\d+)+[\s.]+\p{L}/iu;
// Below this many lines there is not enough structure to judge one way or the
// other, and withholding a passage on that little evidence is the error that
// costs doctrine -- so a short passage is never front matter.
const MIN_FRONT_MATTER_LINES = 5;
// A line this short is a heading or a label, not a sentence.
const FRAGMENT_WORDS = 8;

/**
 * Does one line read as a contents entry -- heading text, then a page number?
 *
 * Leaders are flattened to a space first so "Intelligence........5" splits the
 * same way "Intelligence     5" does. Text ending in sentence punctuation is
 * rejected: "The operator confirms the check before starting. 4" is a page
 * footer sitting under prose, not a contents line.
 */
function contentsEntryLine(line) {
  const flattened = line.replace(/[.·•‧]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  const split = /^(.*\p{L}.*?)\s+(\S+)$/u.exec(flattened);
  if (!split) return false;
  const [, heading, tail] = split;
  if (!ARABIC_PAGE.test(tail) && !ROMAN_PAGE.test(tail) && !APPENDIX_PAGE.test(tail)) {
    return false;
  }
  return !/[.!?;:]$/.test(heading);
}

/**
 * Does this passage read as a table of contents or other front matter rather
 * than as doctrine?
 *
 * coursewright.match scores by IDF-weighted keyword overlap (retrieve.js),
 * which deliberately rewards rare distinctive tokens. A contents page is
 * nothing BUT every distinctive heading in the publication, so it outscores
 * the prose that actually teaches almost any objective drawn from that pub: a
 * live MCDP 2 run refused two sections with "The passage is only a table of
 * contents". It is self-reinforcing too. COURSE_OUTLINE_SYSTEM tells the model
 * to reuse passage wording, so a contents page visible while the outline is
 * drafted produces heading-shaped objectives, which then match that same page
 * harder still.
 *
 * Deliberately conservative, because the two errors are not symmetric: a false
 * positive silently removes real doctrine from a course, a false negative only
 * lets one bad passage compete. So no single signal decides. The page-number
 * fingerprint -- entries ending in a page number, or dot leaders -- is
 * REQUIRED, since that is the one thing a contents page has that a page of
 * prose does not; the shape signals below can only corroborate it.
 *
 * Exported for test.
 */
export function looksLikeFrontMatter(text) {
  const body = String(text ?? '');
  // A contents page extracted as one unbroken blob has no lines to count, but
  // its leaders survive. Four runs of four-plus dots do not occur in prose.
  if ((body.match(DOT_LEADER_RUNS) || []).length >= 4) return true;
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < MIN_FRONT_MATTER_LINES) return false;

  let entries = 0;
  let leaders = 0;
  let fragments = 0;
  let sentences = 0;
  let headings = 0;
  for (const line of lines) {
    const words = line.split(/\s+/).length;
    if (DOT_LEADER.test(line)) leaders += 1;
    if (contentsEntryLine(line)) entries += 1;
    if (words <= FRAGMENT_WORDS) fragments += 1;
    // Five words keeps an abbreviation ("Fig. 3.") from counting as a sentence.
    if (words >= 5 && /[.!?]["'’”)\]]?$/.test(line)) sentences += 1;
    if (NUMBERED_HEADING.test(line)) headings += 1;
  }
  const total = lines.length;
  const pagedEntries = entries / total >= 0.5;
  const dotLeaders = leaders / total >= 0.2;
  if (!pagedEntries && !dotLeaders) return false;
  const signals =
    Number(pagedEntries) +
    Number(dotLeaders) +
    Number(fragments / total >= 0.7) +
    Number(sentences / total <= 0.25) +
    Number(headings / total >= 0.3);
  return signals >= 3;
}

/**
 * Withhold front matter from a candidate set without losing it.
 *
 * This filters CANDIDATES, not ingest. Dropping a contents page at ingest is
 * destructive -- the page is gone from the record and can never be displayed or
 * cited -- so the page stays stored and is only declined as grounding.
 *
 * Safety rail: if every candidate looks like front matter, the filter is
 * abandoned and the unfiltered set is returned. Either the heuristic is wrong
 * about this document or the document really is all front matter; in both cases
 * a generation the instructor can read and reject beats an empty one they
 * cannot act on. This must never turn a working draft into no draft.
 */
function withoutFrontMatter(candidates, textOf) {
  const kept = candidates.filter((candidate) => !looksLikeFrontMatter(textOf(candidate)));
  return kept.length > 0 ? kept : candidates;
}

/**
 * One passage per citation label, in document order.
 *
 * lib/learning/core.js hands over one document per persisted Quarry chunk, but
 * several chunks of a page share that page's citation. Joining them back up
 * means the text a section is generated from, the text Coursewright verifies it
 * against, and the text its citation resolves to are all the same text.
 */
function groupByCitation(documents) {
  const order = [];
  const byLabel = new Map();
  for (const document of documents) {
    const text = documentText(document);
    if (!text.trim()) continue;
    const source = typeof document === 'object' && document?.source ? String(document.source) : '';
    if (!byLabel.has(source)) {
      byLabel.set(source, []);
      order.push(source);
    }
    byLabel.get(source).push(text);
  }
  return order.map((source) => ({ source, text: byLabel.get(source).join('\n\n') }));
}

// A section may be grounded in up to this many passages. It is a ceiling, never
// a quota: every passage after the first has to clear Coursewright's own floor
// on its own, so an objective one page covers still gets exactly one page.
const MAX_GROUNDING_PASSAGES = 4;
// ...and in at most this much text. Without a budget a four-passage section
// sends four times the prompt a one-passage section sends, and a page of
// doctrine is not a fixed size. The primary passage is kept whatever it costs:
// truncating it would ground a section in LESS text than single-passage
// retrieval already grounds it in, which is a regression, not a bound.
const MAX_GROUNDING_CHARACTERS = 12000;
const GROUNDING_PASSAGE_SEPARATOR = '\n\n';

/**
 * The passages that cover one objective, in the order retrieval chose them.
 *
 * A real objective spans more than one page. "Identify the four steps" is
 * answered by the page that lists them and the page that defines them, and the
 * single best passage carries a part of it; Coursewright then measures the
 * section against that part and refuses it for the rest. So retrieval offers
 * the union of the passages that cover the objective, not the best one.
 *
 * The scoring is deliberately NOT reimplemented here. `match` is called again
 * against the pool minus the passage it just returned, so every additional
 * passage must independently clear Coursewright's own `minScore`/`minOverlap`
 * floors, and its `null` ends the walk. `limit` can therefore only ever cut the
 * union short -- it can never pad one out with a passage that failed the floor.
 *
 * One consequence worth stating: `match` weights query tokens by IDF *relative
 * to the pool it is handed*, so removing the winner re-weights the next round.
 * Tokens the winner held become rarer across the remaining pool and count for
 * more, which is what makes round two answer "what else covers this objective"
 * rather than "what was second on the first ranking". That is the behaviour we
 * want, but it means round two's score is not comparable with round one's and
 * the returned order is greedy rather than a single global sort.
 *
 * Exported for test.
 */
export function matchTopK(
  match,
  objective,
  candidates,
  { limit = MAX_GROUNDING_PASSAGES, budget = MAX_GROUNDING_CHARACTERS } = {},
) {
  const hits = [];
  let pool = Array.isArray(candidates) ? candidates : [];
  let characters = 0;
  while (hits.length < limit && pool.length > 0) {
    const hit = match(objective, pool);
    if (!hit) break;
    const text = typeof hit.text === 'string' ? hit.text : '';
    const cost = text.length + (hits.length > 0 ? GROUNDING_PASSAGE_SEPARATOR.length : 0);
    if (hits.length > 0 && characters + cost > budget) break;
    hits.push(hit);
    characters += cost;
    // `match` returns a copy of the winning candidate rather than the candidate
    // itself, so the pool shrinks by value. If the winner cannot be located the
    // pool cannot shrink and the next round would return it again for ever, so
    // stop instead.
    const index = pool.findIndex(
      (candidate) =>
        candidate?.text === hit.text && (candidate?.source ?? null) === (hit.source ?? null),
    );
    if (index < 0) break;
    pool = [...pool.slice(0, index), ...pool.slice(index + 1)];
  }
  return hits;
}

/** Never let a progress listener's throw abort a generation that is going fine. */
function safeEmit(emit, event) {
  if (typeof emit !== 'function') return;
  try { emit(event); } catch {}
}

function courseTitleText(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.length > 0 && text.length <= MAX_COURSE_TITLE_LENGTH ? text : '';
}

// The validator's rules stated as instructions. The model cannot see
// validateCourseOutline, so anything it enforces has to be said here or the
// model has no way to comply -- the character cap went unstated and every
// generated objective came back a paragraph, failing all twelve at once.
//
// The one-teaching-point rule is here for the opposite reason: no validator can
// enforce it, and the character cap never could. A live MCDP 2 run refused
// eight of twelve sections with "the passage supports X, but does not cover Y
// and Z" -- one objective wanted CCIRs defined, IRs/PIRs/CCIRs distinguished,
// their decision relationships drawn, their approval authorities named, and
// LTIOV explained, all inside the cap. Each section is grounded in a single
// passage, so an objective that asks for five things is refused for the four
// that passage does not carry, and the whole section is lost.
const COURSE_OUTLINE_SYSTEM = [
  'You are an instructional designer. Build a complete course outline using ONLY the approved source passages below.',
  'Output JSON only: {"title":"...","objectives":[{"title":"...","objective":"..."}]}.',
  `Each "objective" must be ONE sentence of at most ${MAX_OBJECTIVE_LENGTH} characters that a learner can be tested on. This is a hard limit: a longer objective is rejected outright, so split a broad objective into several narrow ones rather than writing a paragraph.`,
  'Each "objective" must teach exactly ONE point: one term defined, OR one distinction drawn, OR one procedure stated, OR one relationship explained, OR one authority named. Never join teaching points with "and", never ask for a list of things to define or describe, and never combine a definition with its application, its approval authority, or its exceptions.',
  `A broad topic is covered by SEVERAL narrow objectives, one teaching point each -- never by one objective that names them all. Splitting is always correct: you have up to ${MAX_COURSE_OBJECTIVES} objectives, and each one is taught from a single source passage, so an objective asking for five things is refused for the four that passage does not carry and the whole lesson is lost.`,
  'Reuse the wording of the passages so every objective is traceably grounded in them.',
  'Every objective must be distinct; never restate one in different words.',
  `Cover the full source content without inventing topics, in at most ${MAX_COURSE_OBJECTIVES} objectives.`,
  `"title" names what the sources teach, in at most ${MAX_COURSE_TITLE_LENGTH} characters.`,
  'If the sources cannot support a complete outline, return {"refused":true,"reason":"..."} instead.',
].join('\n');

const COURSE_TITLE_SYSTEM = [
  'You are an instructional designer. Name a course using ONLY the approved source passages and objectives below.',
  'Output JSON only: {"title":"..."}.',
  `The title names what the course teaches, in at most ${MAX_COURSE_TITLE_LENGTH} characters. Do not invent a subject the passages do not cover.`,
  'If the sources cannot support a title, return {"refused":true,"reason":"..."} instead.',
].join('\n');

/** A refusal is the model declining, not a transport failure; surface it as itself. */
function assertOutlineAccepted(result, code = 'COURSE_OUTLINE_REFUSED') {
  if (result?.refused === true || result?.error) {
    const error = new Error(
      `${code === 'COURSE_TITLE_REFUSED' ? 'Course title' : 'Course outline'} generation refused: ${
        result.reason || result.error || 'unsupported sources'
      }`,
    );
    error.code = code;
    error.status = 422;
    throw error;
  }
  return result;
}

/**
 * One line naming the objectives a generation did not cover, each with its
 * reason. The reason is the useful half -- "no approved passage covers this"
 * and "the passage's counterintelligence discussion is incomplete" are
 * different problems with different fixes -- so it never travels separately
 * from the objective it belongs to.
 */
export function notCoveredText(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) =>
      typeof entry === 'string'
        ? entry
        : entry?.reason
          ? `${entry.objective} (${entry.reason})`
          : String(entry?.objective ?? ''),
    )
    .filter(Boolean)
    .join('; ');
}

/**
 * Coursewright generation. Its ask callback is connected to SchoolCircle's
 * configured model wrapper, so COURSEWRIGHT_API_KEY/OpenRouter defaults are
 * never accidentally used.
 */
export async function draftCourse(
  { title, objectives, documents, diagrams = false },
  { ask, load = moduleLoader, emit } = {},
) {
  if (title !== undefined && title !== null && typeof title !== 'string') {
    throw new TypeError('title must be a string when supplied');
  }
  // An omitted title is the normal path: the instructor picks sources and the
  // model names the course from them. A supplied one is never overwritten.
  const requestedTitle = typeof title === 'string' ? title.trim() : '';
  if (!Array.isArray(objectives)) {
    throw new TypeError('objectives must be an array');
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new TypeError('documents must be a non-empty array');
  }
  if (objectives.length > MAX_COURSE_OBJECTIVES) {
    throw new TypeError(`objectives must contain no more than ${MAX_COURSE_OBJECTIVES} entries`);
  }
  // The one set of text this generation is willing to teach from: the documents
  // regrouped per citation (see groupByCitation), minus front matter.
  //
  // Both the withholding and the grouping happen once, here, so the outline
  // prompt, the outline's grounding check, and retrieval all ask their question
  // of the same text. Filtering only one of them would leave the feedback loop
  // intact -- a contents page hidden from retrieval still teaches the model to
  // write heading-shaped objectives, and one hidden from the outline still wins
  // retrieval on IDF. Judging it per citation rather than per chunk also gives
  // the heuristic the whole page, which is where the signal is.
  const cited = withoutFrontMatter(groupByCitation(documents), (passage) => passage.text);
  const explicitValidation = validateCourseOutline(
    { objectives },
    { documents: cited, maxObjectives: MAX_COURSE_OBJECTIVES },
  );
  // Explicit objectives bypass outline generation, not source-grounding checks.
  if (objectives.length > 0) {
    const invalidExplicit = explicitValidation.issues;
    if (invalidExplicit.length > 0) {
      const error = new Error(`Course objective validation failed: ${invalidExplicit.join('; ')}`);
      error.code = 'COURSE_OBJECTIVE_INVALID';
      error.status = 422;
      error.validation = { valid: false, issues: invalidExplicit };
      throw error;
    }
  }
  assertModel({ ask });
  const coursewright = await arsenal('coursewright', load);
  const modelAsk =
    ask ||
    (async (_model, system, prompt) =>
      askJson(system, prompt, { maxTokens: 8000 }));
  const outlineAsk =
    ask ||
    (async (_model, system, prompt) =>
      askJson(system, prompt, { maxTokens: 1800 }));
  const sourcePassages = cited
    .map(documentText)
    .filter((text) => text.trim())
    .join('\n\n');
  safeEmit(emit, {
    phase: 'sources',
    documents: documents.length,
    characters: sourcePassages.length,
  });
  let resolvedTitle = requestedTitle;
  let resolvedObjectives = objectives;
  if (objectives.length === 0) {
    safeEmit(emit, { phase: 'outline', status: 'start' });
    const outlinePrompt = `${requestedTitle ? `Course title: "${requestedTitle}".
` : ''}Approved source passages:
${sourcePassages}

Return the full grounded objective outline.`;
    let outline = assertOutlineAccepted(
      await outlineAsk('coursewright-outline', COURSE_OUTLINE_SYSTEM, outlinePrompt),
    );
    let validatedOutline = validateCourseOutline(
      outline,
      { documents: cited, maxObjectives: MAX_COURSE_OBJECTIVES },
    );
    if (!validatedOutline.valid) {
      // One bounded repair pass. The model never sees the validator, so an
      // outline that trips a rule -- objectives written as paragraphs is the
      // common one -- is told which rule it broke and asked again, rather than
      // failing the instructor's whole draft on a fixable formatting miss.
      safeEmit(emit, { phase: 'outline', status: 'repair', issues: validatedOutline.issues });
      outline = assertOutlineAccepted(
        await outlineAsk(
          'coursewright-outline',
          COURSE_OUTLINE_SYSTEM,
          `${outlinePrompt}

A previous attempt was rejected for these reasons:
${validatedOutline.issues
            .map((issue) => `- ${issue}`)
            .join('\n')}
Return a corrected outline that resolves every reason above.`,
        ),
      );
      validatedOutline = validateCourseOutline(
        outline,
        { documents: cited, maxObjectives: MAX_COURSE_OBJECTIVES },
      );
    }
    if (!validatedOutline.valid) {
      const error = new Error(
        `Course outline validation failed: ${validatedOutline.issues.join('; ')}`,
      );
      error.code = 'COURSE_OUTLINE_INVALID';
      error.status = 422;
      error.validation = validatedOutline;
      throw error;
    }
    resolvedObjectives = validatedOutline.objectives;
    if (!resolvedTitle) resolvedTitle = courseTitleText(outline?.title);
    safeEmit(emit, {
      phase: 'outline',
      status: 'done',
      objectives: resolvedObjectives.map(objectiveText),
    });
  }
  if (!resolvedTitle) {
    // Explicit objectives skip outline generation, so a course drafted without
    // a title still needs one named from the same sources.
    const named = assertOutlineAccepted(
      await outlineAsk(
        'coursewright-title',
        COURSE_TITLE_SYSTEM,
        `Objectives:
${resolvedObjectives.map((entry) => `- ${objectiveText(entry)}`).join('\n')}

Approved source passages:
${sourcePassages}

Return the course title.`,
      ),
      'COURSE_TITLE_REFUSED',
    );
    resolvedTitle = courseTitleText(named?.title);
  }
  if (!resolvedTitle) {
    const error = new Error(
      `Course title generation failed: the model returned no title of ${MAX_COURSE_TITLE_LENGTH} characters or fewer`,
    );
    error.code = 'COURSE_TITLE_INVALID';
    error.status = 422;
    throw error;
  }
  safeEmit(emit, { phase: 'title', status: 'done', title: resolvedTitle });

  // Ground each objective in exactly what its citation denotes.
  //
  // coursewright.fromDocuments re-chunks the documents to ~180 words and grounds
  // a section in the single best chunk, while validateCourseDraft below grounds
  // the same section in the whole passage its citation resolves to. A lesson
  // that legitimately draws on the rest of the page then fails Coursewright's
  // overlap floor -- measured here at 37.5% against the chunk versus 66.7%
  // against the page -- and the section is refused even though it is grounded.
  // Grouping the documents back together by citation before generation makes
  // both checks ask the same question of the same text. `cited` is built once
  // at the top of this function, so the candidates retrieval ranks are exactly
  // the passages the outline was written from.
  const grounded = [];
  // Objectives this run does not teach, each with the reason it does not. An
  // objective can drop out in two places -- retrieval finds no passage for it
  // here, or the generator refuses the section below -- and from the reviewing
  // instructor's side those are one fact: the course does not cover this, and
  // here is why. One list, so the screen and the saved draft can say it once.
  const notCovered = [];
  for (const entry of resolvedObjectives) {
    const objective = objectiveText(entry);
    const hits = matchTopK(coursewright.match, objective, cited);
    if (hits.length === 0) {
      // Coverage is a real gate: an objective no passage covers is skipped, not
      // invented. It is reported rather than fatal -- see below.
      const reason = 'no approved passage covers this objective';
      notCovered.push({ objective, reason });
      safeEmit(emit, { phase: 'coursewright', step: 'skipped', section: objective, reason });
      continue;
    }
    const title = (typeof entry === 'object' && entry?.title) || objective;
    const cites = hits
      .map((hit) => (typeof hit.source === 'string' ? hit.source.trim() : ''))
      .filter(Boolean);
    grounded.push({
      objective,
      title,
      // The union, in retrieval order. Coursewright generates the section from
      // this text and verifies the section against this same text, and
      // validateCourseDraft resolves `cites` to the same union -- so all three
      // ask their question of one set of passages, which is the alignment the
      // comment above is about.
      passage: hits.map((hit) => hit.text).join(GROUNDING_PASSAGE_SEPARATOR),
      // `cite` is a single string by contract: project-course.js writes it to
      // every materialised Item's citation column, and the per-item review UI
      // and the SCORM export read it from there. It names the PRIMARY passage,
      // the highest-scoring one. The rest of the union travels beside it.
      cite: hits[0].source || null,
      ...(cites.length > 1 ? { cites } : {}),
      passages: hits.length,
    });
    safeEmit(emit, {
      phase: 'coursewright',
      step: 'grounded',
      section: title,
      passages: hits.length,
      cites,
    });
  }
  safeEmit(emit, {
    phase: 'sections',
    status: 'start',
    total: grounded.length,
    passages: grounded.reduce((total, entry) => total + entry.passages, 0),
  });
  // Coursewright reports every artifact as it lands or refuses. Forwarding that
  // is what lets the instructor watch the course being written -- and it is the
  // only place a refusal's reason exists before the whole build is discarded.
  return coursewright.buildCourse(
    { title: resolvedTitle, objectives: grounded, diagrams },
    (event) => safeEmit(emit, { phase: 'coursewright', ...event }),
    { ask: modelAsk },
  ).then((course) => {
    const sections = Array.isArray(course?.sections) ? course.sections : [];
    // buildCourse builds each section object from scratch -- `{ title, cite }`
    // plus the artifacts it generated -- so nothing else carried on an
    // objective survives it, `cites` included. Re-attach the list here, from
    // the entry the section was generated from: by position, which is the order
    // buildCourse iterates, and only once the title AND the primary citation
    // both agree. A list of labels put on the wrong section is a citation that
    // points at a page the claim did not come from, which is worse than no list
    // at all, so an entry that cannot be confirmed leaves the section alone.
    const byTitle = new Map();
    for (const entry of grounded) {
      if (!byTitle.has(entry.title)) byTitle.set(entry.title, entry);
    }
    // A refused section is the same fact as an uncovered objective, arriving
    // one stage later: Coursewright had a passage but would not teach from it,
    // so `{ title, cite, refused, reason }` is all there is -- no lesson, no
    // questions, nothing to review or materialise. Drop it here, next to the
    // retrieval skip it belongs with, rather than letting validateCourseDraft
    // fail the whole draft over it: that is what threw two fully grounded and
    // cited sections away because a third objective refused. The validator
    // keeps treating a refused section as fatal, which is right -- by the time
    // a draft is being saved or approved, one must not exist -- and this is the
    // one place that can tell WHICH objective a refusal cost.
    const refusedObjectives = new Set();
    const usable = [];
    for (const [index, section] of sections.entries()) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        // Not a refusal, a malformed section: hand it to the validator, which
        // still rejects it. Nothing here widens beyond refused/error.
        usable.push(section);
        continue;
      }
      const positional = grounded[index];
      const entry = positional?.title === section.title ? positional : byTitle.get(section.title);
      if (section.refused === true || section.error) {
        const reason = String(section.reason || section.error || 'no reason given').trim();
        const objective = entry?.objective || section.title || `section ${index + 1}`;
        if (entry) refusedObjectives.add(entry);
        notCovered.push({ objective, reason });
        safeEmit(emit, {
          phase: 'coursewright',
          step: 'dropped',
          section: section.title || objective,
          reason,
        });
        continue;
      }
      if (!entry || !Array.isArray(entry.cites) || entry.cites.length < 2) {
        usable.push(section);
      } else if ((section.cite ?? null) !== (entry.cite ?? null)) {
        usable.push(section);
      } else {
        usable.push({ ...section, cites: entry.cites });
      }
    }
    // An objective no passage covers is dropped by retrieval above. Failing the
    // whole draft over it threw away eleven good sections because the twelfth
    // objective did not match, and left the instructor with nothing to look at
    // and no way to act -- the draft is PENDING and needs their review anyway.
    // Keep what was built and name what was not, which is the opposite of
    // dropping sections silently. Nothing at all built is still a failure:
    // there is no course to review.
    if (usable.length === 0) {
      const error = new Error(
        notCovered.length > 0
          ? `No section could be grounded in the selected sources. Not covered: ${notCoveredText(notCovered)}`
          : 'Coursewright generated no sections',
      );
      error.code = 'COURSE_GENERATION_EMPTY';
      error.status = 422;
      error.validation = {
        valid: false,
        expectedSections: resolvedObjectives.length,
        actualSections: 0,
        skipped: notCovered,
      };
      throw error;
    }
    return {
      ...course,
      sections: usable,
      title: course?.title || resolvedTitle,
      // Only what the course actually teaches. An objective whose section
      // refused is no longer covered, so listing it here would have the saved
      // draft claim coverage the sections do not carry.
      objectives: grounded
        .filter((entry) => !refusedObjectives.has(entry))
        .map((entry) => entry.objective),
      ...(notCovered.length > 0 ? { skippedObjectives: notCovered } : {}),
    };
  });
}

const COURSE_REVISION_SCHEMA = {
  type: 'object',
  additionalProperties: true,
};

/**
 * Target one saved Coursewright artifact through the same server-side model
 * adapter used by fresh generation. The returned object is intentionally only
 * a model result; lib/learning/course-revisions.js applies the result to a
 * saved clone and owns the target/immutability boundary.
 */
export async function reviseCourseContent(
  {
    course,
    scope,
    sectionId,
    phase,
    questionId,
    instructions,
    sourceDocuments,
  },
  { ask, load = moduleLoader } = {},
) {
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    throw new TypeError('course is required');
  }
  if (scope !== 'question' && scope !== 'lesson') {
    throw new TypeError('scope must be question or lesson');
  }
  if (typeof sectionId !== 'string' || !sectionId.trim()) {
    throw new TypeError('sectionId is required');
  }
  if (typeof instructions !== 'string' || !instructions.trim()) {
    throw new TypeError('instructions is required');
  }
  if (scope === 'question' && (typeof questionId !== 'string' || !questionId.trim())) {
    throw new TypeError('questionId is required for question revisions');
  }
  if (phase !== undefined && phase !== 'pre' && phase !== 'post') {
    throw new TypeError('phase must be pre or post');
  }
  if (!Array.isArray(sourceDocuments) || sourceDocuments.length === 0) {
    throw new TypeError('approved source documents are required');
  }
  assertModel({ ask });

  const section = Array.isArray(course.sections)
    ? course.sections.find((candidate) => candidate?.id === sectionId)
    : null;
  if (!section) throw new TypeError(`section ${sectionId} was not found`);
  let target;
  if (scope === 'lesson') {
    target = { lesson: section.lesson };
  } else {
    const phases = phase ? [phase] : ['pre', 'post'];
    for (const currentPhase of phases) {
      const questions = Array.isArray(section[currentPhase]) ? section[currentPhase] : [];
      const index = questions.findIndex((question) => question?.id === questionId);
      if (index >= 0) {
        if (target) {
          throw new TypeError(`question ${questionId} is ambiguous; phase is required`);
        }
        target = { question: questions[index], phase: currentPhase };
      }
    }
    if (!target) throw new TypeError(`question ${questionId} was not found in section ${sectionId}`);
  }

  const sourceContext = sourceDocuments
    .map((document, index) => {
      const text = sourceText(document);
      const source = document?.source || document?.sourceId || document?.id || `source-${index + 1}`;
      return `[${index + 1}] ${source}\n${text}`;
    })
    .join('\n\n');
  const system =
    scope === 'lesson'
      ? 'You revise one saved course lesson for an instructor. Return JSON only with either ' +
        '{"refused":true,"reason":"..."} or {"refused":false,"lesson":"..."}. Use only the ' +
        'approved source passages. Preserve the factual meaning and citation anchor; do not ' +
        'return questions or any other course fields.'
      : 'You revise one saved multiple-choice course question for an instructor. Return JSON ' +
        'only with either {"refused":true,"reason":"..."} or {"refused":false,"question":' +
        '{"stem":"...","options":["...","..."],"answerIndex":0,"rationale":"..."}}. Use only ' +
        'the approved source passages. The answerIndex must point to one option. Do not return ' +
        'an id, citation, section, or any other course fields.';
  const prompt = [
    `Section: ${sectionId}`,
    phase ? `Phase: ${phase}` : '',
    questionId ? `Question: ${questionId}` : '',
    `Saved target:\n${JSON.stringify(target)}`,
    `Instructor revision instructions:\n${instructions.trim()}`,
    `Approved source passages:\n${sourceContext}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const result =
    typeof ask === 'function'
      ? await ask(system, prompt)
      : await askJson(system, prompt, {
          schema: COURSE_REVISION_SCHEMA,
          maxTokens: scope === 'lesson' ? 2500 : 1800,
        });
  const output = result?.data ?? result;
  if (output?.refused === true || output?.error) {
    const error = new Error(output.reason || output.error || 'The model refused this revision.');
    error.code = output.refused === true ? 'COURSE_REVISION_REFUSED' : 'COURSE_REVISION_GENERATION_FAILED';
    error.status = output.refused === true ? 422 : 503;
    throw error;
  }
  return output;
}

// Descriptive alias used by integrations that call the Arsenal adapter
// directly; the core route uses reviseCourseContent to distinguish it from
// the persistence handler of the same feature.
export const reviseCourse = reviseCourseContent;

/* The BARS contract, reproduced from upstream Rubricon's own system prompt so the
   shared model produces the same artifact its validators expect. Flag-don't-guess is
   load-bearing: a standard too subjective to anchor must come back for an SME rather
   than be filled with invented criteria. */
const RUBRIC_SYSTEM =
  'You are an assessment subject-matter expert building a Behaviorally Anchored Rating ' +
  'Scale (BARS) from a single performance standard.\n\n' +
  'HARD RULES:\n' +
  '- Use ONLY the provided text (condition, standard, steps). Every anchor must be ' +
  'grounded in and traceable to it.\n' +
  '- NEVER invent times, distances, counts, or criteria not present in the text.\n' +
  '- Decompose the standard into 2-5 OBSERVABLE performance dimensions an evaluator ' +
  'could rate from the sidelines.\n' +
  '- For each dimension, write three behavioral anchors describing what the evaluator ' +
  'would SEE at each tier: "unsatisfactory", "satisfactory", "proficient". Concrete and ' +
  'clearly distinguishable — never vague adjectives like "good".\n' +
  '- For each dimension include "source": a short verbatim phrase copied from the text ' +
  'it derives from.\n' +
  '- FLAG-AMBIGUOUS: if the standard is too subjective to yield objective, observable ' +
  'anchors, DO NOT invent criteria. Return {"flagged":true,"reason":"...",' +
  '"needsSME":"<what a human must define to make it measurable>"}.';

const RUBRIC_TIER_KEYS = ['unsatisfactory', 'satisfactory', 'proficient'];

/**
 * Shape gate for raw model JSON before anything downstream may treat it as a
 * rubric, mirroring upstream Rubricon's own `isValidRubricShape`. Upstream keeps
 * that function module-private (it is not re-exported from the package root) and
 * applied it inside `generateRubric`; since the shared-model path replaces that
 * call, the gate has to live here or malformed output would reach the validators
 * unchecked. Accepts exactly the two documented contracts: a flag, or a rubric
 * whose every dimension carries a name, a verbatim source, and all three tiers.
 */
function isValidRubricShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.flagged === true) {
    return typeof value.reason === 'string' && value.reason.trim().length > 0;
  }
  if (!Array.isArray(value.dimensions) || value.dimensions.length === 0) return false;
  return value.dimensions.every(
    (dimension) =>
      dimension &&
      typeof dimension === 'object' &&
      !Array.isArray(dimension) &&
      typeof dimension.name === 'string' &&
      dimension.name.trim() &&
      typeof dimension.source === 'string' &&
      dimension.source.trim() &&
      dimension.anchors &&
      typeof dimension.anchors === 'object' &&
      !Array.isArray(dimension.anchors) &&
      RUBRIC_TIER_KEYS.every(
        (tier) =>
          typeof dimension.anchors[tier] === 'string' && dimension.anchors[tier].trim(),
      ),
  );
}

const RUBRIC_SCHEMA = {
  type: 'object',
  properties: {
    flagged: { type: 'boolean' },
    reason: { type: 'string' },
    needsSME: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'source', 'anchors'],
        properties: {
          name: { type: 'string' },
          source: { type: 'string' },
          anchors: {
            type: 'object',
            required: ['unsatisfactory', 'satisfactory', 'proficient'],
            properties: {
              unsatisfactory: { type: 'string' },
              satisfactory: { type: 'string' },
              proficient: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

/**
 * Rubricon generation runs on the SHARED model (the one configured provider), then
 * hands the result to Rubricon's own structural and traceability validators — those
 * validators are the actual guarantee and are unchanged. Upstream's generateRubric is
 * not used because it has no injection seam and freezes its endpoint at module load,
 * so it could never follow the runtime Settings provider. The ask callback remains an
 * explicit contract-test seam.
 */
// Rubricon's documented BARS contract, stated for the configured provider.
// isValidRubricShape is the gate on the result, so this and that gate have to
// agree: two tiers or a dimension without its verbatim source phrase is
// malformed, not a rubric.

export async function generateRubric(
  { task, sourceText },
  { ask, load = moduleLoader } = {},
) {
  if (!task || typeof task !== 'object') throw new TypeError('task is required');
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new TypeError('sourceText is required');
  }
  const rubricon = await arsenal('rubricon', load);
  let generated;
  if (typeof ask === 'function') {
    // Explicit contract-test seam.
    generated = await ask(task, sourceText);
  } else {
    assertModel();
    // Upstream rubricon.generateRubric always calls its own OpenRouter endpoint
    // from RUBRICON_ENDPOINT/RUBRICON_MODEL/RUBRICON_API_KEY, so it ignored the
    // model an operator picked in Settings and needed a second credential to
    // work at all. Drive it through the configured provider instead, the same
    // way Coursewright is driven, and keep Rubricon as the authority on the
    // rubric itself: its taskToText builds the prompt, the shape gate below
    // screens the result, and its validateRubric and verifyTraceability decide
    // whether the rubric can be approved. Only the transport changes.
    const standardText =
      typeof rubricon.taskToText === 'function' ? rubricon.taskToText(task) : sourceText;
    const response = await sharedModelAsk(
      RUBRIC_SYSTEM,
      `Standard:\n${standardText}\n\nProduce the BARS rubric per the rules.`,
      RUBRIC_SCHEMA,
    );
    generated = response?.data ?? response;
    if (generated?.error) {
      const error = new Error(`Rubricon generation failed: ${generated.error}`);
      error.code = 'RUBRICON_UNAVAILABLE';
      throw error;
    }
    // The shape gate is the boundary between raw model output and anything
    // downstream is allowed to treat as a rubric. upstream's isValidRubricShape
    // is module-private (not re-exported), so a bare `typeof === 'function'`
    // check silently skips the gate -- prefer upstream's if a future release
    // exports it, otherwise use the local mirror so it always runs.
    const shapeOk =
      typeof rubricon.isValidRubricShape === 'function'
        ? rubricon.isValidRubricShape(generated)
        : isValidRubricShape(generated);
    if (!shapeOk) {
      const error = new Error('Rubricon returned a malformed rubric');
      error.code = 'RUBRICON_BAD_RESPONSE';
      error.status = 422;
      throw error;
    }
  }
  const rubric = {
    ...generated,
    task: { code: task.code || null, title: task.title || null },
  };
  const validation =
    typeof rubricon.validateRubric === 'function'
      ? rubricon.validateRubric(rubric)
      : { valid: false, issues: ['Rubricon validator unavailable'] };
  const traceability =
    typeof rubricon.verifyTraceability === 'function'
      ? rubricon.verifyTraceability(rubric, sourceText)
      : { grounded: false, coverage: 0, ungrounded: [] };
  return { rubric, validation, traceability };
}

const MAX_TASK_FIELD_LENGTH = 600;
const MAX_PERFORMANCE_STEPS = 20;

// Quarry's extractTasks reads CONDITION / STANDARD / PERFORMANCE STEPS blocks
// straight out of a standards document, which is both cheaper and more faithful
// than asking a model. It only recognises that format, so a source without it
// falls through to here rather than leaving the instructor an empty form.
const RUBRIC_TASK_SYSTEM = [
  'You are a training standards writer. Describe the single task the approved source passages teach, using ONLY those passages.',
  'Output JSON only: {"title":"...","condition":"...","standard":"...","performanceSteps":["..."]}.',
  '"title" names the task performed. "condition" states the circumstances it is performed under. "standard" states how well it must be performed to pass.',
  `"performanceSteps" lists the observable steps in order, at most ${MAX_PERFORMANCE_STEPS}.`,
  'Reuse the wording of the passages. Never invent a condition, standard, or step the passages do not support.',
  'If the passages do not describe a performable task, return {"refused":true,"reason":"..."} instead.',
].join('\n');

function taskFieldText(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text.slice(0, MAX_TASK_FIELD_LENGTH);
}

/**
 * Model fallback for a rubric task. Only reached when Quarry's deterministic
 * extraction found no task block in the source; the returned task is a draft an
 * instructor still edits, and Rubricon's own validation and traceability checks
 * still gate whether the rubric built from it can be approved.
 */
export async function draftRubricTask({ sourceText }, { ask } = {}) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) {
    throw new TypeError('sourceText is required');
  }
  const taskAsk =
    ask || (async (_model, system, prompt) => askJson(system, prompt, { maxTokens: 1600 }));
  const drafted = await taskAsk(
    'rubricon-task',
    RUBRIC_TASK_SYSTEM,
    `Approved source passages:\n${sourceText}\n\nReturn the task.`,
  );
  if (drafted?.refused === true || drafted?.error) {
    const error = new Error(
      `Rubric task drafting refused: ${drafted.reason || drafted.error || 'unsupported sources'}`,
    );
    error.code = 'RUBRIC_TASK_REFUSED';
    error.status = 422;
    throw error;
  }
  const task = {
    title: taskFieldText(drafted?.title),
    condition: taskFieldText(drafted?.condition),
    standard: taskFieldText(drafted?.standard),
    performanceSteps: (Array.isArray(drafted?.performanceSteps) ? drafted.performanceSteps : [])
      .map(taskFieldText)
      .filter(Boolean)
      .slice(0, MAX_PERFORMANCE_STEPS),
  };
  const missing = ['title', 'condition', 'standard'].filter((field) => !task[field]);
  if (missing.length > 0 || task.performanceSteps.length === 0) {
    const error = new Error(
      `Rubric task drafting returned an incomplete task: ${[...missing, ...(task.performanceSteps.length ? [] : ['performanceSteps'])].join(', ')}`,
    );
    error.code = 'RUBRIC_TASK_INCOMPLETE';
    error.status = 422;
    throw error;
  }
  return task;
}

const SOURCERER_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refused', 'answer', 'used'],
  properties: {
    refused: { type: 'boolean' },
    // Refusals use an empty answer; every non-empty answer must carry a
    // model-produced 1-based inline marker. Sourcerer still independently
    // checks that marker and used[] are in range, so this never fabricates a
    // citation after the model responds.
    answer: {
      type: 'string',
      pattern: '^(?:$|[\\s\\S]*\\[[1-9][0-9]*(?:\\s*,\\s*[1-9][0-9]*)*\\][\\s\\S]*)$',
    },
    used: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
    },
  },
};

const SOURCERER_VERIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claims', 'unsupported'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'supported'],
        properties: {
          claim: { type: 'string' },
          supported: { type: 'boolean' },
        },
      },
    },
    unsupported: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

function sourcererModelContract(system, schema) {
  const isVerification = schema === SOURCERER_VERIFICATION_SCHEMA;
  return `${system}\n\n${
    isVerification
      ? 'Return exactly JSON with claims (each claim string plus supported boolean) and unsupported (string array). Include every factual answer claim; do not omit either field.'
      : 'Return exactly JSON with refused (boolean), answer (string), and used (1-based integer passage numbers). If unsupported, set refused true, answer to an empty string, and used to an empty array. If supported, set refused false, include inline [n] protocol markers in answer, and list the same valid passage numbers in used. Markers are required references to the supplied passage numbers; do not invent source facts or out-of-range markers.'
  }`;
}

// Gemini may group explicitly supplied passage references as [1, 2].
// The pinned Sourcerer parser accepts only [1][2]. This changes notation,
// not evidence: every member must already be named in the model's used[].
// Sourcerer remains responsible for range and strict faithfulness checks.
function normalizeTutorCitationGroups(output) {
  if (output?.refused || typeof output?.answer !== 'string' || !Array.isArray(output.used)) {
    return output;
  }
  let invalid = false;
  const answer = output.answer.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (marker, group) => {
    const numbers = group.split(',').map((value) => Number(value.trim()));
    if (!numbers.every((number) => Number.isSafeInteger(number) && number > 0 && output.used.includes(number))) {
      invalid = true;
      return marker;
    }
    return numbers.map((number) => `[${number}]`).join('');
  });
  return invalid ? { error: 'no_citation' } : { ...output, answer };
}

/**
 * Sourcerer cite-or-refuse over approved passages. An answer without an
 * in-range inline citation remains refused; no ungrounded fallback is used.
 */
export async function tutorAnswer(
  { question, passages, history = [], minScore = 0.2 },
  { chat, load = moduleLoader } = {},
) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new TypeError('question is required');
  }
  if (!Array.isArray(passages) || passages.length === 0) {
    throw new TypeError('passages must be a non-empty array');
  }
  assertModel({ chat });
  const sourcerer = await arsenal('sourcerer', load);
  const modelChat =
    chat ||
    (async (system, prompt) => {
      const schema = system.includes('strict fact-checker')
        ? SOURCERER_VERIFICATION_SCHEMA
        : SOURCERER_ANSWER_SCHEMA;
      return askJson(sourcererModelContract(system, schema), prompt, {
        maxTokens: 3000,
        schema,
      });
    });
  const chatFn = async (system, prompt) => {
    const output = await modelChat(system, prompt);
    return system.includes('strict fact-checker') ? output : normalizeTutorCitationGroups(output);
  };
  const result = await sourcerer.ask(question.trim(), {
    passages,
    history,
    minScore,
    chat: chatFn,
    verify: 'strict',
  });
  // Sourcerer intentionally retains retrieved passages/citations on a strict
  // faithfulness refusal for diagnostics. Learner-facing tutor responses must
  // never present those as usable evidence once refused; do not synthesize a
  // replacement citation.
  return result?.refused === true ? { ...result, citations: [] } : result;
}

function masterySchemas() {
  return {
    rubric: {
      type: 'object',
      additionalProperties: false,
      required: ['criteria'],
      properties: {
        criteria: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['elo', 'indicators'],
            properties: {
              elo: { type: 'string' },
              indicators: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    },
    question: {
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: { question: { type: 'string' } },
    },
    score: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'feedback', 'followup'],
      properties: {
        verdict: { type: 'string' },
        feedback: { type: 'string' },
        followup: { type: 'string' },
      },
    },
  };
}

function masteryPlanError(message, code = 'MASTERY_PLAN_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Keep the shared rubric deliberately smaller than a Session. Indicators are
 * grading material, so only the three native Whetstone labels are copied into
 * a persisted plan; model-added fields can never become part of the contract.
 */
function canonicalMasteryCriteria(criteria) {
  const issues = [];
  if (!Array.isArray(criteria)) {
    return { criteria: null, issues: ['criteria must be an array'] };
  }
  if (criteria.length < 2 || criteria.length > 4) {
    issues.push('criteria must contain 2-4 items');
  }
  const seen = new Set();
  const canonical = [];
  for (const [index, criterion] of criteria.entries()) {
    const where = `criteria[${index}]`;
    if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) {
      issues.push(`${where} must be an object`);
      continue;
    }
    const elo = typeof criterion.elo === 'string' ? criterion.elo.trim() : '';
    if (!elo) {
      issues.push(`${where}.elo must be a non-empty string`);
    } else {
      const key = elo.toLowerCase();
      if (seen.has(key)) issues.push(`${where}.elo must be unique`);
      seen.add(key);
    }
    const indicators = criterion.indicators;
    if (!indicators || typeof indicators !== 'object' || Array.isArray(indicators)) {
      issues.push(`${where}.indicators must be an object`);
    }
    const levels = {};
    for (const level of ['developing', 'competent', 'mastered']) {
      const value = typeof indicators?.[level] === 'string'
        ? indicators[level].trim()
        : '';
      if (!value) {
        issues.push(`${where}.indicators.${level} must be a non-empty string`);
      } else {
        levels[level] = value;
      }
    }
    canonical.push({ elo, indicators: levels });
  }
  return { criteria: canonical, issues };
}

/**
 * Validate the small shared-plan contract independently of persistence. When
 * sourceText is supplied, each criterion must also meet the deterministic
 * token-grounding checks used by the Coursewright boundary. Callers can use
 * the returned canonical criteria to avoid retaining model-owned references.
 */
export function validateMasteryPlan(
  plan,
  { sourceText: groundingSource, source, sourceId: expectedSourceId } = {},
) {
  const sourceForGrounding = groundingSource ?? source;
  const issues = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, issues: ['mastery plan must be an object'] };
  }
  if (plan.status !== 'PENDING' && plan.status !== 'APPROVED') {
    issues.push('mastery plan status must be PENDING or APPROVED');
  }
  if (typeof plan.sourceId !== 'string' || !plan.sourceId.trim()) {
    issues.push('mastery plan sourceId must be a non-empty string');
  } else if (expectedSourceId !== undefined && plan.sourceId !== expectedSourceId) {
    issues.push('mastery plan sourceId does not match the approved source');
  }
  if (typeof plan.revision !== 'string' || !plan.revision.trim()) {
    issues.push('mastery plan revision must be a non-empty string');
  }
  const normalized = canonicalMasteryCriteria(plan.criteria);
  issues.push(...normalized.issues);
  if (typeof sourceForGrounding === 'string') {
    if (!sourceForGrounding.trim()) {
      issues.push('source text is required for mastery-plan grounding');
    } else if (normalized.criteria) {
      normalized.criteria.forEach((criterion, index) => {
        if (!groundingPasses(criterion.elo, sourceForGrounding)) {
          issues.push(`criteria[${index}] is not grounded in the approved source`);
          return;
        }
        for (const level of ['developing', 'competent', 'mastered']) {
          if (!groundingPasses(criterion.indicators[level], sourceForGrounding, 0.2)) {
            issues.push(
              `criteria[${index}].indicators.${level} is not grounded in the approved source`,
            );
          }
        }
      });
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    ...(issues.length === 0 && normalized.criteria ? { criteria: normalized.criteria } : {}),
  };
}

function masteryPlanRevision(sourceId, criteria) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify({ sourceId, criteria }))
    .digest('hex')}`;
}

/**
 * Generate the instructor-owned plan with the pinned Whetstone producer. The
 * optional deriveRubric seam is for backend contract tests only; production
 * always reaches the installed Whetstone implementation and its configured
 * Gemini-compatible transport.
 */
export async function deriveMasteryPlan(
  { objectives, source, sourceText: sourceTextInput, sourceId },
  { deriveRubric: injectedDeriveRubric, load = moduleLoader } = {},
) {
  source = source ?? sourceTextInput;
  if (
    !(typeof objectives === 'string' || Array.isArray(objectives)) ||
    (Array.isArray(objectives) && objectives.length === 0)
  ) {
    throw new TypeError('objectives are required');
  }
  if (typeof source !== 'string' || !source.trim()) throw new TypeError('source is required');
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new TypeError('sourceId is required');
  const whetstone = await arsenal('whetstone', load);
  let generated;
  try {
    if (typeof injectedDeriveRubric === 'function') {
      generated = await injectedDeriveRubric(objectives, source);
    } else {
      // Derived on the shared model, not upstream's frozen-endpoint deriveRubric.
      assertModel();
      const response = await sharedModelAsk(
        'Build a mastery rubric grounded only in the lesson source. Return 2-4 assessable ' +
          'criteria with developing, competent, and mastered indicators.',
        `Lesson:\n${source.slice(0, 12000)}\nObjectives:\n${
          Array.isArray(objectives) ? objectives.join('\n') : objectives
        }`,
        masterySchemas().rubric,
      );
      generated = response?.data ?? response;
    }
  } catch (cause) {
    if (cause?.code === 'NO_PROVIDER') throw cause;
    const error = masteryPlanError(
      `Mastery plan derivation failed: ${cause?.message || 'transport error'}`,
      'MASTERY_PLAN_DERIVATION_FAILED',
      503,
    );
    error.cause = cause;
    throw error;
  }
  const result = generated?.data ?? generated;
  if (result?.error) {
    throw masteryPlanError(
      `Mastery plan derivation failed: ${result.error}`,
      'MASTERY_PLAN_DERIVATION_FAILED',
      503,
    );
  }
  const validation = validateMasteryPlan(
    { status: 'PENDING', sourceId, revision: 'pending', criteria: result?.criteria },
    { sourceText: source, sourceId },
  );
  if (!validation.valid) {
    const error = masteryPlanError(
      `Mastery plan is invalid: ${validation.issues.join('; ')}`,
      'MASTERY_PLAN_INVALID',
      422,
    );
    error.validation = validation;
    throw error;
  }
  const criteria = cloneJson(validation.criteria);
  return {
    status: 'PENDING',
    sourceId,
    criteria,
    revision: masteryPlanRevision(sourceId, criteria),
  };
}

/**
 * Build a Whetstone Session driven through the shared model. This is the
 * PRODUCTION path: the callbacks below go through the one configured provider, so
 * Whetstone follows a runtime Settings change like every other helper. Production
 * therefore no longer routes through upstream's own `scoreTurn` (whose endpoint is
 * frozen at module load); `terminalSafeScorer` stays exported to guard that
 * function's final-criterion defect should anything call it again.
 *
 * The callbacks reject malformed model results rather than guessing a developing
 * verdict. Tests pass their own `ask` through the same seam.
 */
async function buildMasterySession(
  { objectives, source, maxTurns, maxAttemptsPerCriterion, approvedCriteria },
  whetstone,
  ask,
) {
  const model = (system, prompt, schema) =>
    ask(system, prompt, schema).then((value) => value?.data ?? value);
  const schemas = masterySchemas();
  const deriveRubric = async (inputObjectives, inputSource) => {
    if (approvedCriteria) return { criteria: cloneJson(approvedCriteria) };
    const result = await model(
      'Build a mastery rubric grounded only in the lesson source. Return 2-4 assessable ' +
        'criteria with developing, competent, and mastered indicators.',
      `Lesson:\n${inputSource.slice(0, 12000)}\nObjectives:\n${
        Array.isArray(inputObjectives) ? inputObjectives.join('\n') : inputObjectives
      }`,
      schemas.rubric,
    );
    if (!Array.isArray(result?.criteria) || result.criteria.length === 0) {
      return { error: 'model did not return a mastery rubric' };
    }
    return { criteria: result.criteria };
  };
  const firstQuestion = async (criteria, inputSource) => {
    const result = await model(
      'Ask one open-ended mastery question grounded only in the lesson source.',
      `Lesson:\n${inputSource.slice(0, 10000)}\nCompetency: ${criteria[0]?.elo || ''}`,
      schemas.question,
    );
    if (!result?.question || typeof result.question !== 'string') {
      return { error: 'model did not return a mastery question' };
    }
    return { question: result.question, eloIndex: 0 };
  };
  const scorer = async ({
    criteria,
    eloIndex,
    question,
    answer,
    source: contextSource,
    transcript,
  }) => {
    const result = await model(
      'Score the learner answer only against the lesson and criterion. verdict must be ' +
        'developing, competent, or mastered. Give concise grounded feedback and a follow-up.',
      `Lesson:\n${contextSource.slice(0, 10000)}\nCriterion:\n${JSON.stringify(
        criteria[eloIndex],
      )}\nPrior exchange:\n${transcript || ''}\nQuestion: ${question}\nAnswer: ${answer}`,
      schemas.score,
    );
    const levels = whetstone.LEVELS || ['developing', 'competent', 'mastered'];
    if (!result || !levels.includes(result.verdict)) {
      return { error: 'model returned an invalid mastery verdict' };
    }
    const mastered = result.verdict === 'mastered';
    const nextEloIndex = mastered ? eloIndex + 1 : eloIndex;
    const complete = mastered && nextEloIndex >= criteria.length;
    let nextQuestion = complete ? '' : result.followup || '';
    if (mastered && !complete) {
      const next = await firstQuestion(criteria.slice(nextEloIndex), contextSource);
      nextQuestion = next.question || '';
    }
    if (!complete && !nextQuestion.trim()) nextQuestion = question;
    const score = whetstone.computeScore({
      criteriaCount: criteria.length,
      eloIndex,
      verdict: result.verdict,
    });
    return {
      verdict: result.verdict,
      feedback: typeof result.feedback === 'string' ? result.feedback : '',
      mastered,
      complete,
      nextQuestion,
      nextEloIndex,
      score,
    };
  };
  return new whetstone.Session({
    objectives,
    source,
    deriveRubric,
    firstQuestion,
    scorer,
    maxTurns,
    maxAttemptsPerCriterion,
  });
}

/**
 * Corrective adapter for the pinned whetstone `scoreTurn`
 * (github:groundworklms/whetstone#4b5d0a4). On final-criterion mastery that scoreTurn
 * leaves `nextEloIndex` at the current index while returning `complete: true`, so
 * `Session.answer()` rejects it ("scorer complete flag is inconsistent with nextEloIndex")
 * and the LAST criterion can never complete. This advances the terminal index to
 * `criteria.length` so the session completes; it is a no-op on every non-terminal turn and
 * passes scorer errors through unchanged. Remove once the whetstone pin fixes scoreTurn.
 */
export function terminalSafeScorer(whetstone) {
  return async (turn) => {
    const result = await whetstone.scoreTurn(turn);
    // Normalize only the pinned scorer's final-mastered off-by-one result.
    // All other malformed results must reach Session's existing validation.
    if (
      Array.isArray(turn.criteria) &&
      turn.criteria.length > 0 &&
      Number.isInteger(turn.eloIndex) &&
      turn.eloIndex === turn.criteria.length - 1 &&
      result &&
      !result.error &&
      result.verdict === 'mastered' &&
      result.mastered === true &&
      result.complete === true &&
      result.nextEloIndex === turn.eloIndex
    ) {
      return { ...result, nextEloIndex: turn.criteria.length };
    }
    return result;
  };
}

export async function startMasterySession(
  {
    objectives,
    source,
    maxTurns = 12,
    maxAttemptsPerCriterion = 6,
    approvedCriteria,
    masteryPlanRevision,
    masteryPlan,
  },
  { ask, load = moduleLoader } = {},
) {
  if (
    !(typeof objectives === 'string' || Array.isArray(objectives)) ||
    (Array.isArray(objectives) && objectives.length === 0)
  ) {
    throw new TypeError('objectives are required');
  }
  if (typeof source !== 'string' || !source.trim()) throw new TypeError('source is required');
  const sharedCriteria = approvedCriteria || masteryPlan?.criteria;
  const sharedRevision = masteryPlanRevision || masteryPlan?.revision;
  if (sharedCriteria !== undefined) {
    const validation = canonicalMasteryCriteria(sharedCriteria);
    if (validation.issues.length > 0) {
      throw masteryPlanError(
        `Mastery plan criteria are invalid: ${validation.issues.join('; ')}`,
      );
    }
  }
  const whetstone = await arsenal('whetstone', load);
  if (typeof ask !== 'function') assertModel();
  const session = await buildMasterySession(
    {
      objectives,
      source,
      maxTurns,
      maxAttemptsPerCriterion,
      ...(sharedCriteria ? { approvedCriteria: sharedCriteria } : {}),
    },
    whetstone,
    typeof ask === 'function' ? ask : sharedModelAsk,
  );
  if (typeof sharedRevision === 'string' && sharedRevision.trim()) {
    session.masteryPlanRevision = sharedRevision;
  }
  let question;
  try {
    question = await session.start();
  } catch (cause) {
    if (!cause?.code) cause.code = 'WHETSTONE_UNAVAILABLE';
    throw cause;
  }
  return { session, question };
}

export async function answerMasterySession(session, text) {
  if (!session || typeof session.answer !== 'function') {
    throw new TypeError('session is required');
  }
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('answer is required');
  try {
    return await session.answer(text.trim());
  } catch (cause) {
    if (!cause?.code) cause.code = 'WHETSTONE_UNAVAILABLE';
    throw cause;
  }
}

export function serialiseMasterySession(session, sourceId, objectives) {
  const report = typeof session.report === 'function' ? session.report() : null;
  return {
    sourceId,
    objectives,
    source: session.source,
    // `rubric` is grading material required only to restore the upstream
    // Session. Top-level `criteria` is the learner-safe/reportable verdict
    // projection consumed by Sextant.
    rubric: cloneJson(session.criteria),
    criteria: report?.criteria || [],
    eloIndex: session.eloIndex,
    currentQuestion: session.currentQuestion,
    transcript: session.transcript,
    results: session.results,
    score: session.score,
    complete: session.complete,
    stalled: session.stalled,
    turns: session.turns,
    attempts: session.attempts,
    exchanges: session.exchanges,
    report,
    maxTurns: session.maxTurns,
    maxAttemptsPerCriterion: session.maxAttemptsPerCriterion,
    maxTranscript: session.maxTranscript,
    ...(typeof session.masteryPlanRevision === 'string' && session.masteryPlanRevision.trim()
      ? { masteryPlanRevision: session.masteryPlanRevision }
      : {}),
  };
}

export async function restoreMasterySession(
  state,
  { ask, load = moduleLoader, approvedCriteria, masteryPlan } = {},
) {
  if (!state || typeof state !== 'object') throw new TypeError('state is required');
  const sharedCriteria = approvedCriteria || masteryPlan?.criteria;
  if (sharedCriteria !== undefined) {
    const validation = canonicalMasteryCriteria(sharedCriteria);
    if (validation.issues.length > 0) {
      throw masteryPlanError(
        `Mastery plan criteria are invalid: ${validation.issues.join('; ')}`,
      );
    }
  }
  const whetstone = await arsenal('whetstone', load);
  if (typeof ask !== 'function') assertModel();
  const session = await buildMasterySession(
    {
      objectives: state.objectives,
      source: state.source,
      maxTurns: state.maxTurns,
      maxAttemptsPerCriterion: state.maxAttemptsPerCriterion,
      ...(sharedCriteria ? { approvedCriteria: sharedCriteria } : {}),
    },
    whetstone,
    typeof ask === 'function' ? ask : sharedModelAsk,
  );
  // Restore the upstream Session state directly. It must not call start(),
  // derive a new rubric, or spend a model request on every persisted turn.
  for (const key of [
    'eloIndex',
    'currentQuestion',
    'transcript',
    'results',
    'score',
    'complete',
    'stalled',
    'turns',
    'attempts',
    'exchanges',
  ]) {
    if (state[key] !== undefined) session[key] = state[key];
  }
  // The persisted `rubric` field holds the session's grading criteria (see
  // serialiseMasterySession, which writes `rubric: session.criteria`). The
  // upstream whetstone Session grades on `session.criteria` (session.js: set in
  // start(), required by answer()) and has NO `rubric` field — so restore the
  // criteria onto `session.criteria`, not a nonexistent `session.rubric`, which
  // left a resumed session with `criteria === null` (ungradable, never completes).
  if (sharedCriteria !== undefined) {
    // A shared plan is authoritative. Never let a learner-owned persisted
    // rubric replace the instructor-approved snapshot.
    session.criteria = cloneJson(sharedCriteria);
  } else if (state.rubric !== undefined) {
    session.criteria = state.rubric;
  } else if (state.criteria !== undefined) {
    // Backward-compatible read of pre-projection rows written before the
    // `rubric`/`criteria` split.
    session.criteria = state.criteria;
  }
  const restoredRevision = state.masteryPlanRevision || masteryPlan?.revision;
  if (typeof restoredRevision === 'string' && restoredRevision.trim()) {
    session.masteryPlanRevision = restoredRevision;
  }
  return session;
}

export function masteryView(session) {
  const report = typeof session.report === 'function' ? session.report() : null;
  return {
    report,
    currentQuestion: session.complete ? null : session.currentQuestion,
    // Indicators are grading material, not learner-facing answer keys.
    criteria: (session.criteria || []).map((criterion) => ({
      elo: criterion.elo,
    })),
    transcript: session.transcript || [],
    ...(typeof session.masteryPlanRevision === 'string' && session.masteryPlanRevision.trim()
      ? { masteryPlanRevision: session.masteryPlanRevision }
      : {}),
  };
}

export function redactCourse(course) {
  if (!course || typeof course !== 'object') return course;
  if (Array.isArray(course)) return course.map(redactCourse);
  // Coursewright and legacy producers use several names for answer keys. Keep
  // this recursive denylist aligned with the manual learner redactor, while
  // retaining stems, options, and source citations verbatim.
  const forbidden = new Set([
    'answer',
    'answers',
    'answerindex',
    'answerkey',
    'correct',
    'correctanswer',
    'correctanswerid',
    'correctoption',
    'correctoptionid',
    'explanation',
    'iscorrect',
    'indicators',
    'keyedanswer',
    'rationale',
    'solution',
  ]);
  const result = {};
  for (const [key, value] of Object.entries(course)) {
    const normalizedKey = key.replace(/[-_\s]/g, '').toLowerCase();
    if (forbidden.has(normalizedKey)) continue;
    result[key] = redactCourse(value);
  }
  return result;
}

export function learningModelStatus() {
  const model = providerStatus();
  // Every helper now rides the shared model, so these track its readiness rather
  // than a per-helper endpoint trio. Field names are kept for existing consumers.
  const sharedModelReady = Boolean(model?.ready);
  return {
    model,
    // Rubricon AND Whetstone now run on the configured provider, so both are
    // ready whenever the model is -- there is no second credential to set.
    rubriconConfigured: sharedModelReady,
    whetstoneConfigured: sharedModelReady,
    doctrineConfigured: Boolean(process.env.DOCTRINE_BASE_URL),
    modelRequired: true,
    doctrineRequiredForLocalSources: false,
  };
}