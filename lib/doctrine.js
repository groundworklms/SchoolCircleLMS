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
      reason:
        'No doctrine service configured. Set DOCTRINE_BASE_URL to a grounded retrieval ' +
        'endpoint. Without it, generated content is ungrounded and citations are unavailable.',
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
