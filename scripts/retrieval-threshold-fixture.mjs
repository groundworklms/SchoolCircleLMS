/*
 * Build the retrieval-threshold question set from a LIVE Anchor.
 *
 * Both classes are established by measurement, not assumption:
 *
 *   answerable   - Anchor's own recall items. Each item was generated FROM an
 *                  indexed chunk, and /api/learn/answer returns that chunk
 *                  verbatim (`source_text`) with its paragraph-level citation.
 *                  So "the corpus can answer this" is a fact about the index,
 *                  not a guess: we hold the very passage the question came from.
 *
 *   unanswerable - candidate questions are put to /api/ask, which retrieves
 *                  over the whole 4,731-chunk index. Only questions Anchor
 *                  itself abstains on are kept. A candidate that Anchor can
 *                  answer is DROPPED rather than relabelled, so the negative
 *                  class never contains a question the corpus actually covers.
 *
 * Usage:
 *   node scripts/retrieval-threshold-fixture.mjs                     # both phases
 *   node scripts/retrieval-threshold-fixture.mjs --answerable-from f.json
 *   node scripts/retrieval-threshold-fixture.mjs --target 36
 *
 * `--answerable-from` imports an equivalent harvest that was already paid for
 * (each item costs one on-device grading call, ~30 s) instead of re-running it.
 *
 * Anchor address: ANCHOR_BASE_URL, default http://192.168.55.1:8000
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../test/fixtures/retrieval-threshold-corpus.json');
const BASE = (process.env.ANCHOR_BASE_URL || 'http://192.168.55.1:8000').replace(/\/+$/, '');
const LEARNER = 'lanedcal2';

/*
 * Questions aimed OUTSIDE the indexed publications (MCDP 1/1-0/1-1/1-2/1-3/2/3/
 * 5/6/7, MCWP 3-11.3, MCWP 5-10, TC 3-22.9, TCCC).
 *
 * The set deliberately mixes obvious out-of-domain questions with
 * doctrine-flavoured near misses -- a question that sounds like it belongs in a
 * Marine Corps publication but asks for a specific fact these pubs do not
 * carry. The near misses are the ones that matter: an obvious civilian question
 * is easy to refuse, while a plausible-sounding one is what actually gets asked
 * on stage. Every candidate is still verified against the live index below.
 */
const UNANSWERABLE_CANDIDATES = [
  // --- doctrine-flavoured near misses ---
  { id: 'u-aviation-preflight', why: 'aviation maintenance; no aviation pub indexed', question: 'What are the required preflight inspection steps for an F-35B before a vertical landing?' },
  { id: 'u-nuclear-release', why: 'nuclear release authority is not in these pubs', question: 'Who holds release authority for the employment of tactical nuclear weapons, and what is the authentication sequence?' },
  { id: 'u-fitrep-sections', why: 'performance evaluation administration, not doctrine', question: 'Which sections of a Marine Corps fitness report does the reviewing officer complete, and what are the attribute markings?' },
  { id: 'u-uniform-ribbons', why: 'uniform regulations are a separate order', question: 'What is the correct order of precedence for ribbons on the Marine Corps dress blue coat?' },
  { id: 'u-bah-rates', why: 'pay and allowances, not doctrine', question: 'How is the Basic Allowance for Housing rate determined for a sergeant with dependents?' },
  { id: 'u-ucmj-article-15', why: 'military justice procedure, not in these pubs', question: 'What are the maximum punishments a battalion commander may impose at office hours under the UCMJ?' },
  { id: 'u-drill-manual', why: 'drill and ceremonies is a separate publication', question: 'What are the commands and counts for executing a rifle salute at right shoulder arms during a pass in review?' },
  { id: 'u-submarine-ops', why: 'submarine operations are not a Marine Corps pub', question: 'What is the procedure for a submarine to conduct an emergency blow and surface?' },
  { id: 'u-space-orbits', why: 'space operations not indexed', question: 'How is a sun-synchronous orbit selected for a tactical imagery satellite, and what revisit interval does it give?' },
  { id: 'u-cyber-ttp', why: 'defensive cyber TTPs not in these pubs', question: 'What are the specific steps for isolating a compromised host on a tactical network during a defensive cyberspace operation?' },
  { id: 'u-contracting-far', why: 'federal acquisition regulation, not doctrine', question: 'Which FAR part governs a sole-source justification for a bridge contract, and what approval threshold applies?' },
  { id: 'u-recruiting-quota', why: 'recruiting administration not indexed', question: 'How is a monthly recruiting quota assigned to a Marine Corps recruiting substation?' },
  { id: 'u-mos-school-length', why: 'school curriculum lengths not in doctrine', question: 'How many training days is the entry-level course for the 0621 radio operator military occupational specialty?' },
  { id: 'u-ship-engineering', why: 'shipboard engineering plant not indexed', question: 'What is the lineup procedure for bringing a second main propulsion diesel engine online aboard an amphibious transport dock?' },

  // --- plainly out of domain ---
  { id: 'u-camry-torque', why: 'civilian automotive repair', question: 'What is the recommended torque specification for a Toyota Camry cylinder head bolt?' },
  { id: 'u-chemo-dosing', why: 'oncology dosing is far outside TCCC', question: 'What is the standard cisplatin dosing schedule for advanced non-small-cell lung cancer?' },
  { id: 'u-tax-deduction', why: 'tax law', question: 'How do I claim a home office deduction on a US federal income tax return?' },
  { id: 'u-sourdough', why: 'cooking', question: 'What hydration ratio should I use for a sourdough starter kept at room temperature?' },
  { id: 'u-postgres-index', why: 'software engineering', question: 'How do I create a partial B-tree index in PostgreSQL to speed up a filtered query?' },
  { id: 'u-arabic-grammar', why: 'language instruction', question: 'What is the rule for forming the broken plural of a triliteral Arabic noun?' },
  { id: 'u-2027-election', why: 'future/unknowable and not doctrine', question: 'Who won the 2027 Australian federal election and what was the seat count?' },
  { id: 'u-crypto-price', why: 'market data, not doctrine', question: 'What was the closing price of Bitcoin on 14 September 2026?' },
];

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

async function getJson(path, timeoutMs = 60_000) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return response.json();
}

async function postJson(path, body, timeoutMs = 240_000) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status}`);
  return response.json();
}

/** Walk (pub, section) pairs so the scheduler yields distinct items, not the one due item. */
async function harvestAnswerable(target) {
  const { documents } = await getJson('/api/corpus');
  const pubs = documents.map((d) => d.pub_id);
  const perPub = new Map();
  for (const pub of pubs) {
    try {
      const track = await getJson(`/api/learn/track?pub=${encodeURIComponent(pub)}&learner=${LEARNER}`);
      perPub.set(pub, (track.sections || []).filter((s) => s.section).map((s) => [pub, s.section]));
    } catch {
      perPub.set(pub, []);
    }
  }
  // Round-robin across publications so the set spans the corpus.
  const order = [];
  for (let depth = 0; ; depth += 1) {
    let added = false;
    for (const pub of pubs) {
      const list = perPub.get(pub) || [];
      if (depth < list.length) {
        order.push(list[depth]);
        added = true;
      }
    }
    if (!added) break;
  }

  const rows = [];
  const seen = new Set();
  for (const [pub, section] of order) {
    if (rows.length >= target) break;
    let next;
    try {
      next = await getJson(
        `/api/learn/next?pub=${encodeURIComponent(pub)}&section=${encodeURIComponent(section)}&learner=${LEARNER}`,
      );
    } catch {
      continue;
    }
    const item = next?.item;
    if (!next?.available || next?.done || !item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    let graded;
    try {
      graded = await postJson('/api/learn/answer', {
        item_id: item.id,
        answer: '(calibration probe)',
        confidence: 1,
        learner: LEARNER,
      });
    } catch {
      continue;
    }
    if (!graded?.source_text || !graded?.citation) continue;
    rows.push({
      item_id: item.id,
      question: item.question,
      pub_id: item.pub_id,
      chapter: item.chapter,
      chapter_title: item.chapter_title,
      section: item.section,
      source_text: graded.source_text,
      citation: graded.citation,
      key_points: graded.key_points || [],
    });
    console.log(`[answerable ${rows.length}/${target}] ${item.pub_id} :: ${graded.citation.slice(0, 60)}`);
  }
  return rows;
}

/** Keep only candidates the live index genuinely cannot answer. */
async function verifyUnanswerable() {
  const kept = [];
  const dropped = [];
  for (const candidate of UNANSWERABLE_CANDIDATES) {
    let asked;
    try {
      asked = await postJson('/api/ask', { question: candidate.question });
    } catch (error) {
      console.log(`[unanswerable ?] ${candidate.id}: ask failed (${error.message}) -- dropped`);
      dropped.push({ ...candidate, reason: `ask_failed: ${error.message}` });
      continue;
    }
    const record = {
      ...candidate,
      anchor_ask: {
        abstained: asked.abstained === true,
        abstain_reason: asked.abstain_reason ?? null,
        top_rerank_score: asked.top_rerank_score ?? null,
        top_effective_score: asked.top_effective_score ?? null,
      },
    };
    if (asked.abstained === true) {
      kept.push(record);
      console.log(`[unanswerable KEEP] ${candidate.id} (rerank ${asked.top_rerank_score?.toFixed?.(2)})`);
    } else {
      // Anchor answered it, so the corpus covers it. Relabelling this as
      // "should refuse" would poison the negative class.
      dropped.push({ ...record, reason: 'anchor_answered' });
      console.log(`[unanswerable DROP] ${candidate.id} -- Anchor answered it (${asked.citations?.[0]?.citation || 'cited'})`);
    }
  }
  return { kept, dropped };
}

const target = Number(arg('--target') || 36);
const answerableFrom = arg('--answerable-from');

const health = await getJson('/api/health', 10_000);
if (!health?.ok) throw new Error(`Anchor is not healthy: ${JSON.stringify(health)}`);
const corpus = await getJson('/api/corpus');
console.log(`Anchor ${BASE} ok; ${corpus.total_chunks} chunks / ${corpus.documents.length} publications`);

const answerable = answerableFrom
  ? JSON.parse(await readFile(resolve(process.cwd(), answerableFrom), 'utf8'))
  : await harvestAnswerable(target);
console.log(`answerable: ${answerable.length}`);

const { kept: unanswerable, dropped } = await verifyUnanswerable();
console.log(`unanswerable kept: ${unanswerable.length}, dropped: ${dropped.length}`);

const fixture = {
  contract: 'schoolcircle-grounding-v1',
  generated_utc: new Date().toISOString(),
  anchor: {
    base_url: BASE,
    total_chunks: corpus.total_chunks,
    publications: corpus.documents.map((d) => d.pub_id),
    index_meta: corpus.index_meta ?? null,
  },
  provenance: {
    answerable:
      "Anchor recall items. Each question was generated from an indexed chunk; source_text is that chunk verbatim and citation is its paragraph locator, both returned by POST /api/learn/answer. Ground truth is therefore held, not assumed.",
    unanswerable:
      'Candidates put to POST /api/ask over the full index; only questions Anchor itself abstained on are kept. Candidates Anchor could answer were dropped, not relabelled.',
  },
  answerable,
  unanswerable,
  dropped_unanswerable: dropped,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(fixture, null, 1)}\n`, 'utf8');
console.log(`wrote ${OUT}`);
