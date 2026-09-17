/**
 * Find the Anchor engine, from the point of view of THE SERVER THIS RUNS ON.
 *
 * Scope first, because it is easy to overstate: these probes are `fetch` calls
 * made server-side (the POST on /api/learning/doctrine-settings), so "reachable"
 * means reachable from the Node process, not from the operator's browser. The
 * first two candidates are only meaningful when that process is running on the
 * laptop the Orin is cabled to. On a hosted deployment (Firebase App Hosting)
 * the server sits in Google's network, `192.168.55.1` is a point-to-point USB
 * address, and `localhost` is the container -- so the sweep is EXPECTED to come
 * back empty there and the operator has to supply a routable address. Measured
 * 16 Sep 2026 on the hosted deployment: the sweep changed nothing.
 *
 * The board binds the USB device-mode interface, so the address is the same on
 * every laptop -- there is nothing to discover on a network, just a short list
 * of places it can be. Probing is therefore a fixed, ordered sweep rather than
 * a scan:
 *
 *   1. http://192.168.55.1:8000  the Orin over the USB cable. No SSH key and no
 *                                tunnel needed -- the plug-and-go path, and only
 *                                reachable when the server is that same laptop.
 *   2. http://localhost:8000     this machine, e.g. a laptop running
 *                                ops/tunnel.sh. The container, if hosted.
 *   3. whatever is already configured, so the panel can confirm it still answers.
 *                                On a hosted deployment this is the only
 *                                candidate that can realistically answer.
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

/**
 * The routes THIS app calls on Anchor, and what stops working without each.
 *
 * All three are POST-only, so a GET that comes back 405 means "the route is
 * there, you used the wrong verb" -- which is exactly the cheap presence check
 * wanted here. A 404 means the board is running an Anchor older than the
 * feature, and that is worth saying out loud: /api/verify and /api/ground are
 * recent, and a board without them still answers /api/health perfectly while
 * silently producing items with no measured support score.
 */
const REQUIRED_ENDPOINTS = [
  { key: 'ask', path: '/api/ask', need: 'grounded answers and citations' },
  { key: 'verify', path: '/api/verify', need: 'measured support scores' },
  { key: 'ground', path: '/api/ground', need: 'scoped passage selection' },
];

/* The four states an operator can act on. Green is `healthy` and nothing else. */
export const HEALTHY = 'healthy';
export const DEGRADED = 'degraded';
export const UNREACHABLE = 'unreachable';
export const UNCONFIGURED = 'unconfigured';

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
 * Is a POST-only route there at all? `true` seen, `false` seen absent, `null`
 * could not tell -- and `null` is NOT an absence, because reporting a missing
 * endpoint we never observed would be the same class of lie as reporting a
 * connection we never made.
 */
async function endpointPresent(base, path, signal) {
  try {
    const res = await fetch(`${base}${path}`, { signal, headers: { Accept: 'application/json' } });
    return res.status !== 404;
  } catch {
    return null;
  }
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
      // Reported as read, not coerced to a verdict: `ok` absent and `ok: false`
      // both have to be distinguishable from `ok: true` further up.
      ok: health?.ok === true,
      // `api` is the service's own statement that its request layer is up.
      // Absent on an older build, so undefined must not read as a failure.
      api: typeof health?.api === 'boolean' ? health.api : null,
      models: health?.models && typeof health.models === 'object' ? health.models : null,
      uptimeS: Number.isFinite(Number(health?.uptime_s)) ? Number(health.uptime_s) : null,
    };
    // Only worth asking once health answered, and all of it concurrently: the
    // whole probe shares one abort, so four small reads cost the same wall
    // clock as one. A corpus read failing on a live engine is informative but
    // must not demote it to unreachable.
    const [corpus, ...presence] = await Promise.all([
      getJson(`${base}/api/corpus`, controller.signal).then(
        (body) => ({ corpus: summariseCorpus(body) }),
        (cause) => ({ error: cause?.message || 'The corpus could not be read.' }),
      ),
      ...REQUIRED_ENDPOINTS.map(({ path }) => endpointPresent(base, path, controller.signal)),
    ]);
    result.corpus = corpus.corpus ?? null;
    if (corpus.error) result.corpusError = corpus.error;
    result.endpoints = Object.fromEntries(
      REQUIRED_ENDPOINTS.map(({ key }, index) => [key, presence[index]]),
    );
  } catch (cause) {
    // Node wraps every transport failure as a bare `TypeError: fetch failed`
    // and hides the useful half on `.cause`. "fetch failed" tells an operator
    // nothing; "fetch failed (ECONNREFUSED)" tells them the board is not
    // listening, which is the difference between checking the cable and
    // checking the corpus.
    const detail = cause?.cause?.code || cause?.cause?.message;
    result.error = cause?.name === 'AbortError'
      ? `No response within ${timeoutMs}ms.`
      : [cause?.message || 'Unreachable.', detail ? `(${detail})` : ''].filter(Boolean).join(' ');
  } finally {
    clearTimeout(timer);
  }
  return result;
}

/**
 * Turn a probe into the state an operator needs before they walk on stage.
 *
 * `healthy` is the ONLY green state and it is deliberately narrow: the engine
 * answered /api/health inside the timeout, said `ok`, did not say its API
 * layer was down, has every model it reports loaded, is holding a non-empty
 * corpus, and serves every route this app calls. Anything short of that is
 * amber with the reason named.
 *
 * The reason for the narrowness: this panel showed green for two days against
 * a dead endpoint, because it was reporting that a URL was CONFIGURED. A green
 * dot an operator cannot trust is worse than no dot, so every ingredient of
 * green here is something that was actually observed on the wire.
 */
export function summariseDoctrineHealth(probe) {
  if (!probe || !probe.baseUrl) {
    return { state: UNCONFIGURED, headline: 'Not configured', problems: [] };
  }
  if (!probe.reachable) {
    return {
      state: UNREACHABLE,
      headline: 'Not answering',
      problems: [probe.error || 'No response.'],
    };
  }

  const problems = [];
  if (probe.health?.ok !== true) problems.push('The engine did not report itself healthy.');
  if (probe.health?.api === false) problems.push('The engine reports its API layer is down.');
  for (const [name, loaded] of Object.entries(probe.health?.models || {})) {
    if (loaded !== true) problems.push(`The ${name} model is not loaded.`);
  }
  if (probe.corpusError) problems.push(`The corpus could not be read: ${probe.corpusError}`);
  else if (!probe.corpus?.totalChunks) {
    problems.push('The corpus is empty — there is nothing to ground an answer against.');
  }
  for (const { key, path, need } of REQUIRED_ENDPOINTS) {
    // Only a value we observed. `null` means the check itself failed and is
    // already covered by whatever else went wrong.
    if (probe.endpoints?.[key] === false) problems.push(`${path} is missing — no ${need}.`);
  }

  return problems.length
    ? { state: DEGRADED, headline: 'Answering, but degraded', problems }
    : { state: HEALTHY, headline: 'Answering', problems: [] };
}

/**
 * The panel's one question: is the engine in force actually working?
 *
 * Takes `doctrineProvider()`'s result rather than importing it, so this module
 * stays free of the settings/Prisma side of the app -- the same inversion
 * lib/doctrine.js uses for its stored base URL.
 *
 * Never throws, for the same reason `verifyClaim` never throws: a probe
 * failure is a RESULT the operator has to see, and an exception here would
 * render as an empty panel, which is indistinguishable from fine.
 */
export async function checkDoctrineHealth(status, options) {
  const baseUrl = status?.ready ? stripTrailingSlash(status.baseUrl) : '';
  const checkedAt = new Date().toISOString();
  if (!baseUrl) {
    return {
      ...summariseDoctrineHealth(null),
      baseUrl: null,
      source: null,
      detail: status?.reason || 'No doctrine engine is configured.',
      corpus: null,
      endpoints: null,
      models: null,
      uptimeS: null,
      checkedAt,
    };
  }
  const probe = await probeDoctrineEndpoint(baseUrl, options);
  return {
    ...summariseDoctrineHealth(probe),
    baseUrl,
    // 'setting' | 'env' -- which side supplied the address that was probed.
    source: status.source || null,
    detail: null,
    corpus: probe.corpus || null,
    endpoints: probe.endpoints || null,
    models: probe.health?.models || null,
    uptimeS: probe.health?.uptimeS ?? null,
    checkedAt,
  };
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
