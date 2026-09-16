import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { validatePackage } from 'cartridge';

// Use Cartridge's installed ZIP reader, without adding a shared dependency.
const require = createRequire(import.meta.resolve('cartridge'));
const JSZip = require('jszip');

/**
 * Narrow SCORM RTE simulator: enforces lifecycle and writable score/status
 * vocabulary used by this SCO. Not an ADL conformance suite or a real LMS.
 */
export function createRuntime(version) {
  assert.ok(['1.2', '2004'].includes(version));
  const modern = version === '2004';
  const names = modern
    ? ['Initialize', 'SetValue', 'Commit', 'Terminate']
    : ['LMSInitialize', 'LMSSetValue', 'LMSCommit', 'LMSFinish'];
  const data = {};
  const calls = [];
  let state = 'new';
  let committed = {};
  const allowed = modern ? {
    'cmi.completion_status': ['incomplete', 'completed'],
    'cmi.success_status': ['passed', 'failed'],
    'cmi.score.raw': 'score', 'cmi.score.min': 'score',
    'cmi.score.max': 'score', 'cmi.score.scaled': 'scaled',
  } : {
    'cmi.core.lesson_status': ['incomplete', 'completed', 'passed', 'failed'],
    'cmi.core.score.raw': 'score', 'cmi.core.score.min': 'score',
    'cmi.core.score.max': 'score',
  };
  const api = Object.fromEntries(names.map((name, operation) => [name, (...args) => {
    let valid = operation === 0 ? state === 'new' : state === 'active';
    if (operation !== 1) valid &&= args.length === 1 && args[0] === '';
    if (operation === 1) {
      const [key, value] = args;
      const rule = allowed[key];
      valid &&= args.length === 2 && typeof value === 'string' && Boolean(rule);
      if (valid) valid = Array.isArray(rule) ? rule.includes(value)
        : value.trim() !== '' && Number.isFinite(Number(value)) &&
          Number(value) >= (rule === 'scaled' ? -1 : 0) &&
          Number(value) <= (rule === 'scaled' ? 1 : 100);
    }
    calls.push({ method: name, args, result: valid ? 'true' : 'false' });
    if (!valid) return 'false';
    if (operation === 0) state = 'active';
    if (operation === 1) data[args[0]] = args[1];
    if (operation === 2) committed = { ...data };
    if (operation === 3) state = 'terminated';
    return 'true';
  }]));
  return { api, calls, data, get state() { return state; }, get committed() { return committed; } };
}

export async function launchPackage(bytes, version, { outcome = 'pass', discovery = 'parent' } = {}) {
  const validation = await validatePackage(bytes);
  assert.equal(validation.valid, true);
  const zip = await JSZip.loadAsync(bytes);
  const manifest = await zip.file('imsmanifest.xml').async('string');
  const launch = manifest.match(/<resource\b[^>]*\bhref="([^"]+)"/)?.[1];
  assert.ok(launch && zip.file(launch), 'Manifest launch file must exist');
  const html = await zip.file(launch).async('string');
  const runtime = createRuntime(version);
  const apiName = version === '2004' ? 'API_1484_11' : 'API';
  const host = { [apiName]: runtime.api };
  host.parent = host;
  const elements = Object.fromEntries(['app', 'st', 'res', 'sub', 'done'].map(id => [id, {}]));
  let context;
  // Deliberately small DOM seam. Execute the original inline rendering/grading
  // code; never invoke SCORM.complete with a fabricated score.
  elements.app.querySelectorAll = (selector) => {
    assert.equal(selector, '.q');
    return context.DATA.quiz.map(q => ({
      getAttribute(name) { assert.equal(name, 'data-a'); return String(q.answer); },
      querySelector(name) {
        assert.equal(name, 'input:checked');
        return { value: String(outcome === 'pass' ? q.answer : (q.answer + 1) % q.options.length) };
      },
      querySelectorAll(name) {
        assert.equal(name, '.opt');
        return q.options.map(() => ({ classList: { add() {} } }));
      },
    }));
  };
  context = vm.createContext({
    document: { getElementById(id) {
      if (id === 'done' && context.DATA?.quiz.length) return null;
      if (id === 'sub' && !context.DATA?.quiz.length) return null;
      assert.ok(elements[id], `Unexpected DOM element ${id}`);
      return elements[id];
    } },
  });
  context.window = context;
  context.parent = discovery === 'parent' ? host : context;
  if (discovery === 'opener') context.opener = host;
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = script[1].match(/src="([^"]+)"/)?.[1];
    if (src) assert.ok(zip.file(src), `Missing script ${src}`);
    vm.runInContext(src ? await zip.file(src).async('string') : script[2], context, { timeout: 1000 });
  }
  assert.match(elements.st.textContent, /connected/);
  assert.equal(runtime.state, 'active');
  assert.ok(elements.app.innerHTML.includes('class="card"'), 'Lesson rendered');
  const initial = { ...runtime.committed };
  assert.ok(Object.values(initial).includes('incomplete'));
  vm.runInContext("document.getElementById(DATA.quiz.length ? 'sub' : 'done').onclick()", context, { timeout: 1000 });
  assert.equal(runtime.state, 'terminated');
  assert.ok(runtime.calls.every(call => call.result === 'true'));
  const prefix = version === '2004' ? 'cmi' : 'cmi.core';
  const expectedScore = outcome === 'pass' ? '100' : '0';
  assert.equal(runtime.committed[`${prefix}.score.raw`], expectedScore);
  assert.equal(runtime.committed[`${prefix}.score.min`], '0');
  assert.equal(runtime.committed[`${prefix}.score.max`], '100');
  const status = outcome === 'pass' ? 'passed' : 'failed';
  if (version === '2004') {
    assert.equal(runtime.committed['cmi.score.scaled'], outcome === 'pass' ? '1' : '0');
    assert.equal(runtime.committed['cmi.completion_status'], 'completed');
    assert.equal(runtime.committed['cmi.success_status'], status);
  } else assert.equal(runtime.committed['cmi.core.lesson_status'], status);
  assert.match(elements.res.textContent, new RegExp(`Score: ${expectedScore}%`));
  return { version, outcome, discovery, launch, initial, committed: runtime.committed, calls: runtime.calls };
}