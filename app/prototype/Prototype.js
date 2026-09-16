'use client';

import { useEffect, useRef } from 'react';
import './prototype.css';
import { canAccessLocation, canAccessRole, useNav } from './nav';
import { usePrefs } from './prefs';
import StudentShell from './StudentShell';
import InstructorShell from './InstructorShell';
import { useAuth } from '../_auth/AuthProvider';

/* Entry. The URL decides the role (see nav.js); each role has a shell built
   from the same rail and content column, so switching roles changes what is
   in the rail, not the chrome around it. */

function useThemeEffect() {
  const { theme } = usePrefs();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);
}

export default function Prototype() {
  const nav = useNav();
  useThemeEffect();
  const { ready, profile } = useAuth();
  const canTeach = canAccessRole(profile, 'instructor', ready);
  const canLearn = canAccessRole(profile, 'student', ready);
  const canUseLocation = canAccessLocation(profile, nav, ready);
  const redirectRef = useRef('');

  useEffect(() => {
    if (!ready || !profile || nav.area === 'not-found' || canUseLocation) {
      if (canUseLocation || nav.area === 'not-found') redirectRef.current = '';
      return;
    }
    if (canTeach) {
      const key = `${profile.id || 'account'}:${nav.role}:${nav.area}:instructor`;
      if (redirectRef.current === key) return;
      redirectRef.current = key;
      nav.go({
        role: 'instructor',
        area: 'library',
        courseId: null,
        view: 'courses',
        lessonId: null,
        page: null,
        threadId: null,
      });
    } else {
      const key = `${profile.id || 'account'}:${nav.role}:${nav.area}:student`;
      if (redirectRef.current === key) return;
      redirectRef.current = key;
      nav.go({
        role: 'student',
        area: 'dashboard',
        courseId: null,
        view: null,
        lessonId: null,
        page: null,
        threadId: null,
      });
    }
  }, [ready, profile, nav.role, nav.area, canTeach, canUseLocation, nav.go]);

  // Keep the old click-through demo available when Firebase is not configured,
  // but never render a stale role shell while an authenticated downgrade is
  // being redirected.
  if (ready && profile && nav.area !== 'not-found' && !canUseLocation) {
    return <div className="scl-fullcenter">Updating your access…</div>;
  }

  if (nav.area === 'not-found') {
    return (
      <div className="scl-fullcenter">
        <h1>Page not found</h1>
        <p>This prototype route does not exist.</p>
      </div>
    );
  }

  return (
    <div className="p-root">
      <div className="p-banner">
        <strong>PROTOTYPE</strong>
        <span>
          Grounded answers, POI ingest and approved course content are live where a service is
          configured; everything else is hand-written mock data. Nothing unreviewed reaches a student.
        </span>
      </div>
      {nav.role === 'student' ? (
        <StudentShell
          nav={nav}
          onSwitchRole={canTeach
            ? () => nav.go({
              role: 'instructor',
              area: 'library',
              courseId: null,
              view: 'courses',
              lessonId: null,
              page: null,
              threadId: null,
            })
            : null}
          role={profile?.role}
        />
      ) : (
        <InstructorShell
          nav={nav}
          role={profile?.role}
          onSwitchRole={canLearn
            ? () => nav.go({
              role: 'student',
              area: 'dashboard',
              courseId: null,
              view: null,
              lessonId: null,
              page: null,
              threadId: null,
            })
            : null}
        />
      )}
    </div>
  );
}
