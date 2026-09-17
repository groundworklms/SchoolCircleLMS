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
  constructor(hook, getArgs = (props) => [props.path, props.options], activate = null) {
    this.hook = hook;
    this.getArgs = getArgs;
    // Set when this harness shares a React shim with a sibling harness (see
    // loadQueryHookPair): points the shim at THIS instance before every
    // render, including one a sibling's setState schedules asynchronously,
    // so two concurrent "components" never clobber each other's hook state.
    this.activate = activate;
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
    this.activate?.();
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

function loadQueryHook(authFetch) {
  const filename = 'app/_learning/useLearning.js';
  const source = fs.readFileSync(path.join(workspace, filename), 'utf8');
  const transformed = transformSync(source, {
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
  harness.runner = new HookHarness(module.exports.useApiQuery);
  return harness.runner;
}

/**
 * Two independent hook instances -- two mounted components -- loaded against
 * the SAME evaluation of useLearning.js, so they share its module-scoped
 * request-dedup map exactly the way two real components sharing one bundle
 * do. `loadQueryHook` above only ever drives one instance, so the React shim
 * there can point permanently at a single harness; here each harness points
 * the shim at itself before it runs (see HookHarness#activate), which is what
 * keeps a scheduled re-render from one instance out of the other's slots.
 */
function loadQueryHookPair(authFetch) {
  const filename = 'app/_learning/useLearning.js';
  const source = fs.readFileSync(path.join(workspace, filename), 'utf8');
  const transformed = transformSync(source, {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: false },
      target: 'es2019',
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const active = {};
  const React = {
    __esModule: true,
    useState: (...args) => active.runner.useState(...args),
    useRef: (...args) => active.runner.useRef(...args),
    useEffect: (...args) => active.runner.useEffect(...args),
    useCallback: (...args) => active.runner.useCallback(...args),
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
  const runnerA = new HookHarness(module.exports.useApiQuery, undefined, () => { active.runner = runnerA; });
  const runnerB = new HookHarness(module.exports.useApiQuery, undefined, () => { active.runner = runnerB; });
  return { runnerA, runnerB };
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

/* Pinning the request-dedup semantics by name, not by resting on some other
 * screen's test happening to exercise them. useApiQuery is used by every
 * screen, so a later refactor here has a wide blast radius; these four
 * properties are the ones a shared-request cache has to hold for that to be
 * safe:
 *   - two mounts asking for the same thing at once must cost one request;
 *   - a deliberate refetch must always be a real, independent request;
 *   - a settled request must not go on being served to a later mount;
 *   - unmounting one consumer must never take the request out from under a
 *     sibling that is still waiting on it.
 *
 * KNOWN, ACCEPTED TRADE-OFF: a component that mounts WHILE a request for its
 * path is already in flight joins that request and so is handed a snapshot
 * taken before it mounted -- it does not get a fresher read just because it
 * rendered later. Mutations stay correct regardless, because `refetch` always
 * bypasses the shared map (see the second test below); the exposure is a
 * late-joining GET reading data that predates its own mount by a few hundred
 * milliseconds. That is judged an acceptable cost of collapsing duplicate GETs
 * (see Finding B), not an oversight -- recorded here so it reads as a decision
 * the next time someone traces a stale-render report back to this file. */

test('two concurrent mounts of the same path share one network call, and both receive the data', async () => {
  const calls = [];
  const { runnerA, runnerB } = loadQueryHookPair((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runnerA.render({ path: '/courses/course-1', options: { enabled: true } });
  runnerB.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  assert.equal(calls.length, 1, 'a second mount for the identical path must not fire its own request');

  calls[0].request.resolve(response({ id: 'course-1' }));
  await settle();
  assert.deepEqual(runnerA.result.data, { id: 'course-1' });
  assert.deepEqual(runnerB.result.data, { id: 'course-1' });
});

test('refetch bypasses the shared map and always makes its own call', async () => {
  const calls = [];
  const { runnerA, runnerB } = loadQueryHookPair((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runnerA.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  assert.equal(calls.length, 1);

  // A sibling mounts while the first request is still in flight and joins it
  // rather than firing a second one.
  runnerB.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  assert.equal(calls.length, 1, 'the sibling mount should have joined the in-flight request');

  // Runner A explicitly asks again. This is the property a mutation's
  // follow-up read depends on: it must never be quietly satisfied by
  // whatever request another mount happens to have in flight.
  const refetch = runnerA.result.refetch();
  await settle();
  assert.equal(calls.length, 2, 'refetch must always make its own request, never reuse a shared one');

  calls[1].request.resolve(response({ id: 'refetched' }));
  await settle();
  await refetch;
  assert.deepEqual(runnerA.result.data, { id: 'refetched' });

  // The sibling never asked to refetch, so it is still waiting on the
  // original shared request -- refetch bypassing the map must not resolve
  // that request for anyone else, nor should the sibling see A's answer.
  assert.equal(runnerB.result.data, null);
  calls[0].request.resolve(response({ id: 'original' }));
  await settle();
  assert.deepEqual(runnerB.result.data, { id: 'original' });
  // And the late resolution of A's own superseded mount fetch must not undo
  // the refetched value it already published.
  assert.deepEqual(runnerA.result.data, { id: 'refetched' });
});

test('a mount after the prior request has settled fetches fresh rather than reusing it', async () => {
  const calls = [];
  const { runnerA, runnerB } = loadQueryHookPair((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runnerA.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  calls[0].request.resolve(response({ id: 'first' }));
  await settle();

  // The first request has already settled and left the shared map, so this
  // mount must not be served that stale response.
  runnerB.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  assert.equal(calls.length, 2, 'a mount after the prior request settled must fetch again, not read the old entry');

  calls[1].request.resolve(response({ id: 'second' }));
  await settle();
  assert.deepEqual(runnerB.result.data, { id: 'second' });
});

test('an unmounted consumer cannot publish, and does not cancel the request for a sibling still mounted', async () => {
  const calls = [];
  const { runnerA, runnerB } = loadQueryHookPair((url, options) => {
    const request = deferred();
    calls.push({ url, options, request });
    return request.promise;
  });
  runnerA.render({ path: '/courses/course-1', options: { enabled: true } });
  runnerB.render({ path: '/courses/course-1', options: { enabled: true } });
  await settle();
  assert.equal(calls.length, 1);

  // A unmounts while the shared request it joined is still in flight.
  runnerA.unmount();
  calls[0].request.resolve(response({ id: 'shared' }));
  await settle();

  assert.equal(runnerA.result.data, null, 'an unmounted consumer must not publish the response it was waiting on');
  assert.deepEqual(
    runnerB.result.data,
    { id: 'shared' },
    "a sibling still mounted must still receive the shared request's data -- A's unmount must not have cancelled it",
  );
});
