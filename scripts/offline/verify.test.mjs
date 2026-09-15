import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { classify, endpoint, request, verify } from './verify.mjs';
import { askDoctrine } from '../../lib/doctrine.js';
import { askDoctrine as nativeAsk } from '../../lib/server/doctrine.js';

const citation = { n: 1, citation: 'Synthetic manual, para 1, p.1', pub_id: 'SYNTHETIC', page_printed: '1' };
const raw = { abstained: false, text: 'Synthetic fact [1]', citations: [citation] };
const refused = { abstained: true, text: 'Not in this corpus.', abstain_reason: 'low_retrieval_score', citations: [] };

test('source and citation classifications do not equate cloud or FTS with Anchor', () => {
  assert.equal(classify(raw, 'direct').result, 'cited');
  assert.equal(classify(refused, 'direct').result, 'refused');
  assert.equal(classify({ ...raw, text: 'No marker' }, 'direct').result, 'uncited');
  assert.equal(classify({ ...raw, text: '[2]' }, 'direct').result, 'uncited');
  assert.equal(classify({ ...raw, source: 'cloud' }, 'direct').source, 'cloud-generation');
  assert.equal(classify({ ...raw, source: 'fts' }, 'direct').source, 'local-cited-fallback');
  assert.equal(classify({}, 'direct').result, 'invalid-contract');
  assert.equal(classify({ ...raw, citations: [null] }, 'direct').result, 'uncited');
  for (const url of ['https://openrouter.ai', 'http://user:pass@localhost', 'http://localhost/?secret=x'])
    assert.throws(() => endpoint(url));
});

test('real HTTP checks and both current adapters: cited/refused, malformed, loss and recovery', async () => {
  let mode = 'up';
  const seen = [];
  const server = createServer(async (req, res) => {
    seen.push(req.url);
    if (req.url === '/api/health') return res.end('{"status":"ok"}');
    if (req.method === 'GET') return res.end('{"ready":true}');
    if (mode === 'down') { res.writeHead(502); return res.end('{}'); }
    if (mode === 'html') return res.end('<html>not json</html>');
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body).question === 'unsupported' ? refused : raw;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/ask' ? value : {
      abstained: value.abstained, answer: value.text,
      abstainReason: value.abstain_reason ?? null, citations: value.citations,
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const old = process.env.DOCTRINE_BASE_URL;
  process.env.DOCTRINE_BASE_URL = base;
  try {
    for (const adapter of [askDoctrine, nativeAsk]) {
      assert.equal(classify(await adapter({ question: 'supported' }), 'proxy').result, 'cited');
      assert.equal(classify(await adapter({ question: 'unsupported' }), 'proxy').result, 'refused');
    }
    const config = { authorizedLocalOnly: true, phase: 'normal', direct: base, proxy: base,
      supportedQuestion: 'supported', refusalQuestion: 'unsupported' };
    const report = await verify(config, 'synthetic-test-token', 1000);
    assert.equal(report.offlineSuccess, false);
    assert.equal(report.checks.filter(c => c.result === 'cited').length, 2);
    assert.equal(report.checks.filter(c => c.result === 'refused').length, 2);
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC'));
    assert.ok(!JSON.stringify(report).includes(base));
    mode = 'down';
    assert.ok((await verify({ ...config, phase: 'tunnel-loss' }, 'test', 1000)).checks.some(c => c.result === 'unavailable'));
    await assert.rejects(askDoctrine({ question: 'supported' }), { code: 'DOCTRINE_ERROR' });
    mode = 'html';
    assert.equal((await request(base, '/api/ask', { question: 'supported' })).error, 'non-json');
    await assert.rejects(nativeAsk({ question: 'supported' }), { code: 'DOCTRINE_BAD_RESPONSE' });
    mode = 'up';
    assert.equal((await verify({ ...config, phase: 'recovered' }, 'test', 1000)).checks.filter(c => c.result === 'cited').length, 2);
    assert.ok(seen.every(p => ['/api/ask', '/api/health', '/api/doctrine'].includes(p)));
  } finally {
    if (old === undefined) delete process.env.DOCTRINE_BASE_URL; else process.env.DOCTRINE_BASE_URL = old;
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal((await request(base, '/api/health', { timeoutMs: 100 })).error, 'unreachable-timeout-or-redirect');
});

test('bounded transport rejects redirects, oversized and stalled responses', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'https://example.com' }); res.end();
    } else if (req.url === '/large') res.end('x'.repeat(262145));
    else { res.writeHead(200); res.write('{'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await request(base, '/redirect')).error, 'unreachable-timeout-or-redirect');
    assert.equal((await request(base, '/large')).error, 'oversized-response');
    assert.equal((await request(base, '/stall', { timeoutMs: 50 })).error, 'unreachable-timeout-or-redirect');
    const blocked = await verify({ authorizedLocalOnly: true, phase: 'normal',
      proxy: base, supportedQuestion: 'synthetic', refusalQuestion: 'unsupported' }, undefined, 50);
    assert.ok(blocked.checks.some(c => c.result === 'external-blocker-authentication-required'));
    assert.ok(blocked.checks.some(c => c.result === 'external-blocker-target-not-supplied'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});