#!/usr/bin/env node
// Standalone Node 20+ kit. No application imports, dotenv, model calls, or writes.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function endpoint(value) {
  const u = new URL(value);
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const privateHost = h === 'localhost' || h === '::1' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (!privateHost || !['http:', 'https:'].includes(u.protocol) ||
      u.username || u.password || u.search || u.hash) {
    throw new Error('Use an explicit loopback/private IP URL without credentials, query, or fragment');
  }
  return u.href.replace(/\/+$/, '');
}

export function classify(body, kind) {
  if (!body || typeof body !== 'object') return { result: 'invalid-contract' };
  // These labels are response assertions, never proof of where compute ran.
  const source = body.source === 'fts' ? 'local-cited-fallback' :
    ['cloud', 'openrouter'].includes(body.source) ? 'cloud-generation' :
    body.source === 'anchor' ? 'anchor-asserted' : 'not-reported';
  const answer = kind === 'direct' ? body.text : body.answer;
  const reason = kind === 'direct' ? body.abstain_reason : body.abstainReason;
  const citations = body.citations;
  if (typeof body.abstained !== 'boolean' || typeof answer !== 'string' ||
      !answer.trim() || !Array.isArray(citations)) return { result: 'invalid-contract', source };
  if (body.abstained) return {
    result: citations.length === 0 && typeof reason === 'string' && reason.trim()
      ? 'refused' : 'invalid-refusal', source,
  };
  const markers = [...answer.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
  const valid = citations.length > 0 && citations.every(c =>
    c && Number.isInteger(c.n) && c.n > 0 && typeof c.citation === 'string' &&
    c.citation.trim() && typeof c.pub_id === 'string' && c.pub_id.trim() &&
    c.page_printed != null && String(c.page_printed).trim());
  const unique = new Set(citations.map(c => c?.n)).size === citations.length;
  return {
    result: valid && unique && markers.length > 0 &&
      markers.every(n => citations.some(c => c.n === n)) ? 'cited' : 'uncited',
    source, citationCount: citations.length,
    // Text, publication IDs, locators, URLs and errors never enter the report.
    locatorReview: 'operator-required',
  };
}

export async function request(base, path, { question, token, timeoutMs = 35000 } = {}) {
  try {
    const response = await fetch(`${base}${path}`, {
      method: question === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(question === undefined ? {} : { body: JSON.stringify({ question }) }),
    });
    // Bound both time and body size, including a stalled streamed response.
    const reader = response.body?.getReader();
    let raw = '', size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 262144) { await reader.cancel(); return { status: response.status, error: 'oversized-response' }; }
        raw += decoder.decode(value, { stream: true });
      }
    }
    let body;
    try { body = JSON.parse(raw); } catch { return { status: response.status, error: 'non-json' }; }
    return { status: response.status, body };
  } catch {
    return { status: null, error: 'unreachable-timeout-or-redirect' };
  }
}

export async function verify(config, token, timeoutMs = 35000) {
  const phases = ['normal', 'network-pulled', 'tunnel-loss', 'recovered'];
  if (!phases.includes(config.phase) || config.authorizedLocalOnly !== true)
    throw new Error('Select a phase and attest authorizedLocalOnly before running');
  if (typeof config.supportedQuestion !== 'string' || !config.supportedQuestion.trim() ||
      typeof config.refusalQuestion !== 'string' || !config.refusalQuestion.trim())
    throw new Error('Two operator-approved public/synthetic questions are required');
  // Validate all targets before making any request.
  const targets = ['direct', 'proxy'].map(kind => ({
    kind, base: config[kind] ? endpoint(config[kind]) : null,
  }));
  const report = {
    version: 1, phase: config.phase, at: new Date().toISOString(),
    offlineSuccess: false, networkIsolation: 'requires-independent-operator-evidence',
    cloudGeneration: 'not-invoked', localModel: 'not-probed',
    localCitedFallback: 'unavailable-in-this-kit-no-verified-current-route',
    capabilities: 'configuration-only-not-readiness', checks: [],
  };
  for (const { kind, base } of targets) {
    if (!base) { report.checks.push({ kind, result: 'external-blocker-target-not-supplied' }); continue; }
    const status = await request(base, kind === 'direct' ? '/api/health' : '/api/doctrine', { timeoutMs });
    report.checks.push({
      kind, check: 'status', http: status.status,
      result: status.error || (status.status === 200 ? 'http-reachable-not-inference-proof' : 'unavailable'),
      ...(kind === 'proxy' ? { configured: status.body?.ready === true } : {}),
    });
    if (kind === 'proxy' && !token) {
      report.checks.push({ kind, result: 'external-blocker-authentication-required' }); continue;
    }
    for (const [check, question] of [['supported', config.supportedQuestion], ['refusal', config.refusalQuestion]]) {
      const out = await request(base, kind === 'direct' ? '/api/ask' : '/api/doctrine',
        { question, token: kind === 'proxy' ? token : undefined, timeoutMs });
      const observation = out.error ? { result: out.error } :
        out.status === 200 ? classify(out.body, kind) : {
          result: [401, 403].includes(out.status) ? 'authentication-blocked' : 'unavailable',
        };
      report.checks.push({ kind, check, http: out.status, ...observation,
        transport: kind === 'direct' ? 'direct-anchor-target' : 'schoolcircle-doctrine-proxy',
        expected: check === 'supported' ? 'cited' : 'refused' });
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node verify.mjs /private/config.json [/private/firebase-token.txt]');
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const token = process.argv[3] ? (await readFile(process.argv[3], 'utf8')).trim() : undefined;
    const report = await verify(config, token);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.checks.filter(c => c.check !== 'status').every(c =>
      c.expected && c.result === c.expected && c.source !== 'cloud-generation') ? 0 : 2;
  } catch {
    console.error('Preflight could not run: check the private config, local target URLs and token file. See docs/offline-delivery-verification.md.');
    process.exitCode = 1;
  }
}