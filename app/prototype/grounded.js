'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase.js';

/* Shared bridge from the prototype screens to the seeded course database (issue #8).
   One place that knows how to reach the real, human-ratified, cited items so every screen
   wires the same way and degrades the same way. */

// Which seeded (DB) course backs each prototype course, by Anchor sourceId (Course.sourceId).
// Grow: as the content lane ingests more courses, extend this mapping.
export const COURSE_SOURCE = { TC32209: 'TC 3-22.9' };

/* Fetch the seeded DB course that backs the given prototype course (its sections and APPROVED
   items only, each carrying its Anchor citation). Degrades silently:
     { status:'ready',  db:null }  → no mapping / no match yet (show nothing, keep the mock)
     { status:'error',  db:null }  → API/DB unreachable, e.g. the static Pages build
     { status:'ready',  db:{...} } → real course to render. */
export function useDoctrineCourse(courseId) {
  const [state, setState] = useState({ status: 'loading', db: null });
  useEffect(() => {
    const sourceId = COURSE_SOURCE[courseId];
    if (!sourceId) { setState({ status: 'ready', db: null }); return; }
    let alive = true;
    authFetch('/api/courses')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))))
      .then((d) => {
        if (!alive) return;
        const db = (d.courses || []).find((c) => c.sourceId === sourceId) || null;
        setState({ status: 'ready', db });
      })
      .catch(() => alive && setState({ status: 'error', db: null }));
    return () => { alive = false; };
  }, [courseId]);
  return state;
}

/* Flatten APPROVED items of one kind (LESSON/QUESTION/SCENARIO) out of a DB course,
   each tagged with the section title it came from. Optionally restrict to one section. */
export function itemsOfKind(db, kind, sectionTitle) {
  if (!db) return [];
  return db.sections
    .filter((s) => !sectionTitle || s.title === sectionTitle)
    .flatMap((s) => (s.items || []).filter((it) => it.kind === kind).map((it) => ({ ...it, section: s.title })));
}
