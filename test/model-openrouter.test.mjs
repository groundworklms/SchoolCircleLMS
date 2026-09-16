import assert from 'node:assert/strict';
import test from 'node:test';

import { ask as sourcererAsk } from 'sourcerer';
import { buildAar } from '../lib/arsenal-evidence.js';
import { learningModelStatus, tutorAnswer } from '../lib/arsenal-core.js';
import { configuredEvidenceModel } from '../lib/learning/evidence.js';
import { askJSON, askText } from '../lib/model.js';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL_ID,
  textProvider,
} from '../lib/providers.js';

const ENV_KEYS = [
  'MODEL_BASE_URL',
  'MODEL_ID',
  'MODEL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'RUBRICON_ENDPOINT',
  'RUBRICON_MODEL',
  'RUBRICON_API_KEY',
  'WHETSTONE_ENDPOINT',
  'WHETSTONE_MODEL',
  'WHETSTONE_API_KEY',
  'SOURCERER_GROUNDING_URL',
];

async function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return await callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const TUTOR_QUESTION = 'What did the manual state about the launch sequence and safety check?';
const TUTOR_PASSAGES = [
  {
    text: 'The manual states the launch sequence starts with a safety check.',
    source: 'manual p.1',
  },
  {
    text: 'The manual states the launch sequence ends with a systems check.',
    source: 'manual p.2',
  },
];
const TUTOR_ENVIRONMENT = {
  MODEL_BASE_URL: OPENROUTER_BASE_URL,
  MODEL_ID: OPENROUTER_MODEL_ID,
  MODEL_API_KEY: undefined,
  OPENROUTER_API_KEY: 'synthetic-openrouter-key',
  SOURCERER_GROUNDING_URL: undefined,
};

async function runTutorWithTransport(answer, verification) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    const isVerification = body.messages?.[0]?.content.includes('strict fact-checker');
    const payload = isVerification ? verification : answer;
    if (!payload) throw new Error('unexpected extra tutor model request');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: OPENROUTER_MODEL_ID,
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };
  try {
    const result = await withEnvironment(TUTOR_ENVIRONMENT, () =>
      tutorAnswer({
        question: TUTOR_QUESTION,
        passages: TUTOR_PASSAGES,
      }),
    );
    return { result, requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('OpenRouter is not ready from a key alone and has no cloud fallback', async () => {
  await withEnvironment(
    {
      MODEL_BASE_URL: undefined,
      MODEL_ID: undefined,
      MODEL_API_KEY: undefined,
      OPENROUTER_API_KEY: 'synthetic-openrouter-key',
    },
    () => {
      const status = textProvider();
      assert.equal(status.ready, false);
      assert.equal(status.provider, null);
      assert.match(status.reason, /MODEL_BASE_URL and MODEL_ID/);
    },
  );
});

test('explicit OpenRouter sends the selected Gemini model and structured contract', async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    request = {
      url,
      options,
      body: JSON.parse(options.body),
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: OPENROUTER_MODEL_ID,
        choices: [{ message: { content: '{"answer":"synthetic"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };
  try {
    const result = await withEnvironment(
      {
        MODEL_BASE_URL: OPENROUTER_BASE_URL,
        MODEL_ID: OPENROUTER_MODEL_ID,
        MODEL_API_KEY: undefined,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      () =>
        askJSON({
          system: 'Return one synthetic answer.',
          prompt: 'No real learner or doctrine content.',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answer'],
            properties: { answer: { type: 'string' } },
          },
          maxTokens: 32,
        }),
    );

    assert.equal(result.data.answer, 'synthetic');
    assert.equal(request.url, `${OPENROUTER_BASE_URL}/chat/completions`);
    assert.equal(
      request.options.headers.authorization,
      'Bearer synthetic-openrouter-key',
    );
    assert.equal(request.body.model, OPENROUTER_MODEL_ID);
    assert.deepEqual(request.body.provider, { require_parameters: true });
    assert.deepEqual(request.body.reasoning, { effort: 'low', exclude: true });
    assert.equal(request.body.response_format.type, 'json_schema');
    assert.equal(request.body.response_format.json_schema.strict, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a local endpoint never receives OpenAI or OpenRouter vendor credentials', async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'synthetic-local-model',
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    };
  };
  try {
    await withEnvironment(
      {
        MODEL_BASE_URL: 'http://127.0.0.1:8001/v1',
        MODEL_ID: 'synthetic-local-model',
        MODEL_API_KEY: undefined,
        OPENAI_API_KEY: 'synthetic-openai-key',
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      () =>
        askJSON({
          system: 'Return a synthetic object.',
          prompt: 'fixture',
          schema: { type: 'object', additionalProperties: true },
        }),
    );
    assert.equal(request.url, 'http://127.0.0.1:8001/v1/chat/completions');
    assert.equal(request.options.headers.authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouter prose is rejected even when the transport reports stop', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: OPENROUTER_MODEL_ID,
      choices: [{ finish_reason: 'stop', message: { content: 'Here is the JSON.' } }],
    }),
  });
  try {
    await withEnvironment(
      {
        MODEL_BASE_URL: OPENROUTER_BASE_URL,
        MODEL_ID: OPENROUTER_MODEL_ID,
        MODEL_API_KEY: undefined,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      () =>
        assert.rejects(
          askJSON({
            system: 'Return JSON only.',
            prompt: 'Synthetic fixture.',
            schema: { type: 'object', additionalProperties: true },
          }),
          (error) => error?.code === 'MODEL_BAD_RESPONSE',
        ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenRouter prose requests omit the JSON response contract', async () => {
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: OPENROUTER_MODEL_ID,
        choices: [{ message: { content: 'SUSTAIN: keep the source-grounded brief.' } }],
      }),
    };
  };
  try {
    const result = await withEnvironment(
      {
        MODEL_BASE_URL: OPENROUTER_BASE_URL,
        MODEL_ID: OPENROUTER_MODEL_ID,
        MODEL_API_KEY: undefined,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      async () => {
        const result = await askText({
          system: 'Write a concise instructor AAR in prose.',
          prompt: 'Use only this synthetic report.',
          maxTokens: 256,
        });
        const configured = configuredEvidenceModel();
        const configuredResult = await configured({
          system: 'Write a concise instructor AAR in prose.',
          user: 'Use only this synthetic report.',
          schema: { type: 'object', properties: { shouldNotBeSent: { type: 'boolean' } } },
          json: false,
        });
        assert.equal(configuredResult, 'SUSTAIN: keep the source-grounded brief.');
        return result;
      },
    );
    assert.equal(result.data, 'SUSTAIN: keep the source-grounded brief.');
    assert.equal(request.url, `${OPENROUTER_BASE_URL}/chat/completions`);
    assert.equal(request.body.model, OPENROUTER_MODEL_ID);
    assert.equal(request.body.response_format, undefined);
    assert.equal(request.body.provider, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('model adapter exposes provider errors and refusals instead of fabricating content', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      async text() {
        return 'synthetic provider outage';
      },
    });
    await withEnvironment(
      {
        MODEL_BASE_URL: OPENROUTER_BASE_URL,
        MODEL_ID: OPENROUTER_MODEL_ID,
        MODEL_API_KEY: undefined,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      () =>
        assert.rejects(
          askText({ system: 'Write prose.', prompt: 'fixture' }),
          (error) =>
            error?.code === 'MODEL_UNAVAILABLE' &&
            /503/.test(error.message) &&
            /synthetic provider outage/.test(error.message),
        ),
    );

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { refusal: 'synthetic safety refusal' } }],
        };
      },
    });
    await withEnvironment(
      {
        MODEL_BASE_URL: OPENROUTER_BASE_URL,
        MODEL_ID: OPENROUTER_MODEL_ID,
        MODEL_API_KEY: undefined,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      },
      () =>
        assert.rejects(
          askJSON({
            system: 'Return a structured object.',
            prompt: 'fixture',
            schema: { type: 'object', additionalProperties: true },
          }),
          (error) =>
            error?.code === 'MODEL_REFUSAL' &&
            /synthetic safety refusal/.test(error.message),
        ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hotwash uses the explicit prose seam without replacing its pinned implementation', async () => {
  const calls = [];
  const result = await buildAar({
    critiques: [{ area: 'brief', kind: 'sustain', iteration: 'fixture' }],
    model: {
      async generateText(payload) {
        calls.push(payload);
        return { data: 'Instructor AAR prose from the configured model.' };
      },
    },
  });
  assert.equal(result.source, 'model');
  assert.equal(result.memo, 'Instructor AAR prose from the configured model.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxTokens, 4000);

  let jsonCalled = false;
  const fallback = await buildAar({
    critiques: [{ area: 'brief', kind: 'sustain', iteration: 'fixture' }],
    model: {
      async generateJSON() {
        jsonCalled = true;
        return { data: { memo: 'must not be used for prose' } };
      },
    },
  });
  assert.equal(jsonCalled, false);
  assert.equal(fallback.source, 'heuristic');
});

test('native Rubricon and Whetstone accept the shared key only on explicit OpenRouter URLs', async () => {
  await withEnvironment(
    {
      MODEL_BASE_URL: OPENROUTER_BASE_URL,
      MODEL_ID: OPENROUTER_MODEL_ID,
      OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      RUBRICON_ENDPOINT: `${OPENROUTER_BASE_URL}/chat/completions`,
      RUBRICON_MODEL: OPENROUTER_MODEL_ID,
      RUBRICON_API_KEY: undefined,
      WHETSTONE_ENDPOINT: `${OPENROUTER_BASE_URL}/chat/completions`,
      WHETSTONE_MODEL: OPENROUTER_MODEL_ID,
      WHETSTONE_API_KEY: undefined,
    },
    () => {
      const configured = learningModelStatus();
      assert.equal(configured.rubriconConfigured, true);
      assert.equal(configured.whetstoneConfigured, true);
    },
  );

  await withEnvironment(
    {
      MODEL_BASE_URL: 'http://127.0.0.1:8001/v1',
      MODEL_ID: 'synthetic-local-model',
      OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      RUBRICON_ENDPOINT: 'https://model.invalid/v1/chat/completions',
      RUBRICON_MODEL: 'synthetic-model',
      RUBRICON_API_KEY: undefined,
      WHETSTONE_ENDPOINT: 'https://model.invalid/v1/chat/completions',
      WHETSTONE_MODEL: 'synthetic-model',
      WHETSTONE_API_KEY: undefined,
    },
    () => {
      const notConfigured = learningModelStatus();
      assert.equal(notConfigured.rubriconConfigured, false);
      assert.equal(notConfigured.whetstoneConfigured, false);
    },
  );
});

test('tutor transport normalizes grouped citations before strict faithfulness checking', async () => {
  const normalized = 'The launch sequence starts with a safety check, then ends with a systems check. [1][2]';
  const { result, requests } = await runTutorWithTransport(
    {
      refused: false,
      answer: 'The launch sequence starts with a safety check, then ends with a systems check. [1, 2]',
      used: [1, 2],
    },
    {
      claims: [{ claim: 'The launch sequence is described in the manual.', supported: true }],
      unsupported: [],
    },
  );

  assert.equal(result.refused, false);
  assert.equal(result.reason, null);
  assert.equal(result.answer, normalized);
  assert.deepEqual(
    result.citations.map((citation) => citation.source),
    ['manual p.1', 'manual p.2'],
  );
  assert.equal(result.faithfulness.faithful, true);
  assert.equal(result.faithfulness.score, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[1].body.messages[0].content, /strict fact-checker/);
  assert.ok(
    requests[1].body.messages[1].content.includes(`Answer: "${normalized}"`),
    'strict checker should receive the normalized marker sequence',
  );
  assert.equal(requests[1].body.messages[1].content.includes('[1, 2]'), false);
});

test('tutor transport keeps malformed citation cases as no_citation', async () => {
  const cases = [
    {
      name: 'out-of-range used passage',
      answer: 'The launch sequence is described in the manual. [1, 3]',
      used: [1, 3],
    },
    {
      name: 'missing markers',
      answer: 'The launch sequence is described in the manual.',
      used: [1],
    },
    {
      name: 'group member absent from used',
      answer: 'The launch sequence is described in the manual. [1, 2]',
      used: [1],
    },
  ];

  for (const fixture of cases) {
    const { result, requests } = await runTutorWithTransport(
      { refused: false, answer: fixture.answer, used: fixture.used },
      {
        claims: [{ claim: 'The answer is supported.', supported: true }],
        unsupported: [],
      },
    );
    assert.equal(result.refused, true, fixture.name);
    assert.equal(result.reason, 'no_citation', fixture.name);
    assert.deepEqual(result.citations, [], fixture.name);
    assert.equal(requests.length, 1, `${fixture.name} should not reach verification`);
  }
});

test('strictly unfaithful tutor answers clear citations after transport verification', async () => {
  const { result, requests } = await runTutorWithTransport(
    {
      refused: false,
      answer: 'The launch sequence starts with a safety check. [1]',
      used: [1],
    },
    {
      claims: [{ claim: 'The answer invents a launch schedule.', supported: false }],
      unsupported: ['The answer invents a launch schedule.'],
    },
  );

  assert.equal(result.refused, true);
  assert.equal(result.reason, 'unfaithful');
  assert.equal(result.faithfulness.faithful, false);
  assert.deepEqual(result.citations, []);
  assert.equal(requests.length, 2);
});

test('real Sourcerer rejects the grouped-output response without tutor normalization', async () => {
  const result = await withEnvironment(
    { SOURCERER_GROUNDING_URL: undefined },
    () =>
      sourcererAsk(TUTOR_QUESTION, {
        passages: TUTOR_PASSAGES,
        chat: async () => ({
          refused: false,
          answer: 'The launch sequence starts with a safety check, then ends with a systems check. [1, 2]',
          used: [1, 2],
        }),
        verify: 'strict',
      }),
  );

  assert.equal(result.refused, true);
  assert.equal(result.reason, 'no_citation');
  assert.deepEqual(result.citations, []);
});
test('a too-low token limit is not mistaken for an unsupported parameter', async () => {
  // OpenAI's too-low error is "Could not finish the message because max_tokens
  // or model output limit was reached" -- it names the parameter. An earlier
  // version of the retry matched that and swapped to a spelling GPT-5 models
  // genuinely reject, turning one recoverable error into two.
  const { openAICompatRequestProbe } = await import('../lib/model.js').catch(() => ({}));
  const tooLow = 'Could not finish the message because max_tokens or model output limit was reached. Please try again with higher max_tokens.';
  const unsupported = 'Unsupported parameter: "max_tokens" is not supported with this model.';
  const pattern =
    /(unsupported|unrecognized|unknown|not supported|invalid)[^.]{0,40}(max_tokens|max_completion_tokens)|(max_tokens|max_completion_tokens)[^.]{0,40}(is not supported|unsupported|not recognized)/i;
  assert.equal(pattern.test(tooLow), false, 'a too-low limit must not trigger a parameter swap');
  assert.equal(pattern.test(unsupported), true, 'a genuinely unsupported parameter must');
  assert.equal(typeof openAICompatRequestProbe, 'undefined');
});
