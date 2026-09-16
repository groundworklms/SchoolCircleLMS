import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
const source = fs.readFileSync(new URL('../app/_auth/AuthGuard.js', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
  module: { type: 'commonjs' },
});

function render(state, { complete = true, allowed = true } = {}) {
  const module = { exports: {} };
  const deps = {
    react: { ...React, useEffect: () => {}, useRef: (current) => ({ current }) },
    'next/navigation': { useRouter: () => ({ replace() {} }) },
    './AuthProvider': { useAuth: () => state },
    './AccountProfile': { default: () => React.createElement('p', null, 'Complete your profile'), __esModule: true },
    './AccountRecovery': { default: () => React.createElement('p', null, 'Recover your account'), __esModule: true },
    '../../lib/allowlist': { isAllowedEmail: () => allowed },
    '../../lib/profile-options.js': { isProfileComplete: () => complete },
    './login-return.js': { currentPathAndQuery: () => '/prototype', loginHref: () => '/login' },
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, React,
    require: (name) => {
      assert.ok(deps[name], `Unexpected import: ${name}`);
      return deps[name];
    },
  });
  return renderToStaticMarkup(React.createElement(module.exports.default, null,
    React.createElement('main', null, 'Protected content')));
}

const signedIn = { ready: true, user: { uid: 'test-user' }, profile: { name: 'Test account' } };
test('completed signed-in account renders only page content, without floating account chrome', () => {
  assert.equal(render(signedIn), '<main>Protected content</main>');
});
test('removing account chrome preserves loading, recovery, and onboarding gates', () => {
  assert.match(render({ ...signedIn, loading: true }), /Checking your session/);
  assert.match(render({ ...signedIn, profileLoading: true }), /Loading your account/);
  assert.match(render({ ...signedIn, profileError: { message: 'Failed' } }), /Recover your account/);
  assert.match(render(signedIn, { complete: false }), /Complete your profile/);
  assert.equal(render({ ready: true, user: null }), '');
  assert.equal(render(signedIn, { allowed: false }), '');
});
test('unconfigured auth continues to render the existing preview', () => {
  assert.equal(render({ ready: false }), '<main>Protected content</main>');
});

// Unit harness only: no runtime authentication changes, tokens, or API calls.
function missingPage(state) {
  const values = [];
  let cursor = 0;
  const location = { href: '/prototype/missing' };
  const react = {
    ...React,
    useEffect() {},
    useRef: (current) => ({ current }),
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next) => { values[index] = next; }];
    },
  };
  const load = (path, deps) => {
    const module = { exports: {} };
    const { code } = transformSync(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
      module: { type: 'commonjs' },
    });
    vm.runInNewContext(code, {
      module, exports: module.exports, React, window: { location },
      require(name) {
        if (name === 'react') return react;
        if (name === '../_auth/AuthProvider') return { useAuth: () => state };
        assert.ok(name in deps, `Unexpected import: ${name}`);
        return deps[name];
      },
    });
    return module.exports.default;
  };
  const NotFound = load('../app/prototype/NotFound.js', {});
  const shell = { __esModule: true, default: () => { throw new Error('404 must use missing-page component'); } };
  const Prototype = load('../app/prototype/Prototype.js', {
    './prototype.css': {},
    './nav': { useNav: () => ({ area: 'not-found' }), canAccessRole: () => true, canAccessLocation: () => true },
    './prefs': { usePrefs: () => ({ theme: 'light' }) },
    './StudentShell': shell,
    './InstructorShell': shell,
    './NotFound': { __esModule: true, default: NotFound },
  });
  return {
    location,
    page() {
      cursor = 0;
      const route = Prototype();
      assert.equal(route.type, NotFound);
      return NotFound();
    },
  };
}

function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}

test('authenticated missing route exposes home and sign-out, without floating chrome', () => {
  const harness = missingPage({ ...signedIn, signOut: async () => {} });
  const html = renderToStaticMarkup(harness.page());
  assert.match(html, /Page not found/);
  assert.match(html, /href="\/"/);
  assert.match(html, />Sign out<\/button>/);
  assert.doesNotMatch(html, /scl-authpill/);
});

test('missing route does not offer sign-out without an authenticated user', () => {
  for (const state of [{ ready: false, user: null }, { ready: true, user: null }]) {
    assert.doesNotMatch(renderToStaticMarkup(missingPage(state).page()), /Sign out/);
  }
});

test('missing route disables sign-out while pending and redirects only after success', async () => {
  let finish;
  let calls = 0;
  const harness = missingPage({ ...signedIn, signOut: () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const button = (page) => elements(page).find((item) => item.type === 'button');
  const pending = button(harness.page()).props.onClick();
  assert.equal(button(harness.page()).props.disabled, true);
  assert.equal(button(harness.page()).props.children, 'Signing out…');
  await button(harness.page()).props.onClick();
  assert.equal(calls, 1);
  assert.equal(harness.location.href, '/prototype/missing');
  finish();
  await pending;
  assert.equal(harness.location.href, '/');
});

test('missing route keeps user on page and allows retry when sign-out fails', async () => {
  let fail = true;
  const harness = missingPage({ ...signedIn, signOut: async () => {
    if (fail) throw new Error('Sign-out failed');
  } });
  const button = () => elements(harness.page()).find((item) => item.type === 'button');
  await button().props.onClick();
  assert.equal(harness.location.href, '/prototype/missing');
  assert.match(renderToStaticMarkup(harness.page()), /role="alert".*Unable to sign out/);
  assert.equal(button().props.disabled, false);
  fail = false;
  await button().props.onClick();
  assert.equal(harness.location.href, '/');
  assert.doesNotMatch(renderToStaticMarkup(harness.page()), /role="alert"/);
});