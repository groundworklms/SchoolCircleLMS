/*
 * Measure the Sourcerer retrieval floor against the live Anchor and real doctrine.
 *
 * What is being measured
 * ----------------------
 * The learner path runs two gates in series (lib/student-grounding.js):
 *
 *   1. Anchor  POST /api/ground  - a cross-encoder reranker selects which of the
 *      caller's passages are plausible, or abstains. Selection is RELATIVE to the
 *      best candidate in the request (Anchor's own API documentation says so, and
 *      says its 3.0 retrieval floor "does not transfer here").
 *
 *   2. Sourcerer `minScore` - re-scores the passages Anchor ALREADY authorized
 *      with `keywordRetriever`, whose score is query-term coverage:
 *          |distinct query tokens present in passage| / |distinct query tokens|
 *      and refuses with `below_threshold` when the best is under `minScore`,
 *      before any model call happens.
 *
 * The two scores are not in the same space, so this script measures gate 2's
 * input directly: for every question it runs the real Anchor selection, then the
 * real pinned `keywordRetriever` over Anchor's authorized output, and records the
 * top coverage score. Because the gate is a simple `topScore < minScore`, one
 * pass yields the exact decision at every candidate threshold.
 *
 * Candidate pools are 16 real doctrine chunks (production caps Anchor at 16
 * passages per request), so the pool this script sends is the same size Anchor
 * ever sees in production and `anchorScope` passes it through without dropping
 * any. For an answerable question the pool holds the chunk the question was
 * generated from plus 15 distractors from other publications; for an
 * unanswerable question it holds 16 distractors and nothing that answers it.
 *
 * Usage:
 *   node scripts/retrieval-threshold-calibrate.mjs
 *   node scripts/retrieval-threshold-calibrate.mjs --json out.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keywordRetriever } from 'sourcerer';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../test/fixtures/retrieval-threshold-corpus.json');
const BASE = (process.env.ANCHOR_BASE_URL || 'http://192.168.55.1:8000').replace(/\/+$/, '');
const POOL_SIZE = 16;
const THRESHOLDS = [0, 0.02, 0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.4, 0.5];

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

/** Exactly what lib/student-grounding.js anchorGround sends. */
async function ground(question, passages) {
  const response = await fetch(`${BASE}/api/ground`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, passages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`/api/ground -> ${response.status}`);
  return response.json();
}

const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
const chunks = fixture.answerable.map((row, index) => ({
  id: `chunk-${index}`,
  text: row.source_text,
  source: row.citation,
  pub_id: row.pub_id,
}));

/** Deterministic pool: the target chunk (if any) plus distractors from OTHER publications. */
function poolFor(targetIndex, seed) {
  const pool = [];
  if (targetIndex !== null) pool.push(chunks[targetIndex]);
  const targetPub = targetIndex === null ? null : chunks[targetIndex].pub_id;
  for (let step = 0; pool.length < POOL_SIZE && step < chunks.length * 3; step += 1) {
    const candidate = chunks[(seed + step * 7 + 1) % chunks.length];
    if (candidate.pub_id === targetPub) continue;
    if (pool.some((p) => p.id === candidate.id)) continue;
    pool.push(candidate);
  }
  // Fall back to same-publication distractors only if the corpus is too small.
  for (let step = 0; pool.length < POOL_SIZE && step < chunks.length; step += 1) {
    const candidate = chunks[(seed + step) % chunks.length];
    if (!pool.some((p) => p.id === candidate.id)) pool.push(candidate);
  }
  return pool.map(({ id, text, source }) => ({ id, text, source }));
}

async function measure(question, pool, expectedChunkId) {
  const grounded = await ground(question, pool);
  const authorized = Array.isArray(grounded.passages) ? grounded.passages : [];
  if (grounded.abstained === true || authorized.length === 0) {
    return {
      anchor: 'abstained',
      authorizedCount: authorized.length,
      keptTarget: false,
      topScore: null,
      topSource: null,
    };
  }
  // The real pinned scorer, over exactly what Anchor authorized.
  const retrieve = keywordRetriever(authorized);
  const ranked = await retrieve(question, authorized.length);

  // keywordRetriever drops every passage scoring exactly 0 (`.filter(d => d.score > 0)`),
  // so a surviving top score is ALWAYS > 0 and `minScore` can never be what rejects a
  // zero-overlap case. When nothing survives, Sourcerer refuses `not_in_sources`
  // irrespective of minScore -- a lexical refusal no threshold value can switch off.
  if (ranked.length === 0) {
    return {
      anchor: 'grounded',
      gate2: 'not_in_sources',
      authorizedCount: authorized.length,
      survivorCount: 0,
      keptTarget: expectedChunkId ? authorized.some((p) => p.id === expectedChunkId) : null,
      topScore: null,
      topSource: null,
    };
  }

  const top = ranked[0];
  return {
    anchor: 'grounded',
    gate2: 'scored',
    authorizedCount: authorized.length,
    // How much of Anchor's authorized evidence the lexical filter throws away.
    survivorCount: ranked.length,
    keptTarget: expectedChunkId ? authorized.some((p) => p.id === expectedChunkId) : null,
    topScore: top.score,
    topSource: top.source,
    scores: ranked.map((r) => Number(r.score.toFixed(4))),
  };
}

const rows = [];

for (const [index, row] of fixture.answerable.entries()) {
  const pool = poolFor(index, index);
  let result;
  try {
    result = await measure(row.question, pool, `chunk-${index}`);
  } catch (error) {
    console.error(`FATAL: Anchor unreachable during answerable[${index}]: ${error.message}`);
    process.exit(2);
  }
  rows.push({ klass: 'answerable', id: row.item_id, pub_id: row.pub_id, question: row.question, ...result });
  console.log(
    `[answerable ${index + 1}/${fixture.answerable.length}] ${result.anchor} auth=${result.authorizedCount} target_kept=${result.keptTarget} top=${result.topScore === null ? 'n/a' : result.topScore.toFixed(3)}`,
  );
}

for (const [index, row] of fixture.unanswerable.entries()) {
  const pool = poolFor(null, index * 3);
  let result;
  try {
    result = await measure(row.question, pool, null);
  } catch (error) {
    console.error(`FATAL: Anchor unreachable during unanswerable[${index}]: ${error.message}`);
    process.exit(2);
  }
  rows.push({ klass: 'unanswerable', id: row.id, why: row.why, question: row.question, ...result });
  console.log(
    `[unanswerable ${index + 1}/${fixture.unanswerable.length}] ${result.anchor} auth=${result.authorizedCount} top=${result.topScore === null ? 'n/a' : result.topScore.toFixed(3)}`,
  );
}

const answerable = rows.filter((r) => r.klass === 'answerable');
const unanswerable = rows.filter((r) => r.klass === 'unanswerable');

// Refusals Anchor already made are not attributable to the second gate.
const ansGrounded = answerable.filter((r) => r.anchor === 'grounded');
const unansGrounded = unanswerable.filter((r) => r.anchor === 'grounded');
// Scored cases are the only ones minScore can decide; not_in_sources is refused
// by the lexical filter inside keywordRetriever at every threshold, including 0.
const ansScored = ansGrounded.filter((r) => r.gate2 === 'scored');
const unansScored = unansGrounded.filter((r) => r.gate2 === 'scored');
const ansLexicalDrop = ansGrounded.filter((r) => r.gate2 === 'not_in_sources');
const unansLexicalDrop = unansGrounded.filter((r) => r.gate2 === 'not_in_sources');

console.log('\n=== Anchor (gate 1) alone ===');
console.log(`answerable   : ${ansGrounded.length}/${answerable.length} grounded, ${answerable.length - ansGrounded.length} abstained`);
console.log(`             : target chunk retained in ${ansGrounded.filter((r) => r.keptTarget).length}/${ansGrounded.length} grounded cases`);
console.log(`unanswerable : ${unansGrounded.length}/${unanswerable.length} grounded, ${unanswerable.length - unansGrounded.length} abstained`);

console.log('\n=== keywordRetriever lexical filter (inside gate 2, not controlled by minScore) ===');
console.log(`answerable refused not_in_sources at EVERY minScore: ${ansLexicalDrop.length}/${ansGrounded.length}`);
console.log(`unanswerable refused not_in_sources at EVERY minScore: ${unansLexicalDrop.length}/${unansGrounded.length}`);
if (ansScored.length) {
  const kept = ansScored.reduce((sum, r) => sum + r.survivorCount, 0);
  const auth = ansScored.reduce((sum, r) => sum + r.authorizedCount, 0);
  console.log(
    `Anchor-authorized passages surviving the lexical filter: ${kept}/${auth} (${((kept / auth) * 100).toFixed(1)}%) -- the remainder are discarded evidence`,
  );
}

console.log('\n=== Sourcerer minScore (gate 2) sweep ===');
console.log('minScore | over-refused answerable | unanswerable past gate 2 | answerable reaching model');
const table = [];
for (const threshold of THRESHOLDS) {
  // A not_in_sources case is over-refused at every threshold; count it so the
  // table reports total over-refusal, not just the part minScore controls.
  const overRefusedByScore = ansScored.filter((r) => r.topScore < threshold);
  const overRefused = [...ansLexicalDrop, ...overRefusedByScore];
  const unansPast = unansScored.filter((r) => r.topScore >= threshold);
  const ansPast = ansScored.filter((r) => r.topScore >= threshold);
  table.push({
    minScore: threshold,
    overRefusedCount: overRefused.length,
    overRefusedByLexicalFilter: ansLexicalDrop.length,
    overRefusedByThreshold: overRefusedByScore.length,
    overRefusedIds: overRefused.map((r) => r.id),
    unanswerablePastGateCount: unansPast.length,
    answerableReachingModel: ansPast.length,
  });
  console.log(
    `${String(threshold).padEnd(8)} | ${String(`${overRefused.length}/${ansGrounded.length}`).padEnd(23)} | ${String(`${unansPast.length}/${unansGrounded.length}`).padEnd(24)} | ${ansPast.length}/${ansGrounded.length}`,
  );
}

const scores = ansScored.map((r) => r.topScore).sort((a, b) => a - b);
if (scores.length) {
  const at = (q) => scores[Math.min(scores.length - 1, Math.floor(q * (scores.length - 1)))];
  console.log(
    `\nanswerable top-coverage distribution: min=${scores[0].toFixed(3)} p10=${at(0.1).toFixed(3)} p50=${at(0.5).toFixed(3)} p90=${at(0.9).toFixed(3)} max=${scores[scores.length - 1].toFixed(3)}`,
  );
}
const unansScores = unansScored.map((r) => r.topScore).sort((a, b) => a - b);
if (unansScores.length) {
  console.log(
    `unanswerable top-coverage distribution: min=${unansScores[0].toFixed(3)} max=${unansScores[unansScores.length - 1].toFixed(3)}`,
  );
}
console.log(
  '\nNote: "past gate 2" is NOT a false answer. Gate 2 precedes the model; a question that clears it still faces strict cite-or-refuse, the citation set-equality check, and Understudy. End-state safety is measured by scripts/retrieval-threshold-e2e.mjs.',
);

const outPath = arg('--json');
if (outPath) {
  await writeFile(
    resolve(process.cwd(), outPath),
    `${JSON.stringify({ anchor: BASE, measured_utc: new Date().toISOString(), poolSize: POOL_SIZE, rows, table }, null, 1)}\n`,
    'utf8',
  );
  console.log(`\nwrote ${outPath}`);
}
