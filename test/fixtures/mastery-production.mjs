// Run in a child process with fixture-only environment variables. No live I/O.
import assert from 'node:assert/strict';

const criteria = [
  { elo: 'Name the check', indicators: { developing: 'a', competent: 'b', mastered: 'c' } },
  { elo: 'Explain the timing', indicators: { developing: 'a', competent: 'b', mastered: 'c' } },
];
let replies = [];
const requests = [];
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://whetstone.invalid/chat/completions');
  // Two real transports reach this URL: upstream Whetstone's own fetch (negative
  // control below, header `Authorization`, WHETSTONE_API_KEY) and the shared model
  // adapter that now drives production (header `authorization`, MODEL_API_KEY).
  // Both must present a fixture bearer token; neither may call unauthenticated.
  const authorization = init.headers.Authorization ?? init.headers.authorization;
  assert.equal(authorization, 'Bearer fixture-not-a-credential');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'fixture-model');
  requests.push(body);
  assert.ok(replies.length, 'unexpected model request');
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(replies.shift()) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// Import after installing the transport mock. Session, scoreTurn, rubric
// derivation, firstQuestion and the adapter's default loader remain real.
const w = await import('whetstone');
const {
  startMasterySession, restoreMasterySession, serialiseMasterySession,
} = await import('../../lib/arsenal-core.js');
const mastered = { verdict: 'mastered', feedback: 'Correct.', followup: '' };
const input = { objectives: 'Explain the safety check', source: 'Check before startup.', maxTurns: 8 };
const queueStart = (rows) => {
  replies.push({ criteria: rows }, { question: 'What is the check?' });
};
const savedRoundTrip = (session) =>
  JSON.parse(JSON.stringify(serialiseMasterySession(session, 'fixture-source', input.objectives)));

// Negative control: call the actual pinned scoreTurn, not a handwritten scorer.
queueStart(criteria);
const raw = new w.Session(input);
await raw.start();
replies.push(mastered, { question: 'When is it checked?' });
await raw.answer('Name the check.');
const before = JSON.stringify({ transcript: raw.transcript, results: raw.results, eloIndex: raw.eloIndex });
replies.push(mastered);
await assert.rejects(() => raw.answer('Before startup.'), /inconsistent with nextEloIndex/);
assert.equal(raw.complete, false);
assert.equal(JSON.stringify({ transcript: raw.transcript, results: raw.results, eloIndex: raw.eloIndex }), before);

// No `ask`, `load`, Session factory or scorer override: this is the app's
// production start -> serialize -> restore -> answer -> serialize path.
queueStart(criteria);
const started = await startMasterySession(input);
replies.push(mastered, { question: 'When is it checked?' });
assert.equal((await started.session.answer('Name the check.')).complete, false);
const state = savedRoundTrip(started.session);
assert.equal(state.eloIndex, 1);
assert.equal(state.complete, false);
const callsBeforeRestore = requests.length;
const restored = await restoreMasterySession(state);
assert.equal(requests.length, callsBeforeRestore, 'restore must not generate again');
assert.deepEqual(restored.criteria, criteria);
assert.equal(restored.eloIndex, 1);
replies.push(mastered);
const terminal = await restored.answer('Before startup.');
assert.equal(terminal.complete, true);
assert.equal(terminal.nextEloIndex, criteria.length);
assert.equal(restored.currentQuestion, null);
const completed = savedRoundTrip(restored);
assert.equal(completed.complete, true);
assert.equal(completed.eloIndex, criteria.length);
assert.ok(completed.criteria.every(c => c.verdict === 'mastered'));
const reloaded = await restoreMasterySession(completed);
assert.equal(reloaded.complete, true);
assert.equal(reloaded.report().complete, true);
const callsBeforeCompleteAnswer = requests.length;
assert.equal((await reloaded.answer('Already done.')).complete, true);
assert.equal(requests.length, callsBeforeCompleteAnswer);

// Also protect the start wiring: single-criterion completion without restore.
queueStart(criteria.slice(0, 1));
const single = await startMasterySession(input);
replies.push(mastered);
assert.equal((await single.session.answer('Check before startup.')).complete, true);
assert.equal(single.session.eloIndex, 1);
assert.equal(replies.length, 0);
assert.ok(requests.some(r => r.messages[0].content.includes('You assess a learner')));
console.log('Real pinned scorer reproduced; default start/restore completion and serialized reload passed.');