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