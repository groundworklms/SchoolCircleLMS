import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The polling loop lives in a React hook, and what is worth testing about it is
 * not React: it is that a failed poll does not end the loop. Extracting the
 * loop to test it would mean two copies of it, so the source is read and the
 * properties that matter are asserted against it.
 *
 * This is a weaker test than calling the function, and it is here because the
 * defect it guards was shipped: the first version threw on the first failed
 * poll, and a live generation reported a lost connection while the job behind
 * it was running perfectly well. Polling is also what keeps the server
 * instance handling requests, so a loop that ends can stall the work it is
 * watching.
 */
const source = readFileSync(new URL('../app/_learning/useLearning.js', import.meta.url), 'utf8');
const follow = source.slice(source.indexOf('const follow = async'), source.indexOf('return { start, follow, loading }'));

test('a failed poll is retried rather than thrown', () => {
  assert.match(follow, /missed \+= 1/, 'a failure is counted');
  assert.match(follow, /continue;/, 'and the loop goes round again');
  assert.match(follow, /MAX_MISSED_POLLS/, 'only a run of them gives up');
  assert.doesNotMatch(
    follow,
    /if \(!res\.ok\) throw/,
    'a single non-ok response must not end the loop',
  );
});

test('a missing job is believed at once, because asking again cannot produce it', () => {
  assert.match(follow, /res\.status === 404/);
  assert.match(follow, /JOB_NOT_FOUND/);
});

test('a successful poll clears the run of failures', () => {
  assert.match(follow, /missed = 0/, 'otherwise eight blips over twenty minutes end a healthy job');
});

test('giving up is reported as its own outcome, not as a failed generation', () => {
  assert.match(follow, /phase: 'unreachable'/);
  // The three real outcomes are still distinct from it.
  for (const phase of ['saved', 'failed', 'stalled']) {
    assert.match(follow, new RegExp(`phase: '${phase}'`), phase);
  }
});

test('the count is generous, because waiting costs one interval and the job is unaffected', () => {
  const limit = /const MAX_MISSED_POLLS = (\d+);/.exec(source);
  assert.ok(limit, 'the limit is named rather than inline');
  assert.ok(Number(limit[1]) >= 5, `a handful of blips must not end a job: got ${limit[1]}`);
});
