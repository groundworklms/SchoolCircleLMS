/**
 * Thin, source-backed adapters for the core SchoolCircle learning loop.
 *
 * The eleven JavaScript arsenal repos are pinned by commit in package.json.
 * They are loaded by name at the call boundary so the API can still boot when
 * an optional repo is not installed; a request then receives an explicit
 * unavailable response rather than silently switching to fabricated content.
 */
import { generateJSON, providerStatus } from './model.js';

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

async function askJson(system, prompt, options = {}) {
  if (typeof options.ask === 'function') {
    const value = await options.ask(system, prompt);
    return value?.data ?? value;
  }
  const result = await generateJSON({
    system,
    prompt,
    schema: OBJECT_SCHEMA,
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
  if (!Array.isArray(objectives) || objectives.length === 0) {
    throw new TypeError('objectives must be a non-empty array');
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new TypeError('documents must be a non-empty array');
  }
  assertModel({ ask });
  const coursewright = await arsenal('coursewright', load);
  const modelAsk =
    ask ||
    (async (_model, system, prompt) =>
      askJson(system, prompt, { maxTokens: 8000 }));
  return coursewright.fromDocuments(
    { title: title.trim(), objectives, documents, diagrams },
    undefined,
    { ask: modelAsk },
  );
}

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
    if (
      !process.env.RUBRICON_ENDPOINT ||
      !process.env.RUBRICON_MODEL ||
      !process.env.RUBRICON_API_KEY
    ) {
      const error = new Error(
        'Rubricon is unavailable. Set RUBRICON_ENDPOINT, RUBRICON_MODEL, and RUBRICON_API_KEY.',
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
  const chatFn =
    chat ||
    (async (system, prompt) =>
      askJson(system, prompt, { maxTokens: 3000 }));
  return sourcerer.ask(question.trim(), {
    passages,
    history,
    minScore,
    chat: chatFn,
    verify: 'strict',
  });
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

function assertWhetstoneConfigured() {
  assertModel();
  if (
    !process.env.WHETSTONE_ENDPOINT ||
    !process.env.WHETSTONE_MODEL ||
    !process.env.WHETSTONE_API_KEY
  ) {
    const error = new Error(
      'Whetstone is unavailable. Set WHETSTONE_ENDPOINT, WHETSTONE_MODEL, and WHETSTONE_API_KEY.',
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
  { objectives, source, maxTurns, maxAttemptsPerCriterion },
  whetstone,
  ask,
) {
  const model = (system, prompt, schema) =>
    ask(system, prompt, schema).then((value) => value?.data ?? value);
  const schemas = masterySchemas();
  const deriveRubric = async (inputObjectives, inputSource) => {
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
 * Construct the upstream Whetstone Session. Without an explicit test callback
 * this calls Whetstone's own deriveRubric/firstQuestion/scoreTurn functions,
 * which use the isolated WHETSTONE_* endpoint configuration.
 */
export async function startMasterySession(
  { objectives, source, maxTurns = 12, maxAttemptsPerCriterion = 6 },
  { ask, load = moduleLoader } = {},
) {
  if (
    !(typeof objectives === 'string' || Array.isArray(objectives)) ||
    (Array.isArray(objectives) && objectives.length === 0)
  ) {
    throw new TypeError('objectives are required');
  }
  if (typeof source !== 'string' || !source.trim()) throw new TypeError('source is required');
  const whetstone = await arsenal('whetstone', load);
  let session;
  if (typeof ask === 'function') {
    session = await injectedMasterySession(
      { objectives, source, maxTurns, maxAttemptsPerCriterion },
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
    });
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
    rubric: session.criteria,
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
  };
}

export async function restoreMasterySession(
  state,
  { ask, load = moduleLoader } = {},
) {
  if (!state || typeof state !== 'object') throw new TypeError('state is required');
  const whetstone = await arsenal('whetstone', load);
  const session =
    typeof ask === 'function'
      ? await injectedMasterySession(
          {
            objectives: state.objectives,
            source: state.source,
            maxTurns: state.maxTurns,
            maxAttemptsPerCriterion: state.maxAttemptsPerCriterion,
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
          });
        })();
  // Restore the upstream Session state directly. It must not call start(),
  // derive a new rubric, or spend a model request on every persisted turn.
  for (const key of [
    'rubric',
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
  if (state.rubric === undefined && state.criteria !== undefined) {
    // Backward-compatible read of pre-projection rows. New writes always use
    // `rubric` for indicators and `criteria` for verdicts.
    session.criteria = state.criteria;
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
  };
}

export function redactCourse(course) {
  if (!course || typeof course !== 'object') return course;
  if (Array.isArray(course)) return course.map(redactCourse);
  const result = {};
  for (const [key, value] of Object.entries(course)) {
    if (
      key === 'answer' ||
      key === 'answerIndex' ||
      key === 'rationale' ||
      key === 'keyedAnswer' ||
      key === 'indicators'
    ) {
      continue;
    }
    result[key] = redactCourse(value);
  }
  return result;
}

export function learningModelStatus() {
  return {
    model: providerStatus(),
    rubriconConfigured: Boolean(
      process.env.RUBRICON_ENDPOINT &&
        process.env.RUBRICON_MODEL &&
        process.env.RUBRICON_API_KEY,
    ),
    whetstoneConfigured: Boolean(
      process.env.WHETSTONE_ENDPOINT &&
        process.env.WHETSTONE_MODEL &&
        process.env.WHETSTONE_API_KEY,
    ),
    doctrineConfigured: Boolean(process.env.DOCTRINE_BASE_URL),
    modelRequired: true,
    doctrineRequiredForLocalSources: false,
  };
}