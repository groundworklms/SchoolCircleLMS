import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class EventTargetMock {
  #listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) || new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.#listeners.get(event.type) || []) listener(event);
  }

  listenerCount(type) {
    return this.#listeners.get(type)?.size || 0;
  }
}

class HookHarness {
  constructor(hook, getArgs = (props) => [props.path, props.options]) {
    this.hook = hook;
    this.getArgs = getArgs;
    this.slots = [];
    this.effects = [];
    this.index = 0;
    this.mounted = false;
    this.renderQueued = false;
    this.result = null;
  }

  useState(initial) {
    const index = this.index++;
    if (!(index in this.slots)) this.slots[index] = initial;
    return [
      this.slots[index],
      (next) => {
        if (!this.mounted) return;
        this.slots[index] = typeof next === 'function' ? next(this.slots[index]) : next;
        this.queueRender();
      },
    ];
  }

  useRef(initial) {
    const index = this.index++;
    if (!(index in this.slots)) this.slots[index] = { current: initial };
    return this.slots[index];
  }

  useMemo(factory, deps) {
    const index = this.index++;
    const previous = this.slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      this.slots[index] = { deps, value: factory() };
    }
    return this.slots[index].value;
  }

  useCallback(callback, deps) {
    return this.useMemo(() => callback, deps);
  }

  useEffect(effect, deps) {
    const index = this.index++;
    const previous = this.effects[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      this.effects[index] = { deps, effect, cleanup: previous?.cleanup, pending: true };
    }
  }

  render(props) {
    this.props = props;
    this.index = 0;
    this.mounted = true;
    this.result = this.hook(...this.getArgs(props));
    for (const entry of this.effects) {
      if (!entry?.pending) continue;
      entry.pending = false;
      entry.cleanup?.();
      entry.cleanup = entry.effect() || undefined;
    }
    return this.result;
  }

  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (this.mounted) this.render(this.props);
    });
  }

  unmount() {
    this.mounted = false;
    for (const entry of this.effects) entry?.cleanup?.();
  }
}

function sameDeps(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

function deferred() {
  let resolve;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function loadQueryHook(authFetch, manual = false) {
  const filename = manual ? 'app/prototype/learning.js' : 'app/_learning/useLearning.js';
  const source = fs.readFileSync(path.join(workspace, filename), 'utf8');
  const sourceWithTestExport = manual
    ? `${source}\nmodule.exports.__useManualCourses = useManualCourses;`
    : source;
  const transformed = transformSync(sourceWithTestExport, {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: false },
      target: 'es2019',
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const harness = {};
  const React = {
    __esModule: true,
    useState: (...args) => harness.runner.useState(...args),
    useRef: (...args) => harness.runner.useRef(...args),
    useEffect: (...args) => harness.runner.useEffect(...args),
    useCallback: (...args) => harness.runner.useCallback(...args),
  };
  const sandbox = {
    module,
    exports: module.exports,
    window: globalThis.window,
    document: globalThis.document,
    AbortController,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    require(request) {
      if (request === 'react') return React;
      if (request === '../../lib/firebase') return { authFetch };
      if (request === '../_auth/AuthProvider') return { useAuth: () => ({ ready: true, user: { uid: 'test' } }) };
      if (request === '../_learning/useLearning') return {};
      if (request === './data') return { COURSES: {} };
      if (request === './learning-course-utils') return {
        courseFromRecord: (entry, kind) => ({ ...entry, kind }),
      };
      throw new Error(`Unexpected import ${request}`);
    },
  };
  vm.runInNewContext(transformed.code, sandbox, { filename: 'useLearning.js' });
  harness.runner = manual
    ? new HookHarness(module.exports.__useManualCourses, (props) => [props.enabled, props.options])
    : new HookHarness(module.exports.useApiQuery);
  return harness.runner;
}

async function settle() {
  for (let count = 0; count < 8; count += 1) await Promise.resolve();
}

function installVisiblePage() {
  const window = new EventTargetMock();
  const document = new EventTargetMock();
  document.visibilityState = 'visible';
  globalThis.window = window;
  globalThis.document = document;
  return { window, document };
}

test('latest query response wins, so deleted and newly added courses stay fresh', async () => {
  const calls = [];
  const runner = loadQueryHook((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runner.render({ path: '/courses', options: { enabled: true } });
  await settle();
  const first = calls[0];
  const refetch = runner.result.refetch();
  await settle();
  const second = calls[1];
  second.request.resolve(response([{ id: 'new-course' }]));
  await settle();
  first.request.resolve(response([{ id: 'deleted-course' }]));
  await settle();
  await refetch;
  assert.deepEqual(runner.result.data, [{ id: 'new-course' }]);
});

test('a disabled or unmounted query cannot publish a deferred response', async () => {
  const calls = [];
  const runner = loadQueryHook((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runner.render({ path: '/courses', options: { enabled: true } });
  await settle();
  runner.render({ path: '/courses', options: { enabled: false } });
  calls[0].request.resolve(response([{ id: 'disabled-course' }]));
  await settle();
  assert.equal(runner.result.data, null);

  runner.render({ path: '/courses', options: { enabled: true } });
  await settle();
  const deferredAfterEnable = calls.at(-1);
  runner.unmount();
  deferredAfterEnable.request.resolve(response([{ id: 'unmounted-course' }]));
  await settle();
  assert.equal(runner.result.data, null);
});

test('visible-tab return refresh is enabled and deduped across focus/page events', async () => {
  const page = installVisiblePage();
  const calls = [];
  const runner = loadQueryHook((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runner.render({ path: '/courses', options: { enabled: true, refreshOnFocus: true } });
  await settle();
  calls[0].request.resolve(response([]));
  await settle();

  assert.equal(page.window.listenerCount('focus'), 1);
  page.window.dispatchEvent({ type: 'focus' });
  page.window.dispatchEvent({ type: 'pageshow' });
  page.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(calls.length, 2);
  calls[1].request.resolve(response([{ id: 'external-course' }]));
  await settle();
  assert.deepEqual(runner.result.data, [{ id: 'external-course' }]);
  runner.unmount();
  delete globalThis.window;
  delete globalThis.document;
});

test('only the latest overlapping manual refetch settles waiters', async () => {
  const calls = [];
  const runner = loadQueryHook((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  }, true);
  runner.render({ enabled: true, options: {} });
  await settle();
  const firstRefetch = runner.result.refetch();
  let firstRefetchSettled = false;
  firstRefetch.then(() => { firstRefetchSettled = true; });
  await settle();
  const firstRefresh = calls[1];
  // Refetch invalidates the initial request before its deferred response
  // arrives. Its completion must not settle the new refetch waiter.
  calls[0].request.resolve(response({ courses: [{ id: 'stale-initial' }] }));
  await settle();
  assert.equal(firstRefetchSettled, false);

  let secondRefetchSettled = false;
  const secondRefetch = runner.result.refetch();
  secondRefetch.then(() => { secondRefetchSettled = true; });
  await settle();
  const latestRefresh = calls[2];

  // The stale adapter ignores AbortSignal, so this is the deferred-response
  // case that used to drain waiters before the latest request had completed.
  firstRefresh.request.resolve(response({ courses: [{ id: 'deleted-course' }] }));
  await settle();
  assert.equal(secondRefetchSettled, false);
  assert.equal(runner.result.courses.length, 0);

  latestRefresh.request.resolve(response({ courses: [] }));
  await Promise.all([firstRefetch, secondRefetch]);
  await settle();
  assert.equal(runner.result.courses.length, 0);
});