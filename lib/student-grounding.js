/**
 * The learner-answer grounding boundary.
 *
 * This is intentionally separate from arsenal-core's general-purpose tutor:
 * this path has an explicit, supplied-passage authorization boundary. Anchor
 * may select only those passages, Sourcerer writes and fact-checks against the
 * selected subset, and Understudy judges that exact candidate before it is
 * delivered. There is no corpus, endpoint, or model fallback.
 */

import { doctrineProvider } from './doctrine.js';

const ANCHOR_CONTRACT = 'schoolcircle-grounding-v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const TOTAL_DEADLINE_MS = 110_000;
const HOSTED_ATTEMPT_DEADLINE_MS = 30_000;
const LOCAL_ATTEMPT_DEADLINE_MS = 75_000;
const MODEL_CALL_TIMEOUT_MS = 20_000;
const MAX_ANCHOR_PASSAGES = 16;
const MAX_ANCHOR_PASSAGE_CHARS = 8_000;
const MAX_ANCHOR_BODY_BYTES = 256 * 1024;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_TURNS = 24;
const MAX_HISTORY_TURN_CHARS = 2_000;
const MAX_HISTORY_CHARS = 12_000;
const CONTENT_STOP_WORDS = new Set(
  'a an the of to and or in on for with by is are be as at from that this it its into'.split(' '),
);

const packageLoader = (name) =>
  new Function('specifier', 'return import(specifier)')(name);

function serviceError(stage) {
  const error = new Error('The grounded student-answer service is unavailable.');
  error.code = 'STUDENT_GROUNDING_SERVICE_ERROR';
  error.status = 503;
  error.stage = stage;
  return error;
}

function isExplicitLocalModelError(cause) {
  return typeof cause?.code === 'string' && cause.code.startsWith('STUDENT_LOCAL_MODEL_');
}

function configuredTimeout(timeoutMs) {
  const value = Number(timeoutMs ?? process.env.DOCTRINE_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function characterCount(value) {
  return Array.from(value).length;
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function combineSignals(signals) {
  const available = signals.filter(Boolean);
  if (available.length === 1) return available[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(available);
  const controller = new AbortController();
  for (const signal of available) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function assertActive(signal, stage) {
  if (signal?.aborted) throw serviceError(stage);
}

function contentWords(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !CONTENT_STOP_WORDS.has(word)),
  );
}

function objectOnly(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function normalizeAuthorizedPassages(passages) {
  if (!Array.isArray(passages) || passages.length === 0) {
    throw new TypeError('passages must be a non-empty array');
  }

  const ids = new Set();
  const triples = new Set();
  const provenance = new Set();
  return passages.map((passage, index) => {
    if (
      !objectOnly(passage) ||
      typeof passage.id !== 'string' ||
      !passage.id ||
      typeof passage.text !== 'string' ||
      !passage.text ||
      typeof passage.source !== 'string' ||
      !passage.source
    ) {
      throw new TypeError(`passages[${index}] must contain non-empty string id, text, and source`);
    }
    const triple = JSON.stringify([passage.id, passage.text, passage.source]);
    const origin = JSON.stringify([passage.text, passage.source]);
    if (ids.has(passage.id) || triples.has(triple) || provenance.has(origin)) {
      throw new TypeError('passages must not contain duplicate ids or duplicate passages');
    }
    ids.add(passage.id);
    triples.add(triple);
    provenance.add(origin);
    // Do not pass caller-owned objects to any stage. In particular, unrecognized
    // fields must not become accidental provenance claims at Anchor.
    return { id: passage.id, text: passage.text, source: passage.source };
  });
}

function normalizeHistory(history) {
  if (history === undefined) return [];
  if (!Array.isArray(history)) throw new TypeError('history must be an array');
  if (history.length > MAX_HISTORY_TURNS) {
    throw new RangeError(`history must contain no more than ${MAX_HISTORY_TURNS} turns`);
  }
  let totalCharacters = 0;
  return history.map((turn, index) => {
    if (
      !objectOnly(turn) ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.text !== 'string'
    ) {
      throw new TypeError(`history[${index}] must contain role and text`);
    }
    const characters = characterCount(turn.text);
    if (characters > MAX_HISTORY_TURN_CHARS) {
      throw new RangeError(`history[${index}].text must not exceed ${MAX_HISTORY_TURN_CHARS} characters`);
    }
    totalCharacters += characters;
    if (totalCharacters > MAX_HISTORY_CHARS) {
      throw new RangeError(`history text must not exceed ${MAX_HISTORY_CHARS} characters`);
    }
    return { role: turn.role, text: turn.text };
  });
}

/**
 * Anchor has a hard 16-passage / 8,000-character-per-passage request
 * envelope. Split only supplied text (without rewriting a character), assign
 * deterministic chunk IDs, then rank the resulting authorized passages
 * locally. This is selection, never retrieval: no corpus or network is
 * consulted and Anchor still receives only source-derived text.
 */
function anchorScope(question, passages) {
  const reservedIds = new Set(passages.map((passage) => passage.id));
  const chunks = [];
  for (const passage of passages) {
    const characters = Array.from(passage.text);
    if (characters.length <= MAX_ANCHOR_PASSAGE_CHARS) {
      chunks.push(passage);
      continue;
    }
    for (let index = 0; index * MAX_ANCHOR_PASSAGE_CHARS < characters.length; index++) {
      let id = `${passage.id}::schoolcircle-chunk-${index + 1}`;
      // An input id is allowed to contain any string. Retain a deterministic,
      // collision-free chunk id even for an adversarially chosen original id.
      while (reservedIds.has(id)) id += ':';
      reservedIds.add(id);
      chunks.push({
        id,
        text: characters
          .slice(index * MAX_ANCHOR_PASSAGE_CHARS, (index + 1) * MAX_ANCHOR_PASSAGE_CHARS)
          .join(''),
        source: passage.source,
      });
    }
  }

  const queryWords = contentWords(question);
  const ranked = chunks
    .map((passage, index) => {
      const words = contentWords(passage.text);
      let matched = 0;
      for (const word of queryWords) if (words.has(word)) matched++;
      return { passage, index, score: queryWords.size ? matched / queryWords.size : 0 };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = [];
  for (const { passage } of ranked) {
    if (selected.length === MAX_ANCHOR_PASSAGES) break;
    const candidate = [...selected, passage];
    if (utf8Bytes(JSON.stringify({ question, passages: candidate })) <= MAX_ANCHOR_BODY_BYTES) {
      selected.push(passage);
    }
  }
  if (selected.length === 0) {
    throw new RangeError('authorized passage scope exceeds the Anchor request limit');
  }
  return selected;
}

function refusal(reason, stages) {
  return {
    answer: "I can't give a fully supported answer from the supplied passages.",
    refused: true,
    citations: [],
    reason,
    faithfulness: stages?.sourcerer?.faithfulness ?? null,
    stages,
  };
}

function validateAnchorPayload(payload, authorized) {
  if (
    !objectOnly(payload) ||
    !exactKeys(payload, ['abstained', 'passages', 'contract']) ||
    payload.contract !== ANCHOR_CONTRACT ||
    typeof payload.abstained !== 'boolean' ||
    !Array.isArray(payload.passages)
  ) {
    throw serviceError('anchor');
  }

  const byId = new Map(authorized.map((passage) => [passage.id, passage]));
  const selected = [];
  const seen = new Set();
  for (const passage of payload.passages) {
    if (
      !objectOnly(passage) ||
      !exactKeys(passage, ['id', 'text', 'source']) ||
      typeof passage.id !== 'string' ||
      typeof passage.text !== 'string' ||
      typeof passage.source !== 'string' ||
      seen.has(passage.id)
    ) {
      throw serviceError('anchor');
    }
    const expected = byId.get(passage.id);
    if (
      !expected ||
      expected.text !== passage.text ||
      expected.source !== passage.source
    ) {
      throw serviceError('anchor');
    }
    seen.add(passage.id);
    selected.push({ id: expected.id, text: expected.text, source: expected.source });
  }
  if (!payload.abstained && selected.length === 0) throw serviceError('anchor');
  return { abstained: payload.abstained, passages: selected };
}

async function anchorGround({ question, passages, fetchImpl, timeoutMs, signal }) {
  // Resolve through doctrineProvider() rather than reading the env var, so an
  // Anchor address set at runtime in Settings -> Doctrine engine is honoured.
  // Reading DOCTRINE_BASE_URL directly meant an instructor could plug in the
  // Orin, see the engine reported ready, and still have every learner question
  // answered with a 503 because the tutor never consulted the setting.
  const provider = doctrineProvider();
  const configuredBase = provider.ready ? provider.baseUrl : '';
  if (!configuredBase || !configuredBase.trim()) throw serviceError('anchor');

  let baseUrl;
  try {
    baseUrl = new URL(configuredBase);
  } catch {
    throw serviceError('anchor');
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw serviceError('anchor');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuredTimeout(timeoutMs));
  const requestSignal = combineSignals([signal, controller.signal]);
  let response;
  let body;
  try {
    assertActive(requestSignal, 'anchor');
    response = await fetchImpl(`${configuredBase.replace(/\/+$/, '')}/api/ground`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, passages }),
      signal: requestSignal,
    });
    if (!response?.ok) throw serviceError('anchor');
    body = await response.text();
    assertActive(requestSignal, 'anchor');
  } catch (cause) {
    if (cause?.code === 'STUDENT_GROUNDING_SERVICE_ERROR') throw cause;
    throw serviceError('anchor');
  } finally {
    clearTimeout(timer);
  }

  try {
    return validateAnchorPayload(JSON.parse(body), passages);
  } catch (cause) {
    if (cause?.code === 'STUDENT_GROUNDING_SERVICE_ERROR') throw cause;
    throw serviceError('anchor');
  }
}

function citationFailure(stages) {
  return refusal('citation_invalid', {
    ...stages,
    sourcerer: { ...stages.sourcerer, status: 'rejected' },
  });
}

function citedPassages({ candidate, result, retrieved, authorized }) {
  if (
    !objectOnly(candidate) ||
    candidate.refused !== false ||
    typeof candidate.answer !== 'string' ||
    candidate.answer !== result.answer ||
    !Array.isArray(candidate.used) ||
    candidate.used.length === 0 ||
    !Array.isArray(retrieved)
  ) {
    return null;
  }

  const markerParts = [...candidate.answer.matchAll(/\[([^\]]*)\]/g)];
  if (
    markerParts.length === 0 ||
    markerParts.some((marker) => !/^[1-9][0-9]*$/.test(marker[1]))
  ) {
    return null;
  }
  const markers = markerParts.map((marker) => Number(marker[1]));
  const inRange = (number) =>
    Number.isSafeInteger(number) && number >= 1 && number <= retrieved.length;
  if (
    !candidate.used.every(inRange) ||
    new Set(candidate.used).size !== candidate.used.length ||
    !markers.every(inRange) ||
    new Set(markers).size !== markers.length ||
    markers.length !== candidate.used.length ||
    !markers.every((marker) => candidate.used.includes(marker))
  ) {
    return null;
  }

  const authorizedById = new Map(authorized.map((passage) => [passage.id, passage]));
  const expected = candidate.used.map((number) => retrieved[number - 1]);
  if (
    expected.some((passage) => {
      const source = authorizedById.get(passage?.id);
      return !source || source.text !== passage.text || source.source !== passage.source;
    }) ||
    !Array.isArray(result.passages) ||
    result.passages.length !== expected.length ||
    result.passages.some((passage, index) => {
      const source = expected[index];
      return !passage || passage.id !== source.id || passage.text !== source.text || passage.source !== source.source;
    }) ||
    !Array.isArray(result.citations) ||
    result.citations.length !== expected.length ||
    result.citations.some((citation, index) => citation?.source !== expected[index].source)
  ) {
    return null;
  }
  return expected.map((passage) => ({
    id: passage.id,
    text: passage.text,
    source: passage.source,
  }));
}

async function productionChat({ signal, path, chatFactory }) {
  // Dynamic import lets this module remain independently testable while the
  // model adapter is assembled, and does not create a second provider path.
  const createChat = chatFactory || (await import('./student-model.js')).createStudentChat;
  if (typeof createChat !== 'function') throw serviceError('model');
  const chat = await createChat({ signal, path });
  if (typeof chat !== 'function') throw serviceError('model');
  return chat;
}

async function withinModelDeadline(call, signal, stage) {
  assertActive(signal, stage);
  const controller = new AbortController();
  const callSignal = combineSignals([signal, controller.signal]);
  let timer;
  let removeAbortListener = () => {};
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(serviceError(stage));
    }, MODEL_CALL_TIMEOUT_MS);
  });
  const totalAbort = new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(serviceError(stage));
      return;
    }
    const onAbort = () => reject(serviceError(stage));
    signal?.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal?.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([call(callSignal), timeout, totalAbort]);
  } finally {
    clearTimeout(timer);
    removeAbortListener();
  }
}

/**
 * Produce a learner answer only after every grounding stage succeeds.
 *
 * The second argument is a test-only dependency seam. Production callers do
 * not get a way to replace, skip, or reorder Anchor, Sourcerer, or Understudy.
 */
async function runGroundedStudentAnswer(
  { question, passages, history } = {},
  {
    fetch: injectedFetch,
    chat: injectedChat,
    // Test-only seam for exercising the production retry orchestration without
    // replacing any grounding stage. Production always dynamically imports the
    // student model adapter above.
    chatFactory,
    load = packageLoader,
    timeoutMs,
    modelPath = 'auto',
  } = {},
  signal,
) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new TypeError('question is required');
  }
  if (characterCount(question) > MAX_QUESTION_CHARS) {
    throw new RangeError(`question must not exceed ${MAX_QUESTION_CHARS} characters`);
  }
  const authorized = normalizeAuthorizedPassages(passages);
  const safeHistory = normalizeHistory(history);
  const scope = anchorScope(question.trim(), authorized);
  const fetchImpl = injectedFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw serviceError('anchor');
  assertActive(signal, 'anchor');

  const anchored = await anchorGround({
    question: question.trim(),
    passages: scope,
    fetchImpl,
    timeoutMs,
    signal,
  });
  const stages = {
    anchor: {
      status: anchored.abstained ? 'abstained' : 'grounded',
      authorizedCount: scope.length,
      selectedCount: anchored.passages.length,
    },
  };
  if (anchored.abstained) return refusal('anchor_abstained', stages);

  // Sourcerer's endpoint option can silently select a global corpus before
  // considering the supplied passages. Reject that configuration rather than
  // allowing an environment variable to pierce this authorization boundary.
  if (process.env.SOURCERER_GROUNDING_URL) throw serviceError('sourcerer');

  let sourcerer;
  let understudy;
  try {
    [sourcerer, understudy] = await Promise.all([load('sourcerer'), load('understudy')]);
    if (
      typeof sourcerer?.ask !== 'function' ||
      typeof sourcerer?.keywordRetriever !== 'function' ||
      typeof understudy?.scoreCase !== 'function' ||
      typeof understudy?.checkGrounding !== 'function'
    ) {
      throw new Error('missing pinned API');
    }
  } catch {
    throw serviceError('dependencies');
  }

  let sharedChat;
  try {
    assertActive(signal, 'model');
    sharedChat = injectedChat || (await productionChat({ signal, path: modelPath, chatFactory }));
    if (typeof sharedChat !== 'function') throw new Error('bad chat');
  } catch (cause) {
    if (cause?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || isExplicitLocalModelError(cause)) {
      throw cause;
    }
    throw serviceError('model');
  }
  if (!injectedChat) {
    stages.model = {
      path: sharedChat.studentModelPath === 'local' ? 'local' : 'hosted',
      fallback: modelPath === 'local',
    };
  }

  let candidate = null;
  let retrieved = null;
  const modelChat = async (system, prompt) => {
    const stage = system.includes('strict doctrine examiner')
      ? 'understudy'
      : system.includes('strict fact-checker')
        ? 'sourcerer_verify'
        : 'sourcerer';
    try {
      const output = await withinModelDeadline(
        (callSignal) => sharedChat(system, prompt, { signal: callSignal }),
        signal,
        stage,
      );
      const data = output?.data ?? output;
      // Pinned Sourcerer and Understudy represent model transport failures as
      // `{ error }`; letting that become a learner-visible refusal would leak
      // provider detail and misrepresent an outage as an evidence decision.
      if (objectOnly(data) && typeof data.error === 'string' && data.error) {
        throw serviceError(stage);
      }
      if (!system.includes('strict fact-checker')) candidate = data;
      return data;
    } catch (cause) {
      if (cause?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || isExplicitLocalModelError(cause)) {
        throw cause;
      }
      throw serviceError(stage);
    }
  };
  const keywordRetrieve = sourcerer.keywordRetriever(anchored.passages);
  const retriever = async (query, count) => {
    // The pinned keyword retriever deliberately projects to {text, source,
    // score}; restore the ID only by an exact unique text/source match. Passing
    // an id through this custom retriever lets Sourcerer's final cited subset
    // remain auditable without changing its retrieval or strict-check logic.
    const matches = (await keywordRetrieve(query, count)).map((match) => {
      const authorizedMatch = anchored.passages.find(
        (passage) => passage.text === match.text && passage.source === match.source,
      );
      if (!authorizedMatch) throw serviceError('sourcerer');
      return { ...match, id: authorizedMatch.id };
    });
    retrieved = matches;
    return matches;
  };

  let result;
  try {
    assertActive(signal, 'sourcerer');
    result = await sourcerer.ask(question.trim(), {
      retriever,
      k: anchored.passages.length,
      history: safeHistory,
      minScore: 0.2,
      chat: modelChat,
      verify: 'strict',
    });
  } catch (cause) {
    if (cause?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || isExplicitLocalModelError(cause)) {
      throw cause;
    }
    if (cause?.code === 'STUDENT_GROUNDING_SERVICE_ERROR') throw cause;
    throw serviceError('sourcerer');
  }
  stages.sourcerer = {
    status: result?.refused ? 'refused' : 'answered',
    reason: typeof result?.reason === 'string' ? result.reason : null,
    faithfulness: result?.faithfulness ?? null,
  };
  if (result?.refused) return refusal(result.reason || 'sourcerer_refused', stages);

  const citations = citedPassages({ candidate, result, retrieved, authorized: anchored.passages });
  if (!citations) return citationFailure(stages);

  let grounding;
  let judgment;
  try {
    assertActive(signal, 'understudy');
    grounding = understudy.checkGrounding(result.answer, citations);
    judgment = await understudy.scoreCase({
      situation: question.trim(),
      response: result.answer,
      rationale: '',
      expect: 'Answer the situation only with facts supported by the cited supplied passages.',
      citations,
      chat: modelChat,
    });
  } catch (cause) {
    if (cause?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || isExplicitLocalModelError(cause)) {
      throw cause;
    }
    throw serviceError('understudy');
  }
  stages.understudy = {
    status: 'checked',
    grounding,
    verdict: judgment?.verdict ?? null,
    conforms: judgment?.conforms === true,
  };
  if (judgment?.errored) throw serviceError('understudy');
  if (!grounding?.grounded || judgment?.verdict !== 'in-doctrine' || judgment?.conforms !== true) {
    stages.understudy.status = 'rejected';
    return refusal('understudy_rejected', stages);
  }

  stages.understudy.status = 'accepted';
  return {
    answer: result.answer,
    refused: false,
    citations,
    reason: null,
    faithfulness: result.faithfulness ?? null,
    stages,
  };
}

/**
 * The 110-second operation deadline reserves 30 seconds for hosted primary
 * work and 75 seconds for one local retry, with bounded scoped grounding and
 * per-model calls inside each attempt.
 */
export async function groundedStudentAnswer(input = {}, dependencies = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(serviceError('deadline'));
    }, TOTAL_DEADLINE_MS);
  });
  try {
    const initialPath = await Promise.race([
      dependencies.initialModelPath === 'hosted' || dependencies.initialModelPath === 'local'
        ? Promise.resolve(dependencies.initialModelPath)
        : dependencies.chat || dependencies.chatFactory
          ? Promise.resolve('auto')
          : (async () => {
            const studentModel = await import('./student-model.js');
            return typeof studentModel.studentModelPreferredPath === 'function'
              ? studentModel.studentModelPreferredPath()
              : 'hosted';
          })(),
      deadline,
    ]);
    const runAttempt = async (modelPath, attemptMs) => {
      const attempt = new AbortController();
      const timer = setTimeout(() => attempt.abort(), attemptMs);
      try {
        return await runGroundedStudentAnswer(
          input,
          {
            ...dependencies,
            modelPath,
            // Fallback/local Anchor calls remain within the scoped 15-second
            // service contract, leaving time for all three local model stages.
            ...(modelPath === 'local'
              ? { timeoutMs: Math.min(Number(dependencies.timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS) }
              : {}),
          },
          combineSignals([controller.signal, attempt.signal]),
        );
      } catch (cause) {
        const modelStage = ['model', 'sourcerer', 'sourcerer_verify', 'understudy'].includes(cause?.stage);
        if (
          modelPath === 'hosted'
          && attempt.signal.aborted
          && !controller.signal.aborted
          && (cause?.code === 'STUDENT_MODEL_REQUEST_ABORTED' || modelStage)
        ) {
          const error = new Error('The student OpenAI model could not be reached.');
          error.code = 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE';
          error.status = 502;
          throw error;
        }
        throw cause;
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await Promise.race([
        runAttempt(
          initialPath,
          initialPath === 'local'
            ? (dependencies.attemptTimeouts?.local ?? LOCAL_ATTEMPT_DEADLINE_MS)
            : (dependencies.attemptTimeouts?.hosted ?? HOSTED_ATTEMPT_DEADLINE_MS),
        ),
        deadline,
      ]);
    } catch (cause) {
      // A retry is safe only before delivering any answer and only for a
      // hosted transport outage. Re-run Anchor, strict Sourcerer verification,
      // and Understudy entirely against the explicitly configured local model;
      // never combine stages produced by two different models.
      if (cause?.code !== 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || dependencies.chat) throw cause;
      return await Promise.race([
        runAttempt('local', dependencies.attemptTimeouts?.local ?? LOCAL_ATTEMPT_DEADLINE_MS),
        deadline,
      ]);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const STUDENT_GROUNDING_CONTRACT = ANCHOR_CONTRACT;