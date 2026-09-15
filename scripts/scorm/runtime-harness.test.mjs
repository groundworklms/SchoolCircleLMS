import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildCartridge } from 'cartridge';
import { createRuntime, launchPackage } from './runtime-harness.mjs';

for (const version of ['1.2', '2004']) {
  test(`${version}: simulator rejects invalid lifecycle and data`, () => {
    const runtime = createRuntime(version);
    const [init, set, commit, end] = version === '2004'
      ? ['Initialize', 'SetValue', 'Commit', 'Terminate']
      : ['LMSInitialize', 'LMSSetValue', 'LMSCommit', 'LMSFinish'];
    const raw = version === '2004' ? 'cmi.score.raw' : 'cmi.core.score.raw';
    assert.equal(runtime.api[commit](''), 'false');
    assert.equal(runtime.api[set](raw, '100'), 'false');
    assert.equal(runtime.api[init]('bad argument'), 'false');
    assert.equal(runtime.api[init](''), 'true');
    assert.equal(runtime.api[init](''), 'false');
    assert.equal(runtime.api[set]('cmi.invalid', '100'), 'false');
    assert.equal(runtime.api[set](raw, '101'), 'false');
    assert.equal(runtime.api[set](raw, 100), 'false');
    assert.equal(runtime.api[set](raw, '100'), 'true');
    assert.deepEqual(runtime.committed, {});
    assert.equal(runtime.api[commit](''), 'true');
    assert.equal(runtime.committed[raw], '100');
    assert.equal(runtime.api[end](''), 'true');
    assert.equal(runtime.api[end](''), 'false');
    assert.equal(runtime.api[set](raw, '0'), 'false');
    assert.equal(runtime.api[commit](''), 'false');
    assert.equal(runtime.committed[raw], '100');
  });
  test(`${version}: original package scripts grade pass/fail with parent and opener discovery`, async () => {
    const source = await readFile(new URL('../example/course.json', import.meta.resolve('cartridge')), 'utf8');
    const zip = await buildCartridge(JSON.parse(source), { version });
    for (const outcome of ['pass', 'fail']) {
      for (const discovery of ['parent', 'opener']) {
        const run = await launchPackage(zip, version, { outcome, discovery });
        assert.equal(run.calls.filter(call => /Commit$/.test(call.method)).length, 2);
      }
    }
  });
}