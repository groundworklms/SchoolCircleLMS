import assert from 'node:assert/strict';
import test from 'node:test';

import { groundedStudentAnswer } from '../lib/student-grounding.js';

const passages = [
  { id: 'p-1', text: 'Learners complete the safety check before launch.', source: 'manual p. 1' },
  { id: 'p-2', text: 'The systems check follows launch.', source: 'manual p. 2' },
];

async function withDoctrine(callback) {
  const previous = process.env.DOCTRINE_BASE_URL;
  process.env.DOCTRINE_BASE_URL = 'http://anchor.test';
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.DOCTRINE_BASE_URL;
    else process.env.DOCTRINE_BASE_URL = previous;
  }
}

function anchor(payload) {
  return async (url, request) => {
    assert.equal(url, 'http://anchor.test/api/ground');
    assert.deepEqual(JSON.parse(request.body).passages, passages);
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
}

test('grounds the complete candidate through Anchor, strict Sourcerer, and Understudy', async () => {
  const seen = [];
  const chat = async (system, prompt) => {
    seen.push({ system, prompt });
    if (system.includes('strict fact-checker')) {
      return { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] };
    }
    if (system.includes('strict doctrine examiner')) {
      assert.match(prompt, /Agent response: Learners complete the safety check before launch\. \[1\]/);
      assert.match(prompt, /Learners complete the safety check before launch\./);
      return { verdict: 'in-doctrine', conforms: true, reasons: 'cited passage supports it' };
    }
    return {
      refused: false,
      answer: 'Learners complete the safety check before launch. [1]',
      used: [1],
    };
  };

  await withDoctrine(async () => {
    const result = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
        chat,
      },
    );
    assert.equal(result.refused, false);
    assert.deepEqual(result.citations, [passages[0]]);
    assert.equal(result.faithfulness.faithful, true);
    assert.equal(result.stages.sourcerer.faithfulness.faithful, true);
    assert.equal(result.stages.understudy.status, 'accepted');
    assert.deepEqual(result.stages.anchor, {
      status: 'grounded',
      authorizedCount: 2,
      selectedCount: 2,
    });
  });
  assert.equal(seen.length, 3);
});

test('locally ranks large authorized courses and chunks long source text before Anchor IO', async () => {
  const course = Array.from({ length: 20 }, (_, index) => ({
    id: `course-${index + 1}`,
    text: `Launch safety procedure ${index + 1}.`,
    source: `course p. ${index + 1}`,
  }));
  await withDoctrine(async () => {
    const result = await groundedStudentAnswer(
      { question: 'Which launch safety procedure applies?', passages: course },
      {
        fetch: async (_url, request) => {
          const input = JSON.parse(request.body);
          assert.equal(input.passages.length, 16);
          assert.ok(input.passages.every((passage) => Array.from(passage.text).length <= 8000));
          return {
            ok: true,
            text: async () => JSON.stringify({
              abstained: false,
              passages: input.passages,
              contract: 'schoolcircle-grounding-v1',
            }),
          };
        },
        chat: async (system) => {
          if (system.includes('strict fact-checker')) return { claims: [{ claim: 'Launch safety procedure.', supported: true }], unsupported: [] };
          if (system.includes('strict doctrine examiner')) return { verdict: 'in-doctrine', conforms: true };
          return { refused: false, answer: 'Launch safety procedure 1. [1]', used: [1] };
        },
      },
    );
    assert.equal(result.refused, false);
    assert.equal(result.stages.anchor.authorizedCount, 16);
    assert.equal('passages' in result.stages.anchor, false);

    const longText = `launch ${'safety '.repeat(2000)}`;
    const long = await groundedStudentAnswer(
      { question: 'launch', passages: [{ id: 'long', text: longText, source: 'long manual' }] },
      {
        fetch: async (_url, request) => {
          const input = JSON.parse(request.body);
          assert.equal(input.passages.length, 2);
          assert.ok(input.passages.every((passage) => Array.from(passage.text).length <= 8000));
          assert.ok(input.passages.every((passage) => passage.source === 'long manual'));
          assert.notEqual(input.passages[0].id, input.passages[1].id);
          assert.equal(input.passages.map((passage) => passage.text).join(''), longText);
          return {
            ok: true,
            text: async () => JSON.stringify({
              abstained: true,
              passages: [],
              contract: 'schoolcircle-grounding-v1',
            }),
          };
        },
      },
    );
    assert.equal(long.reason, 'anchor_abstained');
  });
});

test('enforces question, history, and Anchor-body limits before making IO', async () => {
  const noIo = { fetch: async () => assert.fail('must not make IO'), chat: async () => assert.fail('must not call model') };
  await withDoctrine(async () => {
    await assert.rejects(
      groundedStudentAnswer({ question: 'x'.repeat(2001), passages }, noIo),
      /question must not exceed 2000 characters/,
    );
    await assert.rejects(
      groundedStudentAnswer(
        {
          question: 'What happens?',
          passages,
          history: Array.from({ length: 25 }, () => ({ role: 'user', text: 'prior turn' })),
        },
        noIo,
      ),
      /history must contain no more than 24 turns/,
    );
    await assert.rejects(
      groundedStudentAnswer(
        {
          question: 'What happens?',
          passages: [{ id: 'oversize-source', text: 'supported text', source: 'x'.repeat(300000) }],
        },
        noIo,
      ),
      /authorized passage scope exceeds the Anchor request limit/,
    );
  });
});

test('passes bounded abort signals to Anchor and each of three model stages', async () => {
  await withDoctrine(async () => {
    let anchorSignal;
    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens?', passages },
        {
          timeoutMs: 1,
          fetch: async (_url, request) => {
            anchorSignal = request.signal;
            return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
          },
          chat: async () => assert.fail('chat must not run after Anchor timeout'),
        },
      ),
      (error) => error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' && error.stage === 'anchor',
    );
    assert.equal(anchorSignal.aborted, true);

    const modelSignals = [];
    const result = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
        chat: async (system, _prompt, options) => {
          modelSignals.push(options.signal);
          assert.equal(options.signal.aborted, false);
          if (system.includes('strict fact-checker')) return { claims: [{ claim: 'Safety check.', supported: true }], unsupported: [] };
          if (system.includes('strict doctrine examiner')) return { verdict: 'in-doctrine', conforms: true };
          return { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
        },
      },
    );
    assert.equal(result.refused, false);
    assert.equal(modelSignals.length, 3);
    assert.ok(modelSignals.every((signal) => typeof signal?.aborted === 'boolean'));
  });
});

test('treats Anchor abstention as a normal refusal and rejects forged provenance', async () => {
  await withDoctrine(async () => {
    const abstained = await groundedStudentAnswer(
      { question: 'What happens?', passages },
      {
        fetch: anchor({ abstained: true, passages: [], contract: 'schoolcircle-grounding-v1' }),
        chat: async () => assert.fail('chat must not run after abstention'),
      },
    );
    assert.equal(abstained.refused, true);
    assert.equal(abstained.reason, 'anchor_abstained');

    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens?', passages },
        {
          fetch: anchor({
            abstained: false,
            passages: [{ ...passages[0], text: 'forged' }],
            contract: 'schoolcircle-grounding-v1',
          }),
          chat: async () => ({}),
        },
      ),
      (error) => error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' && error.stage === 'anchor',
    );
  });
});

test('rejects malformed Anchor contracts, missing Anchor configuration, and passage scope overflow', async () => {
  await withDoctrine(async () => {
    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens?', passages },
        {
          fetch: anchor({ abstained: false, passages, contract: 'not-the-contract' }),
          chat: async () => ({}),
        },
      ),
      (error) => error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' && error.stage === 'anchor',
    );
    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens?', passages },
        {
          // Selecting an authorized passage twice expands the authorized
          // evidence scope and must not reach a model.
          fetch: anchor({
            abstained: false,
            passages: [passages[0], passages[1], passages[0]],
            contract: 'schoolcircle-grounding-v1',
          }),
          chat: async () => assert.fail('chat must not run after scope overflow'),
        },
      ),
      (error) => error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' && error.stage === 'anchor',
    );
  });

  const previous = process.env.DOCTRINE_BASE_URL;
  delete process.env.DOCTRINE_BASE_URL;
  try {
    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens?', passages },
        { fetch: async () => assert.fail('Anchor must not be called without configuration'), chat: async () => ({}) },
      ),
      (error) =>
        error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' &&
        error.stage === 'anchor' &&
        error.message === 'The grounded student-answer service is unavailable.',
    );
  } finally {
    if (previous !== undefined) process.env.DOCTRINE_BASE_URL = previous;
  }
});

test('does not deliver Sourcerer refusals or Understudy rejections', async () => {
  await withDoctrine(async () => {
    const refused = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
        chat: async () => ({ refused: true, answer: '', used: [] }),
      },
    );
    assert.equal(refused.reason, 'unsupported');

    const rejected = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
        chat: async (system) => {
          if (system.includes('strict fact-checker')) {
            return { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] };
          }
          if (system.includes('strict doctrine examiner')) {
            return { verdict: 'off-doctrine', conforms: false, reasons: 'rejected' };
          }
          return { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
        },
      },
    );
    assert.equal(rejected.refused, true);
    assert.equal(rejected.reason, 'understudy_rejected');
  });
});

test('turns model-provider and strict-verifier failures into sanitized stage errors', async () => {
  await withDoctrine(async () => {
    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens before launch?', passages },
        {
          fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
          chat: async () => ({ error: 'HTTP 503 at https://provider.example/private-detail' }),
        },
      ),
      (error) =>
        error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' &&
        error.stage === 'sourcerer' &&
        error.message === 'The grounded student-answer service is unavailable.' &&
        !/provider\.example/.test(error.message),
    );

    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens before launch?', passages },
        {
          fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
          chat: async (system) => {
            if (system.includes('strict fact-checker')) {
              return { error: 'strict verifier upstream outage' };
            }
            return { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
          },
        },
      ),
      (error) =>
        error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' &&
        error.stage === 'sourcerer_verify' &&
        error.message === 'The grounded student-answer service is unavailable.',
    );
  });
});

test('retries the entire Anchor-to-Understudy pipeline once local-only after hosted transport failure', async () => {
  const paths = [];
  let anchorCalls = 0;
  const localChat = async (system) => {
    paths.push('local');
    if (system.includes('strict fact-checker')) {
      return { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] };
    }
    if (system.includes('strict doctrine examiner')) return { verdict: 'in-doctrine', conforms: true };
    return { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
  };
  await withDoctrine(async () => {
    const result = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: async (_url, request) => {
          anchorCalls += 1;
          return {
            ok: true,
            text: async () => JSON.stringify({
              abstained: false,
              passages: JSON.parse(request.body).passages,
              contract: 'schoolcircle-grounding-v1',
            }),
          };
        },
        chatFactory: async ({ path }) => {
          if (path !== 'local') {
            const error = new Error('hosted network unavailable');
            error.code = 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE';
            throw error;
          }
          Object.defineProperty(localChat, 'studentModelPath', { value: 'local' });
          return localChat;
        },
      },
    );
    assert.equal(result.refused, false);
    assert.equal(anchorCalls, 2, 'Anchor is rerun rather than mixing a hosted turn with local stages');
    assert.deepEqual(paths, ['local', 'local', 'local']);
    assert.deepEqual(result.stages.model, { path: 'local', fallback: true });
  });
});

test('an unreachable hosted catalog retries the complete real adapter pipeline against its local catalog', async () => {
  const keys = [
    'STUDENT_MODEL_ID',
    'OPENAI_API_KEY',
    'STUDENT_LOCAL_BASE_URL',
    'STUDENT_LOCAL_MODEL_ID',
    'STUDENT_LOCAL_API_KEY',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  let anchorCalls = 0;
  const localCalls = [];
  process.env.STUDENT_MODEL_ID = 'hosted-gpt-6-astra';
  process.env.OPENAI_API_KEY = 'synthetic-hosted-key';
  process.env.STUDENT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1';
  process.env.STUDENT_LOCAL_MODEL_ID = 'served-local-id';
  process.env.STUDENT_LOCAL_API_KEY = 'synthetic-local-key';
  globalThis.fetch = async (url, init = {}) => {
    const address = String(url);
    if (address === 'https://api.openai.com/v1/models') throw new TypeError('network unreachable');
    assert.ok(address.startsWith('http://127.0.0.1:8080/v1/'));
    localCalls.push({ address, init });
    assert.equal(init.headers.authorization, 'Bearer synthetic-local-key');
    if (address.endsWith('/models')) return { ok: true, async json() { return { data: [{ id: 'served-local-id' }] }; } };
    const system = JSON.parse(init.body).messages[0].content;
    const payload = system.includes('strict fact-checker')
      ? { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] }
      : system.includes('strict doctrine examiner')
        ? { verdict: 'in-doctrine', conforms: true }
        : { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
    return {
      ok: true,
      async json() { return { choices: [{ message: { content: JSON.stringify(payload) } }] }; },
    };
  };
  try {
    await withDoctrine(async () => {
      const result = await groundedStudentAnswer(
        { question: 'What happens before launch?', passages },
        {
          fetch: async (_url, request) => {
            anchorCalls += 1;
            return {
              ok: true,
              text: async () => JSON.stringify({
                abstained: false,
                passages: JSON.parse(request.body).passages,
                contract: 'schoolcircle-grounding-v1',
              }),
            };
          },
        },
      );
      assert.equal(result.refused, false);
      assert.deepEqual(result.stages.model, { path: 'local', fallback: true });
    });
    assert.equal(anchorCalls, 2);
    assert.equal(localCalls.filter((call) => call.address.endsWith('/models')).length, 1);
    assert.equal(localCalls.filter((call) => call.address.endsWith('/chat/completions')).length, 3);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a bounded hosted attempt aborts into a fresh local attempt budget', async () => {
  let anchorCalls = 0;
  const paths = [];
  const localChat = async (system) => {
    paths.push('local');
    if (system.includes('strict fact-checker')) {
      return { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] };
    }
    if (system.includes('strict doctrine examiner')) return { verdict: 'in-doctrine', conforms: true };
    return { refused: false, answer: 'Learners complete the safety check before launch. [1]', used: [1] };
  };
  await withDoctrine(async () => {
    const result = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        // Test-only short bounds avoid waiting for the production 30-second
        // hosted reservation while exercising the same abort path.
        initialModelPath: 'hosted',
        attemptTimeouts: { hosted: 5, local: 200 },
        fetch: async (_url, request) => {
          anchorCalls += 1;
          return {
            ok: true,
            text: async () => JSON.stringify({
              abstained: false,
              passages: JSON.parse(request.body).passages,
              contract: 'schoolcircle-grounding-v1',
            }),
          };
        },
        chatFactory: async ({ path, signal }) => {
          if (path === 'hosted') {
            return async () => new Promise((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('hosted attempt aborted')), { once: true });
            });
          }
          Object.defineProperty(localChat, 'studentModelPath', { value: 'local' });
          return localChat;
        },
      },
    );
    assert.equal(result.refused, false);
    assert.deepEqual(result.stages.model, { path: 'local', fallback: true });
  });
  assert.equal(anchorCalls, 2);
  assert.deepEqual(paths, ['local', 'local', 'local']);
});

test('rejects markers unsupported by the candidate used set and unavailable Understudy APIs', async () => {
  await withDoctrine(async () => {
    const badCitation = await groundedStudentAnswer(
      { question: 'What happens before launch?', passages },
      {
        fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
        chat: async (system) => {
          if (system.includes('strict fact-checker')) {
            return { claims: [{ claim: 'Safety check precedes launch.', supported: true }], unsupported: [] };
          }
          return { refused: false, answer: 'Learners complete the safety check before launch. [2]', used: [1] };
        },
      },
    );
    assert.equal(badCitation.refused, true);
    assert.equal(badCitation.reason, 'citation_invalid');

    await assert.rejects(
      groundedStudentAnswer(
        { question: 'What happens before launch?', passages },
        {
          fetch: anchor({ abstained: false, passages, contract: 'schoolcircle-grounding-v1' }),
          chat: async () => assert.fail('model must not run without all required APIs'),
          load: async (name) => (name === 'understudy' ? {} : import(name)),
        },
      ),
      (error) =>
        error?.code === 'STUDENT_GROUNDING_SERVICE_ERROR' &&
        error.stage === 'dependencies' &&
        !/missing pinned API/.test(error.message),
    );
  });
});