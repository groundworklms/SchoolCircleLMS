'use client';

import { auth } from './firebase.js';

export async function authenticatedFetch(url, options = {}, expectedUser = auth?.currentUser, runtime = {}) {
  const authInstance = runtime.authInstance || auth;
  const fetchImpl = runtime.fetchImpl || fetch;
  const HeadersImpl = runtime.HeadersImpl || Headers;
  const user = expectedUser;
  if (!user) throw new Error('Sign in to ask the doctrine.');
  /*
   * A local operator session (lib/offline-session.js) is not tracked by the
   * Firebase auth instance, so the "is this still the signed-in account?" check
   * below cannot apply to it -- `auth` is null on an offline deployment and the
   * comparison would fail every offline request. The guarantee it provides is
   * kept by different means: the offline user object is immutable and cached
   * per token, so the object the caller passed IS the session it names, and a
   * sign-out replaces the object rather than mutating it.
   */
  if (user.offline === true) {
    const offlineHeaders = new HeadersImpl(options.headers);
    offlineHeaders.set('Authorization', `Bearer ${await user.getIdToken()}`);
    return fetchImpl(url, { ...options, headers: offlineHeaders });
  }
  if (authInstance?.currentUser !== user) throw new Error('Your session changed. Please try again.');
  const token = await user.getIdToken();
  // A sign-out/account change while obtaining the token must not submit the question.
  if (authInstance?.currentUser !== user) throw new Error('Your session changed. Please try again.');
  const headers = new HeadersImpl(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetchImpl(url, { ...options, headers });
}