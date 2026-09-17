import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function source(name) {
  return fs.readFileSync(path.join(workspace, 'app/prototype', name), 'utf8');
}

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

async function settleEffect(effect) {
  effect();
  await new Promise((resolve) => setImmediate(resolve));
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

/*
 * This deliberately small loader keeps the test focused on the global student
 * views. It supplies hook implementations so the inbox's request lifecycle can
 * be exercised without a browser or a second test dependency.
 */
function loadComponent(relativePath, {
  authState = { ready: true, user: null },
  authFetch = async () => response({ messages: [] }),
  prefs = {},
  expose = [],
} = {}) {
  const filename = path.join(workspace, relativePath);
  const transformed = transformSync(fs.readFileSync(filename, 'utf8'), {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2019',
      transform: { react: { runtime: 'classic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const state = [];
  let stateIndex = 0;
  const effects = [];
  const reactForModule = {
    ...React,
    useState(initialValue) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [state[index], (next) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next;
      }];
    },
    useRef(initialValue) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = { current: initialValue };
      return state[index];
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    AbortController,
    console,
    require(request) {
      if (request === 'react') return reactForModule;
      if (request === '../_auth/AuthProvider') return { useAuth: () => authState };
      if (request === '../../lib/firebase') return { authFetch };
      if (request === './prefs') return {
        usePrefs: () => prefs,
        setPref: () => {},
      };
      if (request === '../_auth/AccountProfile') {
        return { __esModule: true, default: () => React.createElement('div', null, 'Account profile') };
      }
      if (request === './LearnerFeatures') {
        return { WaypointSurvey: () => React.createElement('div', null, 'Waypoint survey') };
      }
      if (request === './ModelProviderSettings') return { ModelProviderSettings: () => null };
      if (request === './DoctrineSettings') return { DoctrineSettings: () => null };
      if (request.endsWith('.css')) return {};
      return require(request);
    },
  };
  const exposed = expose.map((name) => `module.exports[${JSON.stringify(name)}] = ${name};`).join('\n');
  vm.runInNewContext(`${transformed.code}\n${exposed}`, sandbox, { filename });

  return {
    exports: module.exports,
    effects,
    rerender() {
      stateIndex = 0;
      return module.exports.useRosterInbox();
    },
    render(Component, props = {}) {
      stateIndex = 0;
      return renderToStaticMarkup(React.createElement(Component, props));
    },
  };
}

test('global student views contain no fixed learner fixtures or account claims', () => {
  const calendar = source('StudentCalendar.js');
  const inbox = source('StudentInbox.js');
  const settings = source('Settings.js');

  assert.doesNotMatch(calendar, /COURSES|FIXED|PLAN_RANGE|2026|Push to Outlook|Text reminders/);
  assert.match(calendar, /Schedule unavailable/);
  assert.doesNotMatch(inbox, /MESSAGES|Cpl\s+Rivera|MCeLE|LOCAL DEMO|localOnly|usePrefs/);
  assert.doesNotMatch(settings, /COURSES|Cpl\s+Rivera|MCeLE|rivera\.j|MarineNet SSO/);
  assert.match(settings, /AccountProfile/);
  assert.match(settings, /WaypointSurvey/);
});

test('signed-out inbox and settings are neutral and have no unread badge', () => {
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
  });
  const inboxMarkup = inbox.render(inbox.exports.default, { onOpen() {}, onArea() {} });
  assert.match(inboxMarkup, /Sign in required/);
  assert.doesNotMatch(inboxMarkup, /s-inbox-pill/);
  assert.doesNotMatch(inboxMarkup, /LOCAL DEMO|Cpl Rivera|Block exam/);

  const settings = loadComponent('app/prototype/Settings.js', {
    // The account tab still prepares reminder preferences before selecting
    // which panel to show.
    prefs: { reminders: { outlook: false, email: false, text: false, quietFrom: '2200', quietTo: '0600', phone: '' } },
  });
  const settingsMarkup = settings.render(settings.exports.StudentSettings, {
    authenticated: false,
    account: null,
    onSignOut() {},
    onTab() {},
    tab: 'account',
  });
  assert.match(settingsMarkup, /Sign in to manage your account settings/);
  assert.match(settingsMarkup, /Sign in to view account details/);
  assert.doesNotMatch(settingsMarkup, /Courses|MCeLE|MarineNet|rivera/i);
});

test('authenticated inbox renders an empty server result without fake messages', async () => {
  const requests = [];
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
    authState: { ready: true, user: { uid: 'learner-1' } },
    authFetch: async (url, init) => {
      requests.push([url, init]);
      return response({ messages: [] });
    },
  });
  const first = inbox.exports.useRosterInbox();
  assert.equal(first.messages.length, 0);
  await settleEffect(inbox.effects[0]);
  const loaded = inbox.rerender();
  assert.equal(loaded.loading, false);
  assert.equal(loaded.error, '');
  assert.deepEqual(loaded.messages, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/roster/messages');
  assert.equal(requests[0][1].signal instanceof AbortSignal, true);
});

test('authenticated inbox maps, reads, deletes, and reports server messages', async () => {
  const requests = [];
  const serverMessage = {
    id: 42,
    senderName: 'Instructor One',
    courseName: 'Field Communications',
    subject: 'Welcome',
    body: 'Read this first.',
    createdAt: '2026-09-12T07:15:00.000Z',
    read: false,
  };
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
    authState: { ready: true, user: { uid: 'learner-1' } },
    authFetch: async (url, init = {}) => {
      requests.push([url, init]);
      if (init.method === 'PATCH' || init.method === 'DELETE') return response({ ok: true });
      return response({ messages: [serverMessage] });
    },
  });
  inbox.exports.useRosterInbox();
  await settleEffect(inbox.effects[0]);
  let current = inbox.rerender();
  assert.equal(current.messages[0].id, 'roster-42');
  assert.equal(current.messages[0].serverId, 42);
  assert.equal(current.messages[0].from, 'Instructor One');
  assert.equal(current.messages[0].courseName, 'Field Communications');
  assert.equal(current.messages[0].unread, true);

  await current.markRead(current.messages[0]);
  current = inbox.rerender();
  assert.equal(current.messages[0].unread, false);
  assert.equal(JSON.parse(requests[1][1].body).id, 42);
  assert.equal(JSON.parse(requests[1][1].body).read, true);

  await current.removeMessage(current.messages[0]);
  current = inbox.rerender();
  assert.deepEqual(current.messages, []);
  assert.equal(requests[2][0], '/api/roster/messages');
  assert.equal(requests[2][1].method, 'DELETE');
  assert.equal(JSON.parse(requests[2][1].body).id, 42);
});

test('authenticated inbox exposes server errors and clears messages', async () => {
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
    authState: { ready: true, user: { uid: 'learner-1' } },
    authFetch: async () => response({ error: 'Roster service unavailable' }, { ok: false, status: 503 }),
  });
  inbox.exports.useRosterInbox();
  await settleEffect(inbox.effects[0]);
  const current = inbox.rerender();
  assert.equal(current.messages.length, 0);
  assert.equal(current.loading, false);
  assert.equal(current.error, 'Roster service unavailable');
});

test('switching accounts hides prior messages immediately and ignores stale fetch completion', async () => {
  const authState = { ready: true, user: { uid: 'account-a' } };
  const pending = [];
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
    authState,
    authFetch: (url, init) => new Promise((resolve, reject) => pending.push({ url, init, resolve, reject })),
  });
  inbox.exports.useRosterInbox();
  const cleanupA = inbox.effects[0]();
  pending[0].resolve(response({
    messages: [{ id: 1, senderName: 'A', subject: 'A message', body: 'A', read: false }],
  }));
  await settle();
  assert.equal(inbox.rerender().messages[0].from, 'A');

  authState.user = { uid: 'account-b' };
  const beforeEffect = inbox.rerender();
  assert.equal(beforeEffect.messages.length, 0);
  const cleanupB = inbox.effects.at(-1)();
  assert.equal(pending.length, 2);
  pending[0].reject(new Error('stale account A failure'));
  await settle();
  const afterStale = inbox.rerender();
  assert.equal(afterStale.messages.length, 0);
  assert.equal(afterStale.error, '');

  pending[1].resolve(response({
    messages: [{ id: 2, senderName: 'B', subject: 'B message', body: 'B', read: false }],
  }));
  await settle();
  const current = inbox.rerender();
  assert.equal(current.messages[0].from, 'B');
  assert.equal(current.error, '');
  cleanupA?.();
  cleanupB?.();
});

test('stale mutations cannot write into a new account and current failures preserve messages', async () => {
  const authState = { ready: true, user: { uid: 'account-a' } };
  const pending = [];
  const inbox = loadComponent('app/prototype/StudentInbox.js', {
    authState,
    authFetch: (url, init = {}) => {
      if (!init.method) return Promise.resolve(response({
        messages: [{ id: 3, senderName: 'A', subject: 'A message', body: 'A', read: false }],
      }));
      return new Promise((resolve, reject) => pending.push({ url, init, resolve, reject }));
    },
  });
  inbox.exports.useRosterInbox();
  await settleEffect(inbox.effects[0]);
  let current = inbox.rerender();
  const message = current.messages[0];

  const staleRead = current.markRead(message);
  authState.user = { uid: 'account-b' };
  const switched = inbox.rerender();
  assert.equal(switched.messages.length, 0);
  pending[0].resolve(response({ ok: true }));
  assert.equal(await staleRead, false);
  assert.equal(inbox.rerender().messages.length, 0);

  const readFailure = loadComponent('app/prototype/StudentInbox.js', {
    authState: { ready: true, user: { uid: 'account-c' } },
    authFetch: (url, init = {}) => init.method
      ? Promise.resolve(response({ error: 'read denied' }, { ok: false, status: 403 }))
      : Promise.resolve(response({
        messages: [{ id: 4, senderName: 'C', subject: 'C message', body: 'C', read: false }],
      })),
  });
  readFailure.exports.useRosterInbox();
  await settleEffect(readFailure.effects[0]);
  current = readFailure.rerender();
  await assert.rejects(current.markRead(current.messages[0]), /read denied/);
  assert.equal(readFailure.rerender().messages[0].unread, true);

  const deleteFailure = loadComponent('app/prototype/StudentInbox.js', {
    authState: { ready: true, user: { uid: 'account-d' } },
    authFetch: (url, init = {}) => init.method
      ? Promise.resolve(response({ error: 'delete denied' }, { ok: false, status: 403 }))
      : Promise.resolve(response({
        messages: [{ id: 5, senderName: 'D', subject: 'D message', body: 'D', read: false }],
      })),
  });
  deleteFailure.exports.useRosterInbox();
  await settleEffect(deleteFailure.effects[0]);
  current = deleteFailure.rerender();
  await assert.rejects(current.removeMessage(current.messages[0]), /delete denied/);
  assert.equal(deleteFailure.rerender().messages[0].id, 'roster-5');
});