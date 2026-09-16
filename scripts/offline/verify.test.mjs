import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { classify, endpoint, request, verify } from './verify.mjs';
import { askDoctrine } from '../../lib/doctrine.js';

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
  for (const url of ['https://openrouter.ai', 'http://user:pass@localhost', 'http://localhost/?secret=x',
    'http://127.evil.example', 'http://10.example.com', 'http://192.168.example.com'])
    assert.throws(() => endpoint(url));
  for (const url of ['http://127.0.0.1', 'http://[::1]', 'http://10.1.2.3', 'http://172.16.0.1'])
    assert.ok(endpoint(url));
});

test('loopback HTTP and native adapter: cited/refused, malformed, loss and recovery', async () => {
  let mode = 'up';
  const seen = [];
  const server = createServer(async (req, res) => {
    seen.push(req.url);
    if (req.url === '/api/ask') assert.equal(req.headers.authorization, undefined);
    if (req.url === '/api/doctrine' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer synthetic-test-token');
    }
    if (req.url === '/api/health') return res.end('{"status":"ok"}');
    if (req.method === 'GET') return res.end('{"ready":true}');
    if (mode === 'down') { res.writeHead(502); return res.end('{}'); }
    if (mode === 'html') return res.end('<html>not json</html>');
    let body = ''; for await (const chunk of req) body += chunk;
    const value = JSON.parse(body).question === 'unsupported' ? refused : raw;
    res.setHeader('Content-Type', 'application/json');
    // Controlled proxy seam uses the real native adapter, not copied projection logic.
    res.end(JSON.stringify(req.url === '/api/ask' ? value :
      await askDoctrine({ question: JSON.parse(body).question })));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const old = process.env.DOCTRINE_BASE_URL;
  process.env.DOCTRINE_BASE_URL = base;
  try {
    for (const adapter of [askDoctrine]) {
      assert.equal(classify(await adapter({ question: 'supported' }), 'proxy').result, 'cited');
      assert.equal(classify(await adapter({ question: 'unsupported' }), 'proxy').result, 'refused');
    }
    const config = { authorizedLocalOnly: true, phase: 'normal', direct: base, proxy: base,
      supportedQuestion: 'supported', refusalQuestion: 'unsupported' };
    const report = await verify(config, 'synthetic-test-token', 1000);
    assert.equal(report.offlineSuccess, false);
    assert.equal(report.cloudGeneration, 'not-established');
    assert.equal(report.checks.filter(c => c.result === 'cited').length, 2);
    assert.equal(report.checks.filter(c => c.result === 'refused').length, 2);
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC'));
    assert.ok(!JSON.stringify(report).includes(base));
    assert.ok(!JSON.stringify(report).includes('synthetic-test-token'));
    mode = 'down';
    const lost = await verify({ ...config, phase: 'tunnel-loss' }, 'synthetic-test-token', 1000);
    for (const kind of ['direct', 'proxy'])
      assert.equal(lost.checks.filter(c => c.kind === kind && c.result === 'unavailable').length, 2);
    await assert.rejects(askDoctrine({ question: 'supported' }), { code: 'DOCTRINE_ERROR' });
    mode = 'html';
    assert.equal((await request(base, '/api/ask', { question: 'supported' })).error, 'non-json');
    await assert.rejects(askDoctrine({ question: 'supported' }), { code: 'DOCTRINE_BAD_RESPONSE' });
    mode = 'up';
    const recovered = await verify({ ...config, phase: 'recovered' }, 'synthetic-test-token', 1000);
    assert.equal(recovered.checks.filter(c => c.result === 'cited').length, 2);
    assert.equal(recovered.checks.filter(c => c.result === 'refused').length, 2);
    assert.ok(seen.every(p => ['/api/ask', '/api/health', '/api/doctrine'].includes(p)));
  } finally {
    if (old === undefined) delete process.env.DOCTRINE_BASE_URL; else process.env.DOCTRINE_BASE_URL = old;
    await new Promise(resolve => server.close(resolve));
  }
  assert.equal((await request(base, '/api/health', { timeoutMs: 100 })).error, 'unreachable-timeout-or-redirect');
  const unreachable = await verify({ authorizedLocalOnly: true, phase: 'tunnel-loss',
    direct: base, proxy: base, supportedQuestion: 'supported', refusalQuestion: 'unsupported' },
    'synthetic-test-token', 100);
  assert.equal(unreachable.checks.filter(c => c.error || c.result === 'unreachable-timeout-or-redirect').length, 6);
});

test('plaintext LAN proxy credentials are rejected before any requests', async () => {
  await assert.rejects(verify({ authorizedLocalOnly: true, phase: 'normal',
    direct: 'http://127.0.0.1:1', proxy: 'http://192.168.1.1',
    supportedQuestion: 'supported', refusalQuestion: 'unsupported' }, 'synthetic-test-token'),
  /requires HTTPS or a loopback tunnel/);
});

test('cloud assertions never become an offline or no-cloud claim', async () => {
  const server = createServer((req, res) => {
    res.end(JSON.stringify({ ...raw, source: 'cloud' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const report = await verify({ authorizedLocalOnly: true, phase: 'network-pulled',
      direct: `http://127.0.0.1:${server.address().port}`,
      supportedQuestion: 'supported', refusalQuestion: 'unsupported' });
    assert.equal(report.cloudGeneration, 'not-established');
    assert.equal(report.offlineSuccess, false);
    assert.equal(report.checks.filter(c => c.source === 'cloud-generation').length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
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