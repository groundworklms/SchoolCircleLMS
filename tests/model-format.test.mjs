import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { generateJSON } from '../lib/server/model.js';

test('model JSON formats and credential isolation', async (t) => {
  const keys = ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY', 'OPENROUTER_API_KEY'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';
  process.env.MODEL_ID = 'test-only';
  delete process.env.MODEL_API_KEY;
  // A stray provider key must never be picked up by the adapter.
  process.env.OPENROUTER_API_KEY = 'test-only-not-a-real-key';
  let sent;
  const stub = mock.method(globalThis, 'fetch', async (_url, init) => {
    sent = init;
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  t.after(() => stub.mock.restore());
  const call = (schema) => generateJSON({ system: 'JSON only', prompt: 'test', schema });

  // Companion libraries pass an unconstrained object schema -> JSON mode.
  await call({ type: 'object', additionalProperties: true });
  assert.deepEqual(JSON.parse(sent.body).response_format, { type: 'json_object' });
  assert.equal(sent.headers.authorization, undefined, 'no key configured means no credential is sent');

  // An explicit schema keeps structured output.
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  await call(schema);
  assert.equal(JSON.parse(sent.body).response_format.type, 'json_schema');
  assert.deepEqual(JSON.parse(sent.body).response_format.json_schema.schema, schema);

  // Only MODEL_API_KEY is ever sent, to whichever endpoint is configured.
  process.env.MODEL_API_KEY = 'test-only-dedicated-key';
  await call(schema);
  assert.equal(sent.headers.authorization, 'Bearer test-only-dedicated-key');
  process.env.MODEL_BASE_URL = 'https://private-model.example.test/v1';
  await call(schema);
  assert.equal(sent.headers.authorization, 'Bearer test-only-dedicated-key');
});
