'use client';

import { useState } from 'react';
import { COURSES } from './data';
import { usePrefs, setPref } from './prefs';

/* Settings, both roles. Preferences persist in the browser (prefs.js) so the
   instructor's per-course toggles show up on the student side in a demo. */

function Toggle({ on, onChange, label, note }) {
  return (
    <label className="s-toggle-row">
      <span className="s-toggle-text">
        <span>{label}</span>
        {note && <span className="s-toggle-note">{note}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} className={`s-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="s-toggle-knob" />
      </button>
    </label>
  );
}

/* ---------- "How do I learn?" ---------- */

const SURVEY = [
  {
    q: 'When a new topic is introduced, what helps most first?',
    a: [
      ['A diagram or the equipment in front of me', 'visual'],
      ['Someone talking it through', 'aural'],
      ['Reading the outline on my own', 'read'],
      ['Trying it and getting it wrong', 'kinesthetic'],
    ],
  },
  {
    q: 'How do you revise the night before a block exam?',
    a: [
      ['Redraw the block diagrams from memory', 'visual'],
      ['Explain it out loud to someone', 'aural'],
      ['Re-read and rewrite my notes', 'read'],
      ['Work practice problems until they stick', 'kinesthetic'],
    ],
  },
  {
    q: 'A procedure has eight steps. You remember it by…',
    a: [
      ['Picturing where each step happens', 'visual'],
      ['A rhythm or saying', 'aural'],
      ['The written checklist', 'read'],
      ['Having done it a few times', 'kinesthetic'],
    ],
  },
  {
    q: 'Pace that works for you?',
    a: [
      ['Short blocks, often', 'short'],
      ['Long blocks, fewer', 'long'],
      ['Depends on the topic', 'mixed'],
      ['Right before it is due', 'late'],
    ],
  },
];

const PROFILES = {
  visual: { name: 'Visual', note: 'Diagrams, schematics, and seeing the equipment. Your study guide will lead with block diagrams.' },
  aural: { name: 'Aural', note: 'Narrated study guides and talking it through. The ▶ Listen button on Study Materials is for you.' },
  read: { name: 'Read / write', note: 'Outlines, notes, and rewriting. Your plan leans on reading blocks and your own notes.' },
  kinesthetic: { name: 'Hands-on', note: 'Practice sets and labs first, theory second. Your plan front-loads practice problems.' },
};

function Survey({ result, onDone }) {
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState([]);
  const [taking, setTaking] = useState(false);

  if (result && !taking) {
    const p = PROFILES[result.primary];
    return (
      <div>
        <div className="s-profile">
          <div className="s-profile-name">{p.name}</div>
          <div className="s-profile-note">{p.note}</div>
          <div className="s-profile-meta">
            Pace: {result.pace} · taken {result.when} · shared with your instructors as part of the class profile
          </div>
        </div>
        <div className="p-btnrow" style={{ marginTop: '0.9rem' }}>
          <button className="p-btn ghost" onClick={() => { setTaking(true); setI(0); setPicks([]); }}>Retake</button>
        </div>
      </div>
    );
  }
  if (!taking) {
    return (
      <div>
        <p className="s-settings-p">
          Four questions, about a minute. The result shapes how your study guides and plan are built, and instructors see the
          class profile (never individual answers) when they plan lessons.
        </p>
        <button className="p-btn" onClick={() => setTaking(true)}>Start</button>
      </div>
    );
  }
  const step = SURVEY[i];
  const pick = (tag) => {
    const next = [...picks, tag];
    if (i + 1 < SURVEY.length) {
      setPicks(next);
      setI(i + 1);
      return;
    }
    const counts = {};
    next.slice(0, 3).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
    const primary = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const paceTag = next[3];
    const pace = { short: 'short blocks, often', long: 'long blocks', mixed: 'mixed', late: 'deadline-driven' }[paceTag];
    onDone({ primary, pace, when: '13 Sep 2026' });
    setTaking(false);
  };
  return (
    <div>
      <div className="s-survey-step">Question {i + 1} of {SURVEY.length}</div>
      <div className="s-survey-q">{step.q}</div>
      <div className="s-survey-a">
        {step.a.map(([text, tag]) => (
          <button key={text} onClick={() => pick(tag)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------- student ---------- */

export function StudentSettings({ onSignOut }) {
  const prefs = usePrefs();
  const r = prefs.reminders;

  return (
    <div className="s-settings">
      <div className="s-pagehead">
        <h1>Settings</h1>
        <p>Cpl Rivera · signed in via MCeLE · rivera.j@usmc.mil</p>
      </div>

      <section className="p-panel">
        <h3>How do I learn?</h3>
        <Survey result={prefs.learnerProfile} onDone={(res) => setPref('learnerProfile', res)} />
      </section>

      <section className="p-panel">
        <h3>Reminders</h3>
        <p className="s-settings-p">Study-plan blocks and due dates go to the channels you pick. Instructors cannot see these.</p>
        <Toggle label="Outlook calendar" note="Plan blocks appear as calendar events" on={r.outlook} onChange={(v) => setPref('reminders.outlook', v)} />
        <Toggle label="Email" note="A morning summary of what is due" on={r.email} onChange={(v) => setPref('reminders.email', v)} />
        <Toggle label="Text message" note="15 minutes before a plan block" on={r.text} onChange={(v) => setPref('reminders.text', v)} />
        <div className="s-settings-row">
          <span>Quiet hours</span>
          <span className="s-settings-val">{r.quietFrom} – {r.quietTo}</span>
        </div>
      </section>

      <section className="p-panel">
        <h3>Display</h3>
        <div className="s-settings-row">
          <span>Text size</span>
          <span className="p-diff">
            {[
              [0.92, 'Small'],
              [1, 'Default'],
              [1.1, 'Large'],
            ].map(([v, l]) => (
              <button key={l} className={prefs.textScale === v ? 'on' : ''} onClick={() => setPref('textScale', v)}>{l}</button>
            ))}
          </span>
        </div>
      </section>

      <section className="p-panel">
        <h3>Account</h3>
        <div className="s-settings-row">
          <span>Identity</span>
          <span className="s-settings-val">MCeLE / MarineNet SSO · EDIPI on file</span>
        </div>
        <div className="s-settings-row">
          <span>Courses</span>
          <span className="s-settings-val">{Object.values(COURSES).map((c) => c.id).join(' · ')}</span>
        </div>
        <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
          <button className="p-btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    </div>
  );
}

/* ---------- instructor ---------- */

export function InstructorSettings({ course }) {
  const prefs = usePrefs();
  const show = !!prefs.showStanding?.[course.id];

  return (
    <div className="s-settings">
      <h2 className="p-h">Course settings</h2>
      <p className="p-sub">{course.name} · {course.id}. These apply to this course only.</p>

      <section className="p-panel">
        <h3>What students see</h3>
        <Toggle
          label="Show class standing"
          note="Each student sees their own rank in the class on Grades and at annex counseling. They never see other students' scores."
          on={show}
          onChange={(v) => setPref(`showStanding.${course.id}`, v)}
        />
        <Toggle label="Show running grade before annex counseling" note="Off means the grade appears only after you counsel." on onChange={() => {}} />
        <Toggle label="Allow the course assistant during exam weeks" note="Off disables the Ask panel while an exam is scheduled." on={false} onChange={() => {}} />
      </section>

      <section className="p-panel">
        <h3>Annex counseling</h3>
        <p className="s-settings-p">
          Counsel every student on grade and standing after each annex. The counseling record on the student&apos;s Grades tab
          is filled from here.
        </p>
        <div className="s-settings-row">
          <span>Counseling due</span>
          <span className="s-settings-val">Within 2 training days of the annex exam</span>
        </div>
        <div className="s-settings-row">
          <span>Remark required</span>
          <span className="s-settings-val">Yes</span>
        </div>
      </section>

      <section className="p-panel">
        <h3>Generation</h3>
        <Toggle label="Instructor approval before students see generated items" note="Cannot be turned off." on onChange={() => {}} />
        <Toggle label="Cite sources on every generated question" note="Requires the doctrine service." on onChange={() => {}} />
      </section>
    </div>
  );
}
