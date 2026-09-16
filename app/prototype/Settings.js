'use client';

import { useState } from 'react';
import { COURSES } from './data';
import { usePrefs, setPref } from './prefs';
import AccountProfile from '../_auth/AccountProfile';
import { WaypointSurvey } from './LearnerFeatures';
import { ModelProviderSettings } from './ModelProviderSettings';
import { DoctrineSettings } from './DoctrineSettings';

/* Settings, both roles. Preferences persist in the browser (prefs.js) so the
   instructor's per-course toggles show up on the student side in a demo. */

/**
 * Tab chrome for the one Settings destination. The active tab lives in the URL
 * (app/prototype/routes.js), not in component state, so a tab is linkable and
 * the back button works. `onTab` null renders the tabs as static labels, which
 * is what a course-scoped visit wants -- it has no account-wide context to
 * switch to.
 */
function SettingsTabs({ tabs, active, onTab }) {
  return (
    <div className="s-settings-tabs" role="tablist" aria-label="Settings sections">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={`s-settings-tab${active === id ? ' is-active' : ''}`}
          onClick={onTab ? () => onTab(id) : undefined}
          disabled={!onTab && active !== id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label, note }) {
  return (
    <label className="s-toggle-row">
      <span className="s-toggle-text">
        <span>{label}</span>
        {note && <span className="s-toggle-note">{note}</span>}
      </span>
      <button type="button" role="switch" aria-label={label} aria-checked={on} className={`s-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="s-toggle-knob" />
      </button>
    </label>
  );
}

const QUIET_HOURS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? '30' : '00';
  const val = `${String(h).padStart(2, '0')}${m}`;
  return [val, `${String(h).padStart(2, '0')}:${m}`];
});

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

/* Accepts only characters that actually appear in a phone number, and only
   counts it as "entered" once it has a real area code + number (10 digits
   for a US number, up to 15 for a country-code-prefixed one). */
function cleanPhoneInput(raw) {
  return raw.replace(/[^0-9()+\-\s]/g, '');
}
function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/* ---------- student ---------- */

export function StudentSettings({ onSignOut, account, authenticated = false, tab, onTab }) {
  const prefs = usePrefs();
  const r = { ...prefs.reminders, phone: prefs.reminders.phone || '' };
  const displayName = account?.name || (authenticated ? 'Account' : 'Cpl Rivera');
  const displayEmail = account?.email || (authenticated ? 'signed-in account' : 'rivera.j@usmc.mil');
  const active = tab === 'app' ? 'app' : 'account';

  return (
    <div className="s-settings">
      <div className="s-pagehead">
        <h1>Settings</h1>
        <p>
          {displayName} · signed in via MCeLE · {displayEmail}
        </p>
      </div>

      <SettingsTabs
        active={active}
        onTab={onTab}
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'app', label: 'App' },
        ]}
      />

      {active === 'account' && (
        <>
      <section className="p-panel">
        <h3>Account</h3>
        {authenticated && <AccountProfile />}
        <div className="s-settings-row">
          <span>Identity</span>
          <span className="s-settings-val">
            {account?.name || (authenticated ? 'Account' : 'MCeLE / MarineNet SSO')}
            {account?.rank ? ` · ${account.rank}` : ''}
          </span>
        </div>
        <div className="s-settings-row">
          <span>Courses</span>
          <span className="s-settings-val">{Object.values(COURSES).map((c) => c.id).join(' · ')}</span>
        </div>
        <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
          <button className="p-btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
        </>
      )}

      {active === 'app' && (
        <>
      <section className="p-panel">
        <h3>What&apos;s my learning style?</h3>
        {authenticated ? (
          <WaypointSurvey />
        ) : (
          <Survey result={prefs.learnerProfile} onDone={(res) => setPref('learnerProfile', res)} />
        )}
      </section>

      <section className="p-panel">
        <h3>Reminders</h3>
        <p className="s-settings-p">Study-plan blocks and due dates go to the channels you pick. Instructors cannot see these.</p>
        <Toggle label="Outlook calendar" note="Plan blocks appear as calendar events" on={r.outlook} onChange={(v) => setPref('reminders.outlook', v)} />
        <Toggle label="Email" note="A morning summary of what is due" on={r.email} onChange={(v) => setPref('reminders.email', v)} />
        <Toggle
          label="Text message"
          note={isValidPhone(r.phone) ? `15 minutes before a plan block, to ${r.phone}` : 'Enter a valid phone number below to turn this on'}
          on={r.text}
          onChange={(v) => { if (v && !isValidPhone(r.phone)) return; setPref('reminders.text', v); }}
        />
        <div className="s-settings-row">
          <span>Phone number</span>
          <span className="s-settings-val" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
            <input
              className="s-dq-select small"
              type="tel"
              placeholder="(555) 555-0100"
              value={r.phone}
              onChange={(e) => {
                const phone = cleanPhoneInput(e.target.value);
                setPref('reminders.phone', phone);
                if (r.text && !isValidPhone(phone)) setPref('reminders.text', false);
              }}
            />
            {r.phone && !isValidPhone(r.phone) && (
              <span style={{ fontSize: '0.78em', color: 'var(--p-critical)' }}>Enter a valid phone number (10 digits).</span>
            )}
          </span>
        </div>
        <div className="s-settings-row">
          <span>Quiet hours</span>
          <span className="s-settings-val" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <select className="s-dq-select small" value={r.quietFrom} onChange={(e) => setPref('reminders.quietFrom', e.target.value)}>
              {QUIET_HOURS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span>–</span>
            <select className="s-dq-select small" value={r.quietTo} onChange={(e) => setPref('reminders.quietTo', e.target.value)}>
              {QUIET_HOURS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </span>
        </div>
      </section>

      <section className="p-panel">
        <h3>Display</h3>
        <Toggle
          label="Show Calendar in sidebar"
          note="Hide or show the Calendar link. Your calendar events are not changed. Saved in this browser."
          on={prefs.showCalendar !== false}
          onChange={(value) => setPref('showCalendar', value)}
        />
        <div className="s-settings-row">
          <span>Theme</span>
          <span className="p-diff">
            {[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'Match system'],
            ].map(([v, l]) => (
              <button key={v} className={prefs.theme === v ? 'on' : ''} onClick={() => setPref('theme', v)}>{l}</button>
            ))}
          </span>
        </div>
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

        </>
      )}
    </div>
  );
}

/* ---------- instructor ---------- */

export function InstructorSettings({
  course,
  account,
  authenticated = false,
  tab,
  onTab,
  courseScoped = false,
}) {
  const prefs = usePrefs();
  // A course-scoped visit (…/:courseId/settings) lands on Course; otherwise the
  // page opens on Account, which is what the single Settings button points at.
  const requested = tab === 'app' || tab === 'course' || tab === 'account' ? tab : 'account';
  const active = courseScoped ? 'course' : requested;
  const show = !!prefs.showStanding?.[course?.id];

  return (
    <div className="s-settings">
      <div className="s-pagehead">
        <h1>Settings</h1>
        <p>
          {account?.name || 'Instructor account'}
          {account?.email ? ` · ${account.email}` : ''}
        </p>
      </div>

      <SettingsTabs
        active={active}
        onTab={courseScoped ? null : onTab}
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'app', label: 'App' },
          { id: 'course', label: 'Course' },
        ]}
      />

      {active === 'account' && (
        authenticated ? (
          <section className="p-panel">
            <h3>Account profile</h3>
            <AccountProfile />
          </section>
        ) : (
          <section className="p-panel">
            <h3>Account profile</h3>
            <p className="s-settings-p">Sign in to manage your account profile.</p>
          </section>
        )
      )}

      {active === 'app' && (
        <>
      <section className="p-panel">
        <h3>Generation</h3>
        <Toggle label="Instructor approval before students see generated items" note="Cannot be turned off." on onChange={() => {}} />
        <Toggle label="Cite sources on every generated question" note="Requires the doctrine service." on onChange={() => {}} />
      </section>

      {authenticated && (
        <section className="p-panel">
          <h3>Generation model</h3>
          <ModelProviderSettings />
        </section>
      )}

      {authenticated && (
        <section className="p-panel">
          <h3>Doctrine engine</h3>
          <DoctrineSettings />
        </section>
      )}
        </>
      )}

      {active === 'course' && (
        course ? (
          <>
            <p className="s-settings-p">
              These apply to <strong>{course.name}</strong>
              {course.id ? ` (${course.id})` : ''} only.
            </p>
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

          </>
        ) : (
          <section className="p-panel">
            <h3>Course settings</h3>
            <p className="s-settings-p">
              Open a course from the library, then choose Settings to change what its students
              see. Nothing on this tab applies account-wide.
            </p>
          </section>
        )
      )}
    </div>
  );
}
