'use client';

import { useEffect, useRef } from 'react';
import './prototype.css';
import { canAccessRole, useNav } from './nav';
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
  const redirectRef = useRef('');

  useEffect(() => {
    if (!ready || !profile) return;
    if (nav.role === 'instructor' && !canTeach) {
      const key = `${profile.id || 'account'}:instructor:student`;
      if (redirectRef.current === key) return;
      redirectRef.current = key;
      nav.go({ role: 'student', area: 'dashboard', courseId: null, view: null, lessonId: null, page: null });
    } else if (nav.role === 'student' && !canLearn) {
      const key = `${profile.id || 'account'}:student:instructor`;
      if (redirectRef.current === key) return;
      redirectRef.current = key;
      nav.go({ role: 'instructor', courseId: nav.courseId || 'M092721', view: 'builder' });
    } else {
      redirectRef.current = '';
    }
  }, [ready, profile, nav.role, nav.courseId, canTeach, canLearn, nav.go]);

  // Keep the old click-through demo available when Firebase is not configured,
  // but never render a stale role shell while an authenticated downgrade is
  // being redirected.
  if (ready && profile && ((nav.role === 'instructor' && !canTeach) || (nav.role === 'student' && !canLearn))) {
    return <div className="scl-fullcenter">Updating your access…</div>;
  }

  return (
    <div className="p-root">
      <div className="p-banner">
        <strong>PROTOTYPE</strong>
        <span>
          Click-through concept only. All &quot;AI output&quot; below is hand-written mock data — no model
          is running.
        </span>
      </div>
      {nav.role === 'student' ? (
        <StudentShell
          nav={nav}
          onSwitchRole={canTeach
            ? () => nav.go({ role: 'instructor', courseId: nav.courseId || 'M092721', view: 'builder' })
            : null}
          role={profile?.role}
        />
      ) : (
        <InstructorShell
          nav={nav}
          onSwitchRole={canLearn
            ? () => nav.go({ role: 'student', area: 'dashboard', courseId: null, view: null })
            : null}
        />
      )}
    </div>
  );
}
