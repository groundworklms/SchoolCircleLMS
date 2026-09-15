'use client';

import { auth } from './firebase.js';

export async function authenticatedFetch(url, options = {}) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to ask the doctrine.');
  const token = await user.getIdToken();
  // A sign-out/account change while obtaining the token must not submit the question.
  if (auth.currentUser !== user) throw new Error('Your session changed. Please try again.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}