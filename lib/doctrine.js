/**
 * Grounded doctrine service adapter.
 *
 * `/api/generate` already carries the right rule in its system prompt — "The POI is the
 * authority. Derive only from what it states; never invent doctrine, publication numbers,
 * or standards." Nothing enforces it. A model told not to invent doctrine will still
 * invent doctrine, and neither the instructor nor the student can tell which sentences
 * came from the source and which the model supplied.
 *
 * This adapter talks to a retrieval-grounded service that makes the rule checkable:
 * every claim carries the publication, chapter, section and PRINTED page it came from,
 * and the service refuses outright when the corpus does not support an answer. The
 * refusal is the part that matters — an assistant that answers everything is one an
 * instructor cannot delegate to, because they would have to check all of it anyway.
 *
 * It follows the same shape as `textProvider()` in ./providers: read one env var, report
 * status honestly, and degrade instead of throwing when it is not configured.
 *
 *   DOCTRINE_BASE_URL    URL of an Anchor instance -- https://github.com/jeranaias/anchor
 *                        (self-hosted, offline) -- e.g. http://192.168.55.1:8000
 *   DOCTRINE_TIMEOUT_MS  optional, default 30000
 *
 * Unset is a normal state, not an error: the app runs exactly as it does today.
 *
 * The engine is a board on a USB cable that moves between laptops, so the
 * address is also settable at runtime from Settings -> Doctrine engine. That
 * stored value wins over the environment variable. The dependency is
 * DELIBERATELY inverted -- lib/doctrine-settings.js pushes the address down via
 * `setStoredDoctrineBaseUrl` rather than this module importing it -- because
 * this file is loaded by scripts/offline/verify*, and importing the settings
 * store would drag Prisma into the offline verification kit.
 */

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * The operator-chosen address, or null to defer to the environment. Held here
 * so `doctrineProvider()` stays synchronous and can never throw: the settings
 * store primes this out-of-band, and a store that is unreachable simply leaves
 * the previous value (or null) in place.
 */
let storedBaseUrl = null;

export function setStoredDoctrineBaseUrl(value) {
  storedBaseUrl = typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function doctrineProvider() {
  // Precedence: operator setting -> environment -> unconfigured.
  const stored = storedBaseUrl;
  if (stored) {
    return { ready: true, source: 'setting', baseUrl: stored.replace(/\/+$/, '') };
  }
  const baseUrl = process.env.DOCTRINE_BASE_URL;
  if (!baseUrl) {
    return {
      ready: false,
      source: null,
      // Names the RUNTIME path first, because that is now the intended one and
      // the operator reading this is usually looking at the Settings panel that
      // offers it. apphosting.yaml deliberately leaves DOCTRINE_BASE_URL unset
      // (a pinned tunnel hostname rots), so "set the env var" on its own is
      // advice to redeploy for something that needs no redeploy.
      reason:
        'No doctrine engine configured. Set its address in Settings -> Doctrine engine, or ' +
        'supply DOCTRINE_BASE_URL. Without one, generated content is ungrounded and citations ' +
        'are unavailable.',
    };
  }
  return { ready: true, source: 'env', baseUrl: baseUrl.replace(/\/+$/, '') };
}

/**
 * Ask a question against the doctrine corpus.
 *
 * Resolves with `abstained: true` when the corpus does not support an answer. That is a
 * SUCCESS, not a failure — callers must render it as "not in the corpus" rather than as
 * an error, and must never quietly fall back to an ungrounded model to fill the gap.
 * Doing so reintroduces exactly the invented doctrine this exists to prevent.
 */
export async function askDoctrine({ question, timeoutMs } = {}) {
  const status = doctrineProvider();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_DOCTRINE_SERVICE';
    throw err;
  }
  if (typeof question !== 'string' || !question.trim()) {
    const err = new Error('question is required and must be a string');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  // An explicit abort: a hung backend must surface as a timeout the UI can explain, not
  // as a request that never settles.
  const controller = new AbortController();
  // A non-numeric env var used to become NaN, and setTimeout(NaN) fires immediately --
  // so a typo in .env.local produced "did not respond within NaNms" on every request.
  const configured = Number(timeoutMs || process.env.DOCTRINE_TIMEOUT_MS);
  const ms = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), ms);

  let raw;
  let res;
  try {
    res = await fetch(`${status.baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Doctrine service returned ${res.status}`);
      err.code = 'DOCTRINE_ERROR';
      throw err;
    }
    // Read the body INSIDE the try, so the abort still covers it. fetch() resolves when
    // the headers arrive, so a server that sends a status line and then stalls mid-body
    // would otherwise hang forever with the timer already cleared.
    raw = await res.text();
  } catch (cause) {
    // Only rethrow OUR errors unchanged. A DOMException carries a NUMERIC code
    // (AbortError is 20), so a truthiness test here let the raw abort escape as
    // 'This operation was aborted' instead of the message naming the timeout.
    if (typeof cause.code === 'string') throw cause;
    const err = new Error(
      cause.name === 'AbortError'
        ? `Doctrine service did not respond within ${ms}ms`
        : `Cannot reach doctrine service at ${status.baseUrl}: ${cause.message}`
    );
    err.code = 'DOCTRINE_UNREACHABLE';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // A 200 carrying HTML is the realistic failure here: point DOCTRINE_BASE_URL at the
  // wrong port and a captive portal, proxy error page, or the service's own index page
  // comes back with status 200. Parsing that must not surface as an unhandled
  // SyntaxError echoing markup into the response body.
  let d;
  try {
    d = JSON.parse(raw);
  } catch (cause) {
    const err = new Error(
      `Doctrine service at ${status.baseUrl} returned ${res.status} but not JSON`);
    err.code = 'DOCTRINE_BAD_RESPONSE';
    throw err;
  }
  return {
    abstained: Boolean(d.abstained),
    // Populated on an abstention too, e.g. 'low_retrieval_score' — worth surfacing,
    // because "the corpus does not cover this" is a curriculum finding, not just a miss.
    abstainReason: d.abstain_reason ?? null,
    answer: d.text ?? null,
    // publication, chapter, section, paragraph and printed page, so a Marine can check it
    // in the book rather than taking the app's word for it.
    citations: Array.isArray(d.citations) ? d.citations : [],
    retrieved: d.retrieved ?? null,
    topScore: d.top_rerank_score ?? null,
    latencyMs: typeof d.latency_s === 'number' ? Math.round(d.latency_s * 1000) : null,
  };
}

/* ---------------------------------------------------------------------------
 * Entailment verification
 *
 * `askDoctrine` above grounds an ANSWER at generation time. This grounds a
 * claim that already exists: given the passage text an item is cited to, does
 * an entailment model actually find the item's assertion supported by it?
 *
 * The landing page promises exactly this ("an on-device entailment check
 * confirms the specifics are actually supported by the source"), and until an
 * HHEM score is measured and stored, `Item.support` is null and the review
 * panel says "not verified". That is the honest state and it must stay
 * reachable: a number that was not measured is worse than no number, because
 * an instructor ratifying an item is entitled to know the difference between
 * "verified 0.84" and "not checked".
 *
 * So, unlike `askDoctrine`, this NEVER throws and never returns a fallback
 * score. Every failure -- unconfigured, unreachable, timed out, non-200,
 * non-JSON, `ok:false`, a `support` that is not a finite 0..1 number -- comes
 * back as `{ ok: false, reason }` and the caller records nothing. The service's
 * own contract is the same shape for the same reason: it answers `ok:false`
 * rather than raising so a caller that cannot verify can carry on unverified.
 *
 *   DOCTRINE_VERIFY_TIMEOUT_MS  optional, per claim, default 15000
 *
 * The board is an 8GB Orin running a real model per call, so the caller
 * (lib/learning/verify-support.js) also bounds concurrency and the total time
 * one course may spend here.
 * ------------------------------------------------------------------------- */

/** The endpoint's own limits. Exceeding them is a 422, not a score. */
export const VERIFY_MAX_CLAIM_CHARS = 4000;
export const VERIFY_MAX_SPANS = 8;
export const VERIFY_MAX_SPAN_CHARS = 12_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 15_000;

function unverified(reason) {
  return { ok: false, reason };
}

/**
 * Score one claim against the passages it is supposed to come from.
 *
 * @param {object} input
 * @param {string} input.claim   the assertion to check, <= VERIFY_MAX_CLAIM_CHARS
 * @param {string[]} input.spans the passage text it must be entailed by
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{ok:true,support:number,spans:number,backend:string|null}|{ok:false,reason:string}>}
 */
export async function verifyClaim({ claim, spans, timeoutMs } = {}) {
  const status = doctrineProvider();
  if (!status.ready) return unverified('no_doctrine_service');

  const text = typeof claim === 'string' ? claim.trim() : '';
  if (!text) return unverified('no_claim');
  // Deliberately NOT truncated. A score measured on the first 4000 characters
  // of a longer lesson is not a score for that lesson, and presenting it as
  // one is the dishonesty this whole path exists to remove. An over-long claim
  // is simply not verified.
  if (text.length > VERIFY_MAX_CLAIM_CHARS) return unverified('claim_too_long');

  // Spans ARE truncated and capped, because both cut the evidence down rather
  // than the claim: less passage can only make an entailment harder to find,
  // so the error is toward "not supported", never toward a flattering number.
  const passages = (Array.isArray(spans) ? spans : [])
    .map((span) => (typeof span === 'string' ? span.trim() : ''))
    .filter(Boolean)
    .slice(0, VERIFY_MAX_SPANS)
    .map((span) => span.slice(0, VERIFY_MAX_SPAN_CHARS));
  if (passages.length === 0) return unverified('no_spans');

  const configured = Number(timeoutMs || process.env.DOCTRINE_VERIFY_TIMEOUT_MS);
  const ms = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_VERIFY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  let raw;
  try {
    const res = await fetch(`${status.baseUrl}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: text, spans: passages }),
      signal: controller.signal,
    });
    // A 422 from the request validator and a 500 from a dead model are both
    // "no measurement", not an approval failure.
    if (!res.ok) return unverified(`http_${res.status}`);
    // Read the body inside the try so the abort still covers a server that
    // sends headers and then stalls -- same reasoning as askDoctrine.
    raw = await res.text();
  } catch (cause) {
    return unverified(cause?.name === 'AbortError' ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    // A captive portal or the wrong port answers 200 with HTML.
    return unverified('bad_response');
  }
  if (!body || typeof body !== 'object' || body.ok !== true) {
    const reason = typeof body?.error === 'string' && body.error ? body.error : 'not_ok';
    return unverified(reason);
  }
  const support = body.support;
  // The one place a number becomes a measurement. Anything that is not a
  // finite probability is not one, however confidently it was serialised.
  if (typeof support !== 'number' || !Number.isFinite(support) || support < 0 || support > 1) {
    return unverified('bad_support');
  }
  return {
    ok: true,
    support,
    spans: Number.isInteger(body.spans) ? body.spans : passages.length,
    backend: typeof body.backend === 'string' ? body.backend : null,
  };
}
