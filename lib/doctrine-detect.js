/**
 * Find the Anchor engine on whatever laptop the Orin is plugged into.
 *
 * The board binds the USB device-mode interface, so the address is the same on
 * every laptop -- there is nothing to discover on a network, just a short list
 * of places it can be. Probing is therefore a fixed, ordered sweep rather than
 * a scan:
 *
 *   1. http://192.168.55.1:8000  the Orin over the USB cable. No SSH key and no
 *                                tunnel needed; this is the plug-and-go path.
 *   2. http://localhost:8000     a laptop running ops/tunnel.sh.
 *   3. whatever is already configured, so the panel can confirm it still answers.
 *
 * Every probe is bounded and independent: one unreachable candidate must not
 * delay the others or hang the panel, so they run concurrently with a short
 * abort and failures come back as data, not exceptions.
 */

export const USB_CANDIDATE = 'http://192.168.55.1:8000';
export const TUNNEL_CANDIDATE = 'http://localhost:8000';

// Short on purpose. An address with nothing behind it should fail fast enough
// that sweeping three of them still feels instant to the instructor.
const PROBE_TIMEOUT_MS = 2500;

const LABELS = {
  [USB_CANDIDATE]: 'Orin over USB',
  [TUNNEL_CANDIDATE]: 'Local tunnel',
};

function stripTrailingSlash(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/** The ordered, de-duplicated list of addresses worth trying. */
export function doctrineCandidates(configuredBaseUrl) {
  const configured = stripTrailingSlash(configuredBaseUrl);
  const ordered = [USB_CANDIDATE, TUNNEL_CANDIDATE, configured].filter(Boolean);
  return [...new Set(ordered)];
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`returned ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // A captive portal or a wrong port answers 200 with HTML. That is a miss,
    // not a working engine.
    throw new Error('returned a non-JSON response');
  }
}

/** Publications and chunk count, so an instructor can confirm the right corpus. */
function summariseCorpus(corpus) {
  if (!corpus || typeof corpus !== 'object') return null;
  const documents = Array.isArray(corpus.documents) ? corpus.documents : [];
  return {
    publications: documents
      .map((doc) => ({
        pubId: typeof doc?.pub_id === 'string' ? doc.pub_id : null,
        chunks: Number.isFinite(Number(doc?.chunks)) ? Number(doc.chunks) : null,
      }))
      .filter((doc) => doc.pubId),
    totalChunks: Number.isFinite(Number(corpus.total_chunks)) ? Number(corpus.total_chunks) : null,
  };
}

/**
 * Probe one address. Always resolves -- an unreachable engine is a result the
 * panel renders, never a thrown error.
 */
export async function probeDoctrineEndpoint(baseUrl, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const base = stripTrailingSlash(baseUrl);
  const result = { baseUrl: base, label: LABELS[base] || 'Configured endpoint', reachable: false };
  if (!base) return { ...result, error: 'No address to probe.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const health = await getJson(`${base}/api/health`, controller.signal);
    result.reachable = true;
    result.health = {
      ok: Boolean(health?.ok),
      models: health?.models && typeof health.models === 'object' ? health.models : null,
    };
    // Only worth asking once health answered; a corpus read failing on a live
    // engine is informative but must not demote it to unreachable.
    try {
      result.corpus = summariseCorpus(await getJson(`${base}/api/corpus`, controller.signal));
    } catch (cause) {
      result.corpus = null;
      result.corpusError = cause?.message || 'The corpus could not be read.';
    }
  } catch (cause) {
    result.error = cause?.name === 'AbortError'
      ? `No response within ${timeoutMs}ms.`
      : (cause?.message || 'Unreachable.');
  } finally {
    clearTimeout(timer);
  }
  return result;
}

/**
 * Sweep every candidate concurrently and report each one. `found` is the first
 * reachable address in candidate order, which is the one the panel offers.
 */
export async function detectDoctrineEndpoints(configuredBaseUrl, options) {
  const candidates = doctrineCandidates(configuredBaseUrl);
  const results = await Promise.all(
    candidates.map((candidate) => probeDoctrineEndpoint(candidate, options)),
  );
  return { results, found: results.find((entry) => entry.reachable)?.baseUrl || null };
}
