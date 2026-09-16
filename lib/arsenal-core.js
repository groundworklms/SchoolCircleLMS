/**
 * Thin, source-backed adapters for the core SchoolCircle learning loop.
 *
 * The eleven JavaScript arsenal repos are pinned by commit in package.json.
 * They are loaded by name at the call boundary so the API can still boot when
 * an optional repo is not installed; a request then receives an explicit
 * unavailable response rather than silently switching to fabricated content.
 */
import { generateJSON, providerStatus } from './model.js';
import { isExplicitOpenRouterBaseUrl } from './providers.js';
import { createHash } from 'node:crypto';

const OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
};

const GROUNDING_STOP_WORDS = new Set(
  'a an the of to and or in on for with by is are be as at from that this it its into'.split(' '),
);

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

function arsenalConfigured(prefix) {
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const model = process.env[`${prefix}_MODEL`];
  const dedicatedKey = process.env[`${prefix}_API_KEY`]?.trim();
  const sharedOpenRouterKey = isExplicitOpenRouterChatEndpoint(endpoint)
    ? process.env.OPENROUTER_API_KEY?.trim()
    : '';
  return Boolean(endpoint && model && (dedicatedKey || sharedOpenRouterKey));
}

function groundingTokens(value) {
  return [
    ...new Set(
      String(value ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !GROUNDING_STOP_WORDS.has(word)),
    ),
  ];
}

function groundingPasses(text, source, threshold = 0.4) {
  const textTokens = groundingTokens(text);
  const sourceTokens = new Set(groundingTokens(source));
  if (!textTokens.length) return false;
  const matched = textTokens.filter((token) => sourceTokens.has(token)).length;
  return matched / textTokens.length >= threshold;
}

const MAX_COURSE_OBJECTIVES = 12;
const MAX_OBJECTIVE_LENGTH = 280;

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

  const sourceProjections = sources
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
      issues.push(`${where} is refused`);
      continue;
    }
    const citation = citationLabel(section.cite ?? section.citation);
    if (!citation) {
      issues.push(`${where} requires a citation`);
    }
    const groundedSource = sourceProjections.find((source) =>
      source.passages.some((passage) => passage.labels.includes(citation)) ||
      (source.labels.includes(citation) && source.passages.length > 0),
    );
    const citedPassages = groundedSource
      ? groundedSource.passages.filter((passage) =>
          passage.labels.includes(citation),
        )
      : [];
    const passagesForCitation =
      citedPassages.length > 0 ? citedPassages : groundedSource?.passages || [];
    if (!groundedSource || passagesForCitation.length === 0) {
      issues.push(`${where} citation does not resolve to a persisted source`);
    }
    const lesson = typeof section.lesson === 'string' ? section.lesson.trim() : '';
    if (!lesson) {
      issues.push(`${where} requires non-empty lesson text`);
    } else if (
      groundedSource &&
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
        groundedSource &&
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

function isExplicitOpenRouterChatEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
  try {
    const url = new URL(endpoint);
    return (
      url.pathname === '/api/v1/chat/completions' &&
      isExplicitOpenRouterBaseUrl(
        `${url.origin}${url.pathname.slice(0, -'/chat/completions'.length)}`,
      ) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
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

/**
 * Coursewright generation. Its ask callback is connected to SchoolCircle's
 * configured model wrapper, so COURSEWRIGHT_API_KEY/OpenRouter defaults are
 * never accidentally used.
 */
export async function draftCourse(
  { title, objectives, documents, diagrams = false },
  { ask, load = moduleLoader } = {},
) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('title is required');
  if (!Array.isArray(objectives)) {
    throw new TypeError('objectives must be an array');
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new TypeError('documents must be a non-empty array');
  }
  if (objectives.length > MAX_COURSE_OBJECTIVES) {
    throw new TypeError(`objectives must contain no more than ${MAX_COURSE_OBJECTIVES} entries`);
  }
  const explicitValidation = validateCourseOutline(
    { objectives },
    { documents, maxObjectives: MAX_COURSE_OBJECTIVES },
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
  let resolvedObjectives = objectives;
  if (objectives.length === 0) {
    const sourceTextForOutline = documents
      .map(documentText)
      .filter((text) => text.trim())
      .join('\n\n');
    const outline = await outlineAsk(
      'coursewright-outline',
      'You are an instructional designer. Build a complete course outline using ONLY the approved source passages below. Output JSON only with an "objectives" array. Each objective must be a distinct, teachable learning objective grounded in the passages, with concise optional "title". Cover the full source content without inventing topics. Do not exceed 12 objectives. If the sources cannot support a complete outline, return {"refused":true,"reason":"..."} instead.',
      `Course title: "${title.trim()}".\nApproved source passages:\n${sourceTextForOutline}\n\nReturn the full grounded objective outline.`,
    );
    if (outline?.refused === true || outline?.error) {
      const error = new Error(
        `Course outline generation refused: ${outline.reason || outline.error || 'unsupported sources'}`,
      );
      error.code = 'COURSE_OUTLINE_REFUSED';
      error.status = 422;
      throw error;
    }
    const validatedOutline = validateCourseOutline(
      outline,
      { documents, maxObjectives: MAX_COURSE_OBJECTIVES },
    );
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
  }
  return coursewright.fromDocuments(
    { title: title.trim(), objectives: resolvedObjectives, documents, diagrams },
    undefined,
    { ask: modelAsk },
  ).then((course) => {
    const sections = Array.isArray(course?.sections) ? course.sections : [];
    if (sections.length !== resolvedObjectives.length) {
      const error = new Error(
        `Coursewright generated ${sections.length} sections for ${resolvedObjectives.length} requested objectives`,
      );
      error.code = 'COURSE_GENERATION_PARTIAL';
      error.status = 422;
      error.validation = {
        valid: false,
        expectedSections: resolvedObjectives.length,
        actualSections: sections.length,
      };
      throw error;
    }
    return {
      ...course,
      objectives: resolvedObjectives.map(objectiveText),
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

/**
 * Rubricon generation uses its upstream generateRubric implementation with an
 * explicitly isolated RUBRICON_* endpoint configuration, followed by
 * Rubricon's structural and traceability validators. The ask callback is an
 * explicit contract-test seam only.
 */
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
    // Explicit contract-test seam. Production routes do not provide this
    // callback because upstream Rubricon's current release has no injection
    // option; they use generateRubric below with its isolated configuration.
    generated = await ask(task, sourceText);
  } else {
    assertModel();
    if (!arsenalConfigured('RUBRICON')) {
      const error = new Error(
        'Rubricon is unavailable. Set RUBRICON_ENDPOINT, RUBRICON_MODEL, and RUBRICON_API_KEY, or use the explicit OpenRouter endpoint with OPENROUTER_API_KEY.',
      );
      error.code = 'NO_RUBRICON';
      throw error;
    }
    generated = await rubricon.generateRubric(task);
    if (generated?.error) {
      const error = new Error(`Rubricon generation failed: ${generated.error}`);
      error.code = 'RUBRICON_UNAVAILABLE';
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
      assertWhetstoneConfigured();
      if (typeof whetstone.deriveRubric !== 'function') {
        throw masteryPlanError(
          'Pinned Whetstone does not expose deriveRubric.',
          'MASTERY_PLAN_DERIVATION_FAILED',
          503,
        );
      }
      generated = await whetstone.deriveRubric(objectives, source);
    }
  } catch (cause) {
    if (cause?.code === 'NO_PROVIDER' || cause?.code === 'NO_WHETSTONE') throw cause;
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

function assertWhetstoneConfigured() {
  assertModel();
  if (!arsenalConfigured('WHETSTONE')) {
    const error = new Error(
      'Whetstone is unavailable. Set WHETSTONE_ENDPOINT, WHETSTONE_MODEL, and WHETSTONE_API_KEY, or use the explicit OpenRouter endpoint with OPENROUTER_API_KEY.',
    );
    error.code = 'NO_WHETSTONE';
    throw error;
  }
}

/**
 * Build an injected Session for contract tests only. Production uses the
 * upstream Session defaults below; these callbacks mirror its documented
 * injection seam and reject malformed model results rather than guessing a
 * developing verdict.
 */
async function injectedMasterySession(
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
  let session;
  if (typeof ask === 'function') {
    session = await injectedMasterySession(
      {
        objectives,
        source,
        maxTurns,
        maxAttemptsPerCriterion,
        ...(sharedCriteria ? { approvedCriteria: sharedCriteria } : {}),
      },
      whetstone,
      ask,
    );
  } else {
    assertWhetstoneConfigured();
    session = new whetstone.Session({
      objectives,
      source,
      maxTurns,
      maxAttemptsPerCriterion,
      scorer: terminalSafeScorer(whetstone),
      ...(sharedCriteria
        ? { deriveRubric: async () => ({ criteria: cloneJson(sharedCriteria) }) }
        : {}),
    });
  }
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
  const session =
    typeof ask === 'function'
      ? await injectedMasterySession(
          {
            objectives: state.objectives,
            source: state.source,
            maxTurns: state.maxTurns,
            maxAttemptsPerCriterion: state.maxAttemptsPerCriterion,
            ...(sharedCriteria ? { approvedCriteria: sharedCriteria } : {}),
          },
          whetstone,
          ask,
        )
      : (() => {
          assertWhetstoneConfigured();
          return new whetstone.Session({
            objectives: state.objectives,
            source: state.source,
            maxTurns: state.maxTurns,
            maxAttemptsPerCriterion: state.maxAttemptsPerCriterion,
            scorer: terminalSafeScorer(whetstone),
            ...(sharedCriteria
              ? { deriveRubric: async () => ({ criteria: cloneJson(sharedCriteria) }) }
              : {}),
          });
        })();
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
  return {
    model: providerStatus(),
    rubriconConfigured: arsenalConfigured('RUBRICON'),
    whetstoneConfigured: arsenalConfigured('WHETSTONE'),
    doctrineConfigured: Boolean(process.env.DOCTRINE_BASE_URL),
    modelRequired: true,
    doctrineRequiredForLocalSources: false,
  };
}