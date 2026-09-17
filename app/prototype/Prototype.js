'use client';

import { useEffect, useRef } from 'react';
import './prototype.css';
import './instructor-preview.css';
import { canAccessLocation, canAccessRole, useNav } from './nav';
import { usePrefs } from './prefs';
import StudentShell from './StudentShell';
import InstructorShell from './InstructorShell';
import { useAuth } from '../_auth/AuthProvider';
import PrototypeNotFound from './NotFound';

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
    return <PrototypeNotFound />;
  }

  const toInstructor = () => nav.go({
    role: 'instructor',
    area: 'library',
    courseId: null,
    view: 'courses',
    lessonId: null,
    page: null,
    threadId: null,
  });
  const toStudent = () => nav.go({
    role: 'student',
    area: 'dashboard',
    courseId: null,
    view: null,
    lessonId: null,
    page: null,
    threadId: null,
  });

  // An account that can teach, looking at the learner shell. The two views are
  // otherwise identical chrome, so say which one this is -- and say what the
  // difference actually is, because "your draft is missing" is alarming until
  // you know it is the point. The claim is kept to what the server enforces
  // (lib/learner-view.js); it does not promise that everything else on screen
  // is a learner's.
  const inStudentView = nav.role === 'student' && ready && Boolean(profile) && canTeach;

  return (
    <div className="p-root">
      {nav.role === 'student' ? (
        <StudentShell
          nav={nav}
          onSwitchRole={canTeach ? toInstructor : null}
          role={profile?.role}
        />
      ) : (
        <InstructorShell
          nav={nav}
          role={profile?.role}
          onSwitchRole={canLearn ? toStudent : null}
        />
      )}
      {inStudentView && (
        <div className="p-studentview" role="status">
          <span className="p-studentview-text">
            <b>Student view</b>
            Course visibility here is learner-scoped: a draft you own but have not published is
            hidden, exactly as it is for a learner. Your instructor account is still signed in.
          </span>
          <button type="button" className="p-btn quiet" onClick={toInstructor}>
            Back to instructor view
          </button>
        </div>
      )}
    </div>
  );
}
