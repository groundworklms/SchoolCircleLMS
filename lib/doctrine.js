// Adapter for the grounding engine (Anchor). See docs/04-grounding-and-anchor.md.
//
// The seam is deliberately thin: anything returning the /api/ask contract works, so
// Anchor is replaceable. The one invariant that must never be "fixed": we NEVER fall
// back to an ungrounded model. When grounding is missing, unreachable, or errors, we
// refuse — a refusal is a correct answer, an invented one is not.

const BASE = () => process.env.DOCTRINE_BASE_URL;
const TIMEOUT_MS = () => Number(process.env.DOCTRINE_TIMEOUT_MS || 30000);

export function grounded() {
  return Boolean(BASE());
}

// Returns the /api/ask contract object:
//   { abstained, abstainReason, answer, citations:[{n,citation,pub_id,page_printed}],
//     retrieved, topScore, latencyMs }
// On failure it returns an abstained-shaped object with an `error` code the route maps
// to an HTTP status (docs/04). It never fabricates an answer.
export async function ask({ question, k = 8 }) {
  if (!BASE()) {
    return {
      abstained: true,
      abstainReason: "no_doctrine_service",
      error: "NO_DOCTRINE_SERVICE",
      citations: [],
      answer: "Grounding is not configured on this device.",
      topScore: null,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS());
  try {
    const res = await fetch(`${BASE()}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, k }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      return {
        abstained: true,
        abstainReason: "engine_error",
        error: "DOCTRINE_BAD_RESPONSE",
        citations: [],
        answer: "The grounding engine returned an error; refusing rather than guessing.",
        topScore: null,
      };
    }

    // Pass the contract straight through — whether it answered or abstained.
    return await res.json();
  } catch {
    // Network failure or timeout. Refuse; never answer ungrounded.
    return {
      abstained: true,
      abstainReason: "engine_unreachable",
      error: "DOCTRINE_UNREACHABLE",
      citations: [],
      answer: "The grounding engine is unreachable; refusing rather than answering ungrounded.",
      topScore: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
