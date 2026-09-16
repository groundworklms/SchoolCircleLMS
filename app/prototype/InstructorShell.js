'use client';

import './student.css';

import { COURSES } from './data';
import { I, RailButton, UserMenu } from './shell';
import { InstructorSettings } from './Settings';
import Curriculum from './Curriculum';
import LiveControl from './LiveControl';
import Mastery from './Mastery';
import AAR from './AAR';
import Roster from './Roster';

/* Instructor shell. Same rail and content column as the student side; what
   changes is who is signed in and what is in the rail. The four instructor
   screens are untouched — this file only decides where they sit. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };

const VIEWS = [
  { id: 'builder', label: 'Curriculum' },
  { id: 'roster', label: 'Roster' },
  { id: 'control', label: 'Run Live Session' },
  { id: 'mastery', label: 'Class Mastery' },
  { id: 'aar', label: 'Course AAR' },
  { id: 'settings', label: 'Course settings' },
];

const SCREENS = { builder: Curriculum, roster: Roster, control: LiveControl, mastery: Mastery, aar: AAR, settings: InstructorSettings };

export default function InstructorShell({ nav, onSwitchRole }) {
  const courseId = COURSES[nav.courseId] ? nav.courseId : 'M092721';
  const course = COURSES[courseId];
  const view = VIEWS.find((v) => v.id === nav.view) ? nav.view : 'builder';
  const current = VIEWS.find((v) => v.id === view);
  const Screen = SCREENS[view];

  const go = (patch) => nav.go({ role: 'instructor', courseId, view, ...patch });

  return (
    <div className="s-root">
      <nav className="s-rail">
        <UserMenu
          name={INSTRUCTOR.name}
          role={INSTRUCTOR.role}
          initials={INSTRUCTOR.initials}
          inst
          items={[
            { label: 'Course settings', hint: course.id, onClick: () => go({ view: 'settings' }) },
            { label: 'View as student', onClick: onSwitchRole },
            'divider',
            { label: 'Sign out', danger: true, onClick: () => { window.location.href = '/'; } },
          ]}
        />

        <div className="s-rail-sec" style={{ paddingTop: '0.2rem' }}>Teaching</div>
        {Object.values(COURSES).map((c) => (
          <RailButton
            key={c.id}
            sub
            on={c.id === courseId}
            icon={<span className="s-rail-dot" style={{ background: c.id === 'M092721' ? 'var(--p-accent)' : 'var(--p-dim)' }} />}
            label={c.name.replace(' Course', '')}
            onClick={() => go({ courseId: c.id })}
          />
        ))}

        <div className="s-rail-sec">
          <span className="s-rail-sec-name">{course.name}</span>
          <code>{course.id}</code>
        </div>
        {VIEWS.map((v) => (
          <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
        ))}

        <div className="s-rail-spacer" />
        <RailButton icon={I.swap} label="View as student" onClick={onSwitchRole} />
        <RailButton icon={I.back} label="Planning board" onClick={() => { window.location.href = '/'; }} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">Instructor</span>
          <span className="s-crumb-sep">/</span>
          <button onClick={() => go({ view: 'builder' })}>{course.name}</button>
          <span className="s-crumb-sep">/</span>
          <span className="s-crumb-cur">{current.label}</span>
          <span className="s-crumb-spacer" />
          <span className="s-lastlogin">{course.students} students · Week {course.week} of {course.weeks}</span>
        </div>
        <main className="s-main">
          <div className="s-container">
            <div className="p-roleband inst">
              <strong>Instructor view</strong>
              <span>Every AI output lands here for review before it reaches a student.</span>
            </div>
            <Screen key={course.id} course={course} instructorName={INSTRUCTOR.name} />
          </div>
        </main>
      </div>
    </div>
  );
}
