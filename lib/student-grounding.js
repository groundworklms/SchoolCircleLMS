/**
 * The learner-answer grounding boundary.
 *
 * This is intentionally separate from arsenal-core's general-purpose tutor:
 * this path has an explicit, supplied-passage authorization boundary. Anchor
 * may select only those passages, Sourcerer writes and fact-checks against the
 * selected subset, and Understudy judges that exact candidate before it is
 * delivered. There is no corpus and no endpoint fallback.
 *
 * There is ONE fallback, and it is grounded, not a model free-pass: when the
 * Anchor engine (the Orin) is unreachable -- which is its normal state on the
 * hosted deployment, where it sits on a USB link to a laptop -- the configured
 * Settings model composes the answer STRICTLY over the same supplied passages,
 * and the identical downstream stages (Sourcerer strict verify, citedPassages,
 * Understudy) still decide cite-or-refuse. It substitutes only Anchor's
 * candidate filter (with the local ranking already computed here), never the
 * faithfulness gate, and it can only ever cite a supplied passage. See
 * runGroundedStudentAnswer and anchorUnavailableError for the exact boundary.
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

/**
 * Sourcerer's retrieval floor, and why the default is 0.
 *
 * This number is NOT in the same space as Anchor's score, and reading it as if
 * it were is what made it harmful. Anchor ranks with a cross-encoder reranker
 * whose logits are unbounded (measured on the Orin: +7.53 for a well-supported
 * question, -4.73 for an unsupported one) and its retrieval path's own floor is
 * 3.0 against per-publication calibrated scores. `minScore` is compared against
 * `keywordRetriever`'s score, which is query-term coverage:
 *
 *     |distinct query tokens appearing in the passage| / |distinct query tokens|
 *
 * a fraction in [0, 1] with no IDF weighting -- every token counts the same,
 * and the denominator is the length of the QUESTION. So the bar rises with how
 * verbosely a learner phrases themselves: interrogatives and modals ("what",
 * "how", "should", "when", "their") are not in Sourcerer's 22-word stop list,
 * inflate the denominator, and essentially never appear in doctrine prose. A
 * precisely-worded question is therefore penalised for being precise.
 *
 * Applying that fraction as a floor here also asks it to do a job it was not
 * written for. Sourcerer's floor guards the case where Sourcerer does its own
 * retrieval over an unfiltered pile and a single common word is the only match.
 * On this path retrieval has already happened: Anchor has selected these
 * passages with a reranker, and Anchor's /api/ground contract states outright
 * that it is "the candidate filter here, not the faithfulness gate", because
 * "the caller runs a strict cite-or-refuse stage over whatever comes back".
 * We do run that stage -- the model must emit in-range `used` indices and inline
 * [n] markers, `citedPassages` then enforces set equality between markers and
 * `used` against Anchor's authorized set, and Understudy independently checks
 * grounding and returns an in-doctrine verdict. A lexical coverage floor in
 * front of all that removes real answers without removing any false one.
 *
 * Measured against the live 4,731-chunk index (scripts/retrieval-threshold-*.mjs,
 * see docs/retrieval-threshold-calibration.md): the shipped 0.2 wrongly refused
 * answerable doctrine questions, while no value of this floor -- including 0 --
 * let a single unanswerable question through to an answer. Hence 0: the floor is
 * inert by default and the strict stages carry the refusal, which is where the
 * architecture already put the responsibility.
 *
 * It stays configurable because it is a tuning knob for an event, not a
 * constant: SOURCERER_MIN_SCORE raises the floor again without a code change.
 * Values outside [0, 1] cannot be meaningful in a coverage space, so they fall
 * back to the default rather than silently refusing (>1) or being a no-op (<0).
 */
const DEFAULT_SOURCERER_MIN_SCORE = 0;

function sourcererMinScore() {
  const raw = process.env.SOURCERER_MIN_SCORE;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_SOURCERER_MIN_SCORE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_SOURCERER_MIN_SCORE;
  return value;
}

// The cite-or-refuse rules the answer stage is actually held to, stated so the
// model can satisfy them. This is the same contract the instructor-side tutor
// already puts in front of Sourcerer (see sourcererModelContract in
// lib/arsenal-core.js); the learner path had been sending Sourcerer's bare
// house prompt alone. It only describes the checks -- it never relaxes one, and
// a candidate that ignores it is still refused.
const ANSWER_PROTOCOL = [
  'Return exactly JSON with refused (boolean), answer (string), and used (1-based integer passage numbers).',
  'If the passages do not support an answer, set refused true, answer to an empty string, and used to an empty array.',
  'If they do support one, set refused false and put an inline [n] marker on every sentence that rests on passage n; repeat a marker as often as you cite that passage.',
  'Write each marker on its own, as [1][2], never grouped as [1, 2], and never cite a number that is not one of the passages above.',
  'List in used exactly the distinct numbers you marked: never a number you did not mark, and never leave out one you did.',
].join(' ');

const packageLoader = (name) =>
  new Function('specifier', 'return import(specifier)')(name);

function serviceError(stage) {
  const error = new Error('The grounded student-answer service is unavailable.');
  error.code = 'STUDENT_GROUNDING_SERVICE_ERROR';
  error.status = 503;
  error.stage = stage;
  return error;
}

/**
 * Anchor could not be reached AT ALL -- a distinct signal, not a distinct error.
 *
 * This is the ONLY condition under which the tutor is permitted to compose a
 * grounded fallback over the supplied course passages (see runGroundedStudentAnswer).
 * The distinction is a grounding-integrity decision, not a convenience: Anchor
 * on this path is the candidate FILTER, never the faithfulness gate -- its own
 * /api/ground contract says so -- so losing an unreachable filter is safe
 * because the strict cite-or-refuse stages downstream still carry the refusal.
 * A REACHABLE Anchor that answers with an off-contract or forged-provenance
 * payload is the opposite: a tampering or misconfiguration signal. Silently
 * switching engines there would let a compromised or mis-pointed Anchor bypass
 * the authorization boundary, so those keep throwing a plain anchor error and
 * are never downgraded to the model.
 */
function anchorUnavailableError() {
  const error = serviceError('anchor');
  error.anchorUnavailable = true;
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
  // Unconfigured / not ready is an availability condition, not a failure: no
  // Orin address means there is nothing to reach, so the tutor may fall back.
  if (!configuredBase || !configuredBase.trim()) throw anchorUnavailableError();

  let baseUrl;
  try {
    baseUrl = new URL(configuredBase);
  } catch {
    // A malformed configured address is also "cannot reach Anchor".
    throw anchorUnavailableError();
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw anchorUnavailableError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuredTimeout(timeoutMs));
  const requestSignal = combineSignals([signal, controller.signal]);
  let response;
  let body;
  try {
    // Guard against the CALLER's signal specifically (the operation deadline or
    // attempt budget). That is cancellation -- the whole operation is being torn
    // down -- and must stay a plain error, never a fallback trigger.
    assertActive(signal, 'anchor');
    response = await fetchImpl(`${configuredBase.replace(/\/+$/, '')}/api/ground`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, passages }),
      signal: requestSignal,
    });
    // A reachable Anchor that answers non-2xx returned no grounding decision:
    // that is unavailability, and the tutor may fall back.
    if (!response?.ok) throw anchorUnavailableError();
    body = await response.text();
    assertActive(signal, 'anchor');
  } catch (cause) {
    if (cause?.code === 'STUDENT_GROUNDING_SERVICE_ERROR') throw cause;
    // fetch itself threw. If the caller cancelled, propagate cancellation and do
    // NOT fall back. Otherwise the transport failed (connection refused, DNS, or
    // the bounded Anchor timeout firing) -- the Orin is unreachable, so allow a
    // grounded fallback.
    if (signal?.aborted) throw serviceError('anchor');
    throw anchorUnavailableError();
  } finally {
    clearTimeout(timer);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A 200 carrying HTML (captive portal, wrong port, proxy error page) is a
    // reachable endpoint that did not return a grounding decision -- treat it as
    // unavailability so the tutor degrades instead of hard-failing.
    throw anchorUnavailableError();
  }
  // A PARSEABLE payload that fails contract or provenance validation is a
  // tampering / misconfiguration signal, never an availability one. It throws a
  // plain anchor error (inside validateAnchorPayload) and is never downgraded to
  // the model -- forged provenance must fail loud, not switch engines.
  return validateAnchorPayload(parsed, passages);
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
  // The guarantee is set equality between the inline markers and `used`, not
  // multiset equality. A marker outside `used` is a reference to evidence that
  // was never verified or handed to Understudy, and a `used` entry with no
  // marker is a citation the answer never actually leans on; both stay
  // refusals. Citing one passage in several sentences is neither -- it is how a
  // cited answer is normally written, and counting markers rejected every real
  // multi-sentence answer this path produced.
  const distinctMarkers = new Set(markers);
  if (
    !candidate.used.every(inRange) ||
    new Set(candidate.used).size !== candidate.used.length ||
    !markers.every(inRange) ||
    distinctMarkers.size !== candidate.used.length ||
    !candidate.used.every((number) => distinctMarkers.has(number))
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
  // A citation's number is the marker the answer actually carries, never its
  // position in this list. `used` is 1-based into `retrieved`, so an answer
  // that marks [1] and [4] must reach the learner as chips labelled [1] and
  // [4]; renumbering them 1..n downstream put a [4] in the prose with nothing
  // to follow, which is the one thing a cited answer may not do. Stamping the
  // number here -- inside the check that already proves marker set == `used`
  // set -- makes a single numbering canonical for every consumer, rather than
  // asking the prose and the citation list to agree by convention.
  return expected.map((passage, index) => ({
    n: candidate.used[index],
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

  // Anchor is TRIED FIRST, always. When it is reachable, the existing
  // Anchor -> Sourcerer -> Understudy pipeline runs exactly as before -- there is
  // no regression and no way for a caller to skip or reorder it. The fallback is
  // reached only when Anchor is genuinely unreachable (see anchorUnavailableError):
  // the Orin sits on a USB link to a laptop and is absent on the hosted
  // deployment, which would otherwise 503 the entire tutor -- the product's
  // biggest differentiator, dead on the live site.
  //
  // The fallback is NOT a second model path and it does NOT answer from model
  // knowledge. It substitutes ONLY Anchor's candidate selection with the local
  // ranking already computed above (`scope`, derived purely from the supplied,
  // approved course passages), then runs the SAME downstream stages unchanged:
  // Sourcerer retrieves and writes strictly over `scope`, its strict verifier
  // fact-checks the answer against `scope`, `citedPassages` enforces that every
  // marker maps to a supplied passage, and Understudy independently re-checks
  // grounding. Every one of those refuses when the passages do not support the
  // question. The model used is the same configured Settings model that stage 3
  // already uses (createStudentChat). So the fallback can only cite provided
  // passages and must refuse otherwise -- the same guarantee as the primary path,
  // minus one unreachable candidate filter.
  let anchored;
  let anchorUnavailable = false;
  try {
    anchored = await anchorGround({
      question: question.trim(),
      passages: scope,
      fetchImpl,
      timeoutMs,
      signal,
    });
  } catch (cause) {
    if (
      cause?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' &&
      cause.stage === 'anchor' &&
      cause.anchorUnavailable === true
    ) {
      anchorUnavailable = true;
    } else {
      // Cancellation, forged provenance, off-contract payloads: hard errors that
      // must never silently downgrade to the model.
      throw cause;
    }
  }

  const stages = {
    anchor: anchorUnavailable
      ? {
          // Honest: Anchor produced no grounding decision. selectedCount equals
          // the locally-ranked scope because that scope is exactly the candidate
          // set Anchor would have been handed.
          status: 'unavailable',
          authorizedCount: scope.length,
          selectedCount: scope.length,
        }
      : {
          status: anchored.abstained ? 'abstained' : 'grounded',
          authorizedCount: scope.length,
          selectedCount: anchored.passages.length,
        },
  };

  if (anchorUnavailable) {
    // Record which path answered so the UI and the persisted turn tell the
    // truth: the configured model composed over the course passages, and Anchor
    // did not gate it. This marker never relaxes a downstream check.
    stages.fallback = 'model-grounded';
    anchored = { abstained: false, passages: scope };
  } else if (anchored.abstained) {
    // A legitimate in-scope abstention stays a refusal and must NOT escalate to
    // the model: Anchor was reachable and judged these passages unsupportive.
    return refusal('anchor_abstained', stages);
  }

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
    // Sourcerer's house prompt states the answer shape in one line; the
    // validator below, and Sourcerer's own, enforce considerably more than that
    // line says. Anything a stage rejects has to be stated here or the model has
    // no way to comply -- against live sources the unstated rules were exactly
    // the ones broken: markers written but `used` left empty, and passage
    // references grouped as [1, 2] where only [1][2] is a marker. Stating them
    // is the only honest lever, because the alternative is accepting a citation
    // no stage was able to check.
    const request = stage === 'sourcerer' ? `${system}\n\n${ANSWER_PROTOCOL}` : system;
    try {
      const output = await withinModelDeadline(
        (callSignal) => sharedChat(request, prompt, { signal: callSignal }),
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
      // Read per call, not at import, so an operator can retune the floor at an
      // event without a redeploy.
      minScore: sourcererMinScore(),
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
    const hostedMs = dependencies.attemptTimeouts?.hosted ?? HOSTED_ATTEMPT_DEADLINE_MS;
    const localMs = dependencies.attemptTimeouts?.local ?? LOCAL_ATTEMPT_DEADLINE_MS;
    // A single hosted attempt can flake: the generator is non-deterministic, so
    // a genuinely in-scope answer occasionally fails Sourcerer's strict verify
    // or Understudy's grounding check and is refused. That is a returned refusal,
    // not a thrown transport outage, so the outage retry below never sees it, and
    // on the hosted deployment there is no Orin to fall back to. Allow one more
    // hosted attempt on a GENERATION-quality over-refusal only.
    //
    // This does not weaken the guarantee: every strict gate (Sourcerer verify,
    // citation mapping, Understudy) still runs on the retry, so an unsupported
    // question keeps refusing. A genuine Anchor abstention returns before
    // Sourcerer runs, so `stages.sourcerer` is absent and is never retried; only
    // the local (Orin) path, which is deterministic enough, opts out.
    const isOverRefusal = (outcome) => outcome?.refused === true && outcome?.stages?.sourcerer != null;
    const overRefusalRetries = initialPath === 'local' ? 0 : 1;
    try {
      let outcome = await Promise.race([
        runAttempt(initialPath, initialPath === 'local' ? localMs : hostedMs),
        deadline,
      ]);
      for (let retry = 0; isOverRefusal(outcome) && retry < overRefusalRetries; retry += 1) {
        outcome = await Promise.race([runAttempt(initialPath, hostedMs), deadline]);
      }
      return outcome;
    } catch (cause) {
      // A retry is safe only before delivering any answer and only for a
      // hosted transport outage. Re-run Anchor, strict Sourcerer verification,
      // and Understudy entirely against the explicitly configured local model;
      // never combine stages produced by two different models.
      if (cause?.code !== 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE' || dependencies.chat) throw cause;
      return await Promise.race([
        runAttempt('local', localMs),
        deadline,
      ]);
    }
  } finally {
    clearTimeout(timer);
  }
}

export const STUDENT_GROUNDING_CONTRACT = ANCHOR_CONTRACT;