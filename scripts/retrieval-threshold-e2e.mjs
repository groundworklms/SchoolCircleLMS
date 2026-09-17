/*
 * End-to-end safety run for the retrieval floor, on real hardware.
 *
 * The minScore sweep (retrieval-threshold-calibrate.mjs) measures gate 2 in
 * isolation, but "past gate 2" is not "answered": a question that clears the
 * floor still has to survive strict cite-or-refuse in Sourcerer, the citation
 * set-equality check in `citedPassages`, and Understudy's grounding and
 * in-doctrine verdict. This script measures the END STATE by calling the real
 * `groundedStudentAnswer` against the live Anchor and the live on-device model.
 *
 * Why minScore=0 is the decisive test
 * -----------------------------------
 * The gate is `topScore < minScore`, so it is monotone: lowering minScore only
 * ever lets MORE through. minScore=0 makes gate 2 inert (coverage scores are
 * never negative). If no unanswerable question can produce an answer at
 * minScore=0, then none can at any higher value -- so this single run bounds
 * the false-answer rate for every threshold in the sweep.
 *
 * Usage (Anchor and the on-device model must both be reachable):
 *   node scripts/retrieval-threshold-e2e.mjs                  # unanswerable set at minScore 0
 *   node scripts/retrieval-threshold-e2e.mjs --class answerable --limit 8
 *   node scripts/retrieval-threshold-e2e.mjs --min-score 0.2
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '../test/fixtures/retrieval-threshold-corpus.json');
const ANCHOR = (process.env.ANCHOR_BASE_URL || 'http://192.168.55.1:8000').replace(/\/+$/, '');
const MODEL_BASE = process.env.STUDENT_LOCAL_BASE_URL || 'http://192.168.55.1:8080/v1';
const MODEL_ID = process.env.STUDENT_LOCAL_MODEL_ID || '/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf';
const POOL_SIZE = 16;

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const klass = arg('--class', 'unanswerable');
const limit = Number(arg('--limit', '0')) || 0;
const minScore = arg('--min-score', '0');

// Configure the local student model path before importing the pipeline.
process.env.STUDENT_LOCAL_BASE_URL = MODEL_BASE;
process.env.STUDENT_LOCAL_MODEL_ID = MODEL_ID;
process.env.SOURCERER_MIN_SCORE = String(minScore);
delete process.env.SOURCERER_GROUNDING_URL;

const { setStoredDoctrineBaseUrl } = await import('../lib/doctrine.js');
const { groundedStudentAnswer } = await import('../lib/student-grounding.js');
const { studentModelStatus } = await import('../lib/student-model.js');
setStoredDoctrineBaseUrl(ANCHOR);

// Report the model the pipeline actually resolved before spending a run on it.
// An unreachable or misnamed local model surfaces as STUDENT_LOCAL_MODEL_UNAVAILABLE
// on every case, which reads exactly like a refusal unless it is stated here.
const modelStatus = await studentModelStatus();
console.log(
  `resolved student model: ready=${modelStatus.ready} path=${modelStatus.path} model=${modelStatus.model}${modelStatus.code ? ` code=${modelStatus.code}` : ''}`,
);

const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
const chunks = fixture.answerable.map((row, index) => ({
  id: `chunk-${index}`,
  text: row.source_text,
  source: row.citation,
  pub_id: row.pub_id,
}));

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
  for (let step = 0; pool.length < POOL_SIZE && step < chunks.length; step += 1) {
    const candidate = chunks[(seed + step) % chunks.length];
    if (!pool.some((p) => p.id === candidate.id)) pool.push(candidate);
  }
  return pool.map(({ id, text, source }) => ({ id, text, source }));
}

const cases =
  klass === 'answerable'
    ? fixture.answerable.map((row, index) => ({
        id: row.item_id,
        question: row.question,
        pool: poolFor(index, index),
      }))
    : fixture.unanswerable.map((row, index) => ({
        id: row.id,
        question: row.question,
        pool: poolFor(null, index * 3),
      }));

const only = arg('--only');
const filtered = only ? cases.filter((testCase) => testCase.id === only) : cases;
if (only && filtered.length === 0) {
  console.error(`--only ${only} matched nothing in the ${klass} set`);
  process.exit(2);
}
const selected = limit ? filtered.slice(0, limit) : filtered;
console.log(
  `e2e ${klass}: ${selected.length} cases, SOURCERER_MIN_SCORE=${minScore}\nAnchor ${ANCHOR}\nmodel  ${MODEL_BASE} (${MODEL_ID})\n`,
);

const results = [];
for (const [index, testCase] of selected.entries()) {
  let outcome;
  try {
    const answer = await groundedStudentAnswer(
      { question: testCase.question, passages: testCase.pool, history: [] },
      { initialModelPath: 'local' },
    );
    const citations = Array.isArray(answer?.citations) ? answer.citations : [];
    outcome = {
      id: testCase.id,
      refused: answer?.refused === true,
      reason: answer?.reason ?? null,
      citationCount: citations.length,
      // The property that must never break: an answer carries at least one citation.
      uncitedAnswer: answer?.refused !== true && citations.length === 0,
      anchorStage: answer?.stages?.anchor?.status ?? null,
      sourcererStage: answer?.stages?.sourcerer?.status ?? null,
      sourcererReason: answer?.stages?.sourcerer?.reason ?? null,
      understudyStage: answer?.stages?.understudy?.status ?? null,
      answerPreview: typeof answer?.answer === 'string' ? answer.answer.slice(0, 120) : null,
    };
  } catch (error) {
    // A transport/deadline failure is not an answer, so it cannot be a false
    // answer -- but it is not evidence of a correct refusal either. Recorded
    // distinctly so the report never counts it as a pass.
    outcome = {
      id: testCase.id,
      refused: null,
      error: error?.code || error?.message || String(error),
      stage: error?.stage ?? null,
      uncitedAnswer: false,
    };
  }
  results.push(outcome);
  console.log(
    `[${index + 1}/${selected.length}] ${testCase.id}: ${
      outcome.error
        ? `ERROR ${outcome.error}`
        : `${outcome.refused ? 'refused' : 'ANSWERED'} reason=${outcome.reason} cites=${outcome.citationCount} anchor=${outcome.anchorStage} sourcerer=${outcome.sourcererReason ?? outcome.sourcererStage} understudy=${outcome.understudyStage}`
    }`,
  );
}

const answered = results.filter((r) => r.refused === false);
const refused = results.filter((r) => r.refused === true);
const errored = results.filter((r) => r.refused === null);
const uncited = results.filter((r) => r.uncitedAnswer);

console.log(`\n=== ${klass} @ minScore=${minScore} ===`);
console.log(`answered: ${answered.length}  refused: ${refused.length}  errored/inconclusive: ${errored.length}`);
console.log(`UNCITED ANSWERS (must be 0): ${uncited.length}`);
if (klass === 'unanswerable') {
  console.log(
    answered.length === 0
      ? 'PASS: no unanswerable question produced an answer at the most permissive floor.'
      : `FAIL: ${answered.length} unanswerable question(s) were answered: ${answered.map((r) => r.id).join(', ')}`,
  );
}

const outPath = arg('--json');
if (outPath) {
  await writeFile(
    resolve(process.cwd(), outPath),
    `${JSON.stringify({ klass, minScore, anchor: ANCHOR, model: MODEL_ID, measured_utc: new Date().toISOString(), results }, null, 1)}\n`,
    'utf8',
  );
  console.log(`wrote ${outPath}`);
}
