'use client';

import './prototype.css';
import { useNav } from './nav';
import StudentShell from './StudentShell';
import InstructorShell from './InstructorShell';

/* Entry. The URL decides the role (see nav.js); each role has a shell built
   from the same rail and content column, so switching roles changes what is
   in the rail, not the chrome around it. */

export default function Prototype() {
  const nav = useNav();

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
        <StudentShell nav={nav} onSwitchRole={() => nav.go({ role: 'instructor', courseId: nav.courseId || 'M092721', view: 'builder' })} />
      ) : (
        <InstructorShell nav={nav} onSwitchRole={() => nav.go({ role: 'student', area: 'dashboard', courseId: null, view: null })} />
      )}
    </div>
  );
}
