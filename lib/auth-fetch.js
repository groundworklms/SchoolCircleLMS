'use client';

import { auth } from './firebase.js';

export async function authenticatedFetch(url, options = {}, expectedUser = auth?.currentUser, runtime = {}) {
  const authInstance = runtime.authInstance || auth;
  const fetchImpl = runtime.fetchImpl || fetch;
  const HeadersImpl = runtime.HeadersImpl || Headers;
  const user = expectedUser;
  if (!user) throw new Error('Sign in to ask the doctrine.');
  if (authInstance?.currentUser !== user) throw new Error('Your session changed. Please try again.');
  const token = await user.getIdToken();
  // A sign-out/account change while obtaining the token must not submit the question.
  if (authInstance?.currentUser !== user) throw new Error('Your session changed. Please try again.');
  const headers = new HeadersImpl(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetchImpl(url, { ...options, headers });
}