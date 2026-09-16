/*
 * The student tutor must use the Anchor address the operator set at runtime.
 *
 * `lib/doctrine.js` resolves the doctrine endpoint with precedence
 * setting -> environment -> unconfigured, and `lib/learning/http.js` primes the
 * stored setting on every request so an instructor can point the app at a
 * plugged-in Orin from Settings -> Doctrine engine without a redeploy.
 *
 * The tutor read `process.env.DOCTRINE_BASE_URL` directly instead. The effect
 * was quiet and bad: Settings reported the engine ready, and every learner
 * question came back "Grounded tutor service is unavailable" because Anchor was
 * never contacted. That is the exact scenario docs/orin-offline-config.md
 * describes, so it would have failed the moment anyone tried it.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { doctrineProvider, setStoredDoctrineBaseUrl } from '../lib/doctrine.js';
import { groundedStudentAnswer } from '../lib/student-grounding.js';

const PASSAGE = {
  id: 'p1',
  text: 'Sight alignment is the relationship between the front and rear sights.',
  source: 'MCRP 3-01A',
};

let savedEnv;

beforeEach(() => {
  savedEnv = process.env.DOCTRINE_BASE_URL;
  delete process.env.DOCTRINE_BASE_URL;
  setStoredDoctrineBaseUrl(null);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.DOCTRINE_BASE_URL;
  else process.env.DOCTRINE_BASE_URL = savedEnv;
  setStoredDoctrineBaseUrl(null);
});

/** Records the URL Anchor was asked for, then abstains so the run stops there. */
function recordingFetch(seen) {
  return async (url) => {
    seen.push(String(url));
    const body = { abstained: true, passages: [] };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

async function runTutor(fetchImpl) {
  return groundedStudentAnswer(
    { question: 'What is sight alignment?', passages: [PASSAGE], history: [] },
    {
      fetch: fetchImpl,
      initialModelPath: 'hosted',
      chat: async () => ({ answer: '', used: [] }),
    },
  ).catch((error) => ({ error }));
}

test('the tutor calls the Anchor address set at runtime, not only the env var', async () => {
  setStoredDoctrineBaseUrl('http://192.168.55.1:8000');
  assert.equal(doctrineProvider().source, 'setting', 'precondition: the setting is in force');

  const seen = [];
  await runTutor(recordingFetch(seen));

  assert.ok(seen.length > 0, 'Anchor was never contacted; the tutor ignored the runtime setting');
  assert.ok(
    seen[0].startsWith('http://192.168.55.1:8000'),
    `expected the operator's Anchor address, got ${seen[0]}`,
  );
});

test('the environment is still honoured when no setting has been made', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://anchor.internal:9000';
  assert.equal(doctrineProvider().source, 'env');

  const seen = [];
  await runTutor(recordingFetch(seen));

  assert.ok(seen.length > 0, 'Anchor was never contacted');
  assert.ok(seen[0].startsWith('http://anchor.internal:9000'), `got ${seen[0]}`);
});

test('a runtime setting overrides the environment, matching doctrineProvider precedence', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://stale.example:9000';
  setStoredDoctrineBaseUrl('http://192.168.55.1:8000');

  const seen = [];
  await runTutor(recordingFetch(seen));

  assert.ok(seen.length > 0, 'Anchor was never contacted');
  assert.ok(
    seen[0].startsWith('http://192.168.55.1:8000'),
    `the setting must win over the environment, got ${seen[0]}`,
  );
});

test('with nothing configured the tutor still refuses rather than calling anything', async () => {
  const seen = [];
  const result = await runTutor(recordingFetch(seen));

  assert.equal(seen.length, 0, 'nothing should be contacted when no endpoint is configured');
  assert.ok(result?.error, 'an unconfigured endpoint must surface an explicit error');
});
