/*
 * The way in, and when it is offered.
 *
 * Requirement: the offline sign-in path appears ONLY when the mode is on. These
 * render the real login page and the real AuthGuard through SWC (the same
 * harness tests/auth-guard-chrome.test.mjs uses) so the gating is checked
 * against the shipped markup rather than a description of it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

function compile(relativePath) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return transformSync(source, {
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' },
  }).code;
}

const loginCode = compile('../app/login/page.js');
const guardCode = compile('../app/_auth/AuthGuard.js');

function evaluate(code, deps) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    React,
    // The login page reads window.location.search inside an effect; effects are
    // stubbed out, but keep a window present for the module-level guards.
    window: { location: { search: '', pathname: '/login' } },
    require: (name) => {
      assert.ok(Object.hasOwn(deps, name), `Unexpected import: ${name}`);
      return deps[name];
    },
  });
  return module.exports.default;
}

/* --------------------------------- login ---------------------------------- */

function renderLogin({ offlineEnabled = false, firebaseReady = false, user = null } = {}) {
  const Login = evaluate(loginCode, {
    react: { ...React, useEffect: () => {} },
    'next/navigation': { useRouter: () => ({ replace() {} }) },
    'next/link': { default: ({ children, ...rest }) => React.createElement('a', rest, children), __esModule: true },
    'firebase/auth': {
      GoogleAuthProvider: class {},
      signInWithPopup: async () => {},
      signInWithEmailAndPassword: async () => {},
      createUserWithEmailAndPassword: async () => {},
      getAdditionalUserInfo: () => ({}),
      signOut: async () => {},
    },
    '../../lib/firebase': { auth: null, firebaseReady },
    '../../lib/allowlist': { isAllowedEmail: () => true, DENIED_MESSAGE: 'denied' },
    '../_auth/AuthProvider': {
      useAuth: () => ({
        user,
        profile: null,
        profileLoading: false,
        profileError: null,
        ready: firebaseReady || offlineEnabled,
        offlineEnabled,
        signInOffline: async () => {},
      }),
    },
    '../_auth/role-destination': { getPostLoginDestination: () => '/prototype' },
    '../landing.css': {},
  });
  return renderToStaticMarkup(React.createElement(Login, null));
}

test('the offline sign-in form is absent unless the mode is on', () => {
  // Nothing configured: the pre-existing "not configured yet" notice, unchanged.
  const bare = renderLogin({ offlineEnabled: false, firebaseReady: false });
  assert.equal(bare.includes('offline-signin'), false);
  assert.equal(bare.includes('Operator id'), false);
  assert.equal(bare.includes('Sign in offline'), false);
  assert.match(bare, /Continue to the prototype/);

  // Firebase configured, offline off: the normal hosted login, unchanged.
  const hosted = renderLogin({ offlineEnabled: false, firebaseReady: true });
  assert.equal(hosted.includes('offline-signin'), false);
  assert.equal(hosted.includes('Operator id'), false);
  assert.match(hosted, /Continue with Google/);
  assert.match(hosted, /Create an account/);
});

test('with the mode on the offline form is offered instead of the open-prototype notice', () => {
  const offline = renderLogin({ offlineEnabled: true, firebaseReady: false });
  assert.match(offline, /offline-signin/);
  assert.match(offline, /Operator id/);
  assert.match(offline, /Operator passphrase/);
  assert.match(offline, /Sign in offline/);
  assert.match(offline, /runs disconnected/);
  // The passphrase field must not be a plain-text input.
  assert.match(offline, /id="operator-passphrase" type="password"/);

  // Crucially: offline mode is a real sign-in, so the "nobody is locked out,
  // walk straight in" notice must NOT also be on the page.
  assert.equal(offline.includes('Continue to the prototype'), false);
  // And it is not a second Firebase login.
  assert.equal(offline.includes('Continue with Google'), false);
});

test('a deployment with both configured offers both, Firebase included', () => {
  const both = renderLogin({ offlineEnabled: true, firebaseReady: true });
  assert.match(both, /Sign in offline/);
  // The Firebase path is still fully present -- offline never replaces it.
  assert.match(both, /Continue with Google/);
  assert.match(both, /autoComplete="email"|autocomplete="email"/i);
});

/* ------------------------------- AuthGuard -------------------------------- */

function renderGuard(state, { complete = true, allowed = true } = {}) {
  const Guard = evaluate(guardCode, {
    react: { ...React, useEffect: () => {}, useRef: (current) => ({ current }) },
    'next/navigation': { useRouter: () => ({ replace() {} }) },
    './AuthProvider': { useAuth: () => state },
    './AccountProfile': { default: () => React.createElement('p', null, 'Complete your profile'), __esModule: true },
    './AccountRecovery': { default: () => React.createElement('p', null, 'Recover your account'), __esModule: true },
    '../../lib/allowlist': { isAllowedEmail: () => allowed },
    '../../lib/profile-options.js': { isProfileComplete: () => complete },
    './login-return.js': { currentPathAndQuery: () => '/prototype', loginHref: () => '/login' },
  });
  return renderToStaticMarkup(React.createElement(Guard, null,
    React.createElement('main', null, 'Protected content')));
}

test('the email allowlist gates Firebase sessions but not local operators', () => {
  const profile = { name: 'SSgt Okafor' };

  // A Firebase session off the tester list is still bounced. Unchanged.
  assert.equal(
    renderGuard({ ready: true, user: { uid: 'firebase-user' }, profile }, { allowed: false }),
    '',
  );

  // An offline operator has no email to be on a list, and is already gated by
  // the server-side roster, so an allowlist must not lock them out.
  assert.equal(
    renderGuard({ ready: true, user: { uid: 'offline:local:sgt-okafor', offline: true }, profile }, { allowed: false }),
    '<main>Protected content</main>',
  );

  // An offline deployment still GATES: no session means no content, rather
  // than the "auth not configured, let everyone through" pass-through.
  assert.equal(renderGuard({ ready: true, user: null, profile }), '');

  // Onboarding and recovery gates still apply to an offline operator.
  const offlineUser = { ready: true, user: { uid: 'o', offline: true }, profile };
  assert.match(renderGuard(offlineUser, { complete: false }), /Complete your profile/);
  assert.match(
    renderGuard({ ...offlineUser, profileError: { message: 'Failed' } }),
    /Recover your account/,
  );
});
