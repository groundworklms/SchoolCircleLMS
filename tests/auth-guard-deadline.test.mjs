import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Observed live on 2026-09-18. The Firebase SDK wedged --
 *
 *   @firebase/auth: INTERNAL ASSERTION FAILED: Pending promise was never set
 *       at tX.reject ... at tX.onAuthEvent
 *
 * thrown from inside the SDK when a popup sign-in was interrupted mid-flight.
 * Once that happens, onAuthStateChanged never fires again for that page load,
 * and `setLoading(false)` lived ONLY inside that callback. Every route behind
 * the guard became a dead page: "Checking your session..." forever, nothing to
 * click, no explanation, and the only cure was clearing IndexedDB by hand.
 *
 * The provider is a React context wired to a live SDK, so what is asserted
 * here is the property that was missing: there is a path out of `loading` that
 * does not depend on the SDK answering.
 */
const provider = readFileSync(new URL('../app/_auth/AuthProvider.js', import.meta.url), 'utf8');

test('loading can end without the SDK ever answering', () => {
  assert.match(provider, /setTimeout\(/, 'a deadline exists');
  assert.match(provider, /AUTH_STATE_DEADLINE_MS/, 'and it is named, not inline');
  const effect = provider.slice(provider.indexOf('onAuthStateChanged(auth'));
  assert.ok(
    provider.indexOf('setLoading(false)') < provider.indexOf('onAuthStateChanged(auth'),
    'at least one setLoading(false) is reachable without the callback',
  );
  assert.ok(effect.length > 0);
});

test('the deadline is cancelled when the SDK does answer', () => {
  assert.match(provider, /clearTimeout\(timer\)/, 'otherwise a healthy sign-in is undone 8s later');
  // And once, not twice: `settled` stops the timer firing after the callback.
  assert.match(provider, /let settled = false/);
  assert.match(provider, /if \(settled\) return/);
});

test('the timer is cleared when the effect tears down', () => {
  const teardown = provider.slice(provider.indexOf('return () => {'));
  assert.match(teardown.slice(0, 200), /clearTimeout\(timer\)/);
  assert.match(teardown.slice(0, 200), /unsubscribe\(\)/);
});

test('a stalled read is reported rather than silently treated as signed out', () => {
  assert.match(provider, /setAuthStalled\(true\)/);
  assert.match(provider, /setAuthStalled\(false\)/, 'and cleared when the SDK recovers');
  assert.match(provider, /authStalled,/, 'and published on the context');

  const login = readFileSync(new URL('../app/login/page.js', import.meta.url), 'utf8');
  assert.match(login, /authStalled/, 'the sign-in screen says why the visitor is there');
});
