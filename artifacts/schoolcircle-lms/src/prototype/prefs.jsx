'use client';

import { useSyncExternalStore } from 'react';

/* Tiny preference store, backed by localStorage so a toggle flipped on the
   instructor side shows up on the student side in the same browser — enough
   to demo "the instructor controls this" before there is a backend.
   Shape mirrors what a real settings table would hold. */

const KEY = 'schoolcircle.prefs';

const DEFAULTS = {
  // per course: does the student see their class standing?
  showStanding: { M092721: true, M09CVS1: false },
  // student reminder channels
  reminders: { outlook: true, email: true, text: false, quietFrom: '2200', quietTo: '0600' },
  // learner profile survey result (null until taken)
  learnerProfile: null,
  textScale: 1,
};

let cache = null;
const listeners = new Set();

function read() {
  if (cache) return cache;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

function write(next) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode etc. — keep it in memory */
  }
  listeners.forEach((l) => l());
}

export function setPref(path, value) {
  const cur = read();
  // Split on the FIRST dot only — keys like lesson ids (BE.02.04) contain dots.
  const dot = path.indexOf('.');
  const a = dot === -1 ? path : path.slice(0, dot);
  const b = dot === -1 ? null : path.slice(dot + 1);
  const next = b ? { ...cur, [a]: { ...(cur[a] || {}), [b]: value } } : { ...cur, [a]: value };
  write(next);
}

export function usePrefs() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e) => e.key === KEY && (cache = null, cb());
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
    read,
    () => DEFAULTS
  );
}
