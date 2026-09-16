// Rubricon and Whetstone must run on the SHARED model alone. These tests configure
// only MODEL_BASE_URL/MODEL_ID/MODEL_API_KEY -- no RUBRICON_* or WHETSTONE_* -- and
// stub the shared endpoint, so a regression back to a per-helper endpoint trio fails
// here rather than at a demo.
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateRubric, startMasterySession } from '../lib/arsenal-core.js';

const SHARED_ENV = {
  MODEL_BASE_URL: 'http://127.0.0.1:9911/v1',
  MODEL_ID: 'shared-test-model',
  MODEL_API_KEY: 'shared-test-key',
};

const LEGACY_KEYS = [
  'RUBRICON_ENDPOINT',
  'RUBRICON_MODEL',
  'RUBRICON_API_KEY',
  'WHETSTONE_ENDPOINT',
  'WHETSTONE_MODEL',
  'WHETSTONE_API_KEY',
  'OPENROUTER_API_KEY',
];

/** Run `fn` with only the shared model configured and every legacy var removed. */
async function withSharedModelOnly(replies, fn) {
  const envKeys = [...Object.keys(SHARED_ENV), ...LEGACY_KEYS];
  const previous = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const calls = [];
  let i = 0;
  try {
    for (const [k, v] of Object.entries(SHARED_ENV)) process.env[k] = v;
    for (const k of LEGACY_KEYS) delete process.env[k];

    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      const payload = replies[Math.min(i++, replies.length - 1)];
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of envKeys) {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    }
  }
}

const STANDARD_TEXT =
  'Condition: Given a rifle on a known-distance range. ' +
  'Standard: The Marine engages each target from the prone position and confirms a safe weapon.';

const TASK = {
  code: 'TEST.01',
  title: 'Engage targets from the prone position',
  condition: 'Given a rifle on a known-distance range.',
  standard:
    'The Marine engages each target from the prone position and confirms a safe weapon.',
};

test('Rubricon generates a rubric on the shared model with no RUBRICON_* configured', async () => {
  const rubric = {
    flagged: false,
    dimensions: [
      {
        name: 'Firing position',
        source: 'engages each target from the prone position',
        anchors: {
          unsatisfactory: 'Does not assume the prone position before engaging.',
          satisfactory: 'Assumes the prone position before engaging each target.',
          proficient: 'Assumes and holds a stable prone position for every target.',
        },
      },
      {
        name: 'Weapon safety',
        source: 'confirms a safe weapon',
        anchors: {
          unsatisfactory: 'Leaves the weapon unconfirmed at the end of the string.',
          satisfactory: 'Confirms a safe weapon at the end of the string.',
          proficient: 'Confirms a safe weapon without prompting on every string.',
        },
      },
    ],
  };

  const result = await withSharedModelOnly([rubric], async (calls) => {
    const out = await generateRubric({ task: TASK, sourceText: STANDARD_TEXT });
    // It must have gone to the SHARED endpoint, not a per-helper one.
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.startsWith('http://127.0.0.1:9911/v1/chat/completions'),
      `expected the shared endpoint, got ${calls[0].url}`,
    );
    assert.equal(calls[0].body.model, 'shared-test-model');
    return out;
  });

  assert.equal(result.rubric.dimensions.length, 2);
  assert.deepEqual(result.rubric.task, { code: 'TEST.01', title: TASK.title });
  // Rubricon's own guarantees still run and still pass.
  assert.equal(result.validation.valid, true);
  assert.equal(result.traceability.grounded, true);
});

test('Rubricon preserves flag-don-t-guess: a vague standard returns needsSME, not invented criteria', async () => {
  const flagged = {
    flagged: true,
    reason: 'The standard is subjective and yields no observable anchors.',
    needsSME: 'Define what an acceptable engagement looks like to an evaluator.',
  };

  const result = await withSharedModelOnly([flagged], () =>
    generateRubric({
      task: { code: 'TEST.02', title: 'Perform well', standard: 'The Marine performs well.' },
      sourceText: 'Standard: The Marine performs well.',
    }),
  );

  assert.equal(result.rubric.flagged, true);
  assert.equal(result.rubric.needsSME, flagged.needsSME);
  assert.equal(result.rubric.dimensions, undefined, 'must not invent dimensions');
});

test('Rubricon rejects malformed model output rather than returning a bad rubric', async () => {
  await assert.rejects(
    () =>
      withSharedModelOnly([{ dimensions: [{ name: 'No anchors here' }] }], () =>
        generateRubric({ task: TASK, sourceText: STANDARD_TEXT }),
      ),
    (error) => {
      assert.equal(error.code, 'RUBRICON_UNAVAILABLE');
      return true;
    },
  );
});

test('Whetstone starts a mastery session on the shared model with no WHETSTONE_* configured', async () => {
  const replies = [
    {
      criteria: [
        {
          elo: 'Assume the prone position',
          indicators: {
            developing: 'Names the position.',
            competent: 'Describes assuming it.',
            mastered: 'Explains when and why it is used.',
          },
        },
      ],
    },
    { question: 'When do you assume the prone position on this range?' },
  ];

  const { session, question, calls } = await withSharedModelOnly(replies, async (calls) => {
    const started = await startMasterySession({
      objectives: 'Assume the prone position',
      source: STANDARD_TEXT,
    });
    return { ...started, calls };
  });

  assert.ok(Array.isArray(session.criteria) && session.criteria.length === 1);
  assert.equal(session.criteria[0].elo, 'Assume the prone position');
  assert.equal(typeof question, 'string');
  assert.ok(question.length > 0);
  // Rubric derivation + first question, both over the shared endpoint.
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(call.url.startsWith('http://127.0.0.1:9911/v1/chat/completions'));
    assert.equal(call.body.model, 'shared-test-model');
  }
});
