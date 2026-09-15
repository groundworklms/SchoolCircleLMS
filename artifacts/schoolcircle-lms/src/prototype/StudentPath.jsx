'use client';

import { useState } from 'react';

const COAS = [
  {
    id: 'behind',
    label: 'Behind',
    icon: '▼',
    color: 'var(--p-critical)',
    blurb: 'Catch-up plan. Adds two evening blocks per week and front-loads the weakest topic.',
    plan: [
      ['Mon 1900', 'Fault Isolation — guided walkthrough', '45 min'],
      ['Tue 1900', 'Practice set — 12 questions, adaptive', '30 min'],
      ['Wed 1900', 'Transmission Lines — SWR calculation drill', '30 min'],
      ['Thu 1900', 'Re-test weakest 5 items', '20 min'],
      ['Sat 0900', 'Full-block review', '90 min'],
    ],
  },
  {
    id: 'ontrack',
    label: 'On track',
    icon: '●',
    color: 'var(--p-good)',
    blurb: 'Maintenance plan. Keeps pace with the POI and holds retention with short spaced reviews.',
    plan: [
      ['Tue 1900', 'Spaced review — prior two blocks', '20 min'],
      ['Thu 1900', 'Practice set — 10 questions', '25 min'],
      ['Sun 1000', 'Next-week preview + reading', '40 min'],
    ],
  },
  {
    id: 'ahead',
    label: 'Ahead',
    icon: '▲',
    color: 'var(--p-accent)',
    blurb: 'Extension plan. Protects the lead and adds depth beyond the tested standard.',
    plan: [
      ['Wed 1900', 'Advanced fault scenarios', '45 min'],
      ['Sat 1000', 'Peer-teach a weak-topic block', '60 min'],
    ],
  },
];

function StudentPath({ course }) {
  const [coa, setCoa] = useState('ontrack');
  const active = COAS.find((c) => c.id === coa);
  const weakest = [...course.topics].sort((a, b) => a.mastery - b.mastery)[0];

  return (
    <>
      <h2 className="p-h">My Learning Path</h2>
      <p className="p-sub">
        Built from the course syllabus and the student&apos;s own schedule. Three courses of action,
        because &quot;behind&quot; and &quot;ahead&quot; need different plans — not the same plan at a
        different speed.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Course</div>
          <div className="p-tileval" style={{ fontSize: '1.15em' }}>{course.id}</div>
          <div className="p-tilenote">Week {course.week} of {course.weeks}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Overall mastery</div>
          <div className="p-tileval">
            {Math.round(course.topics.reduce((s, t) => s + t.mastery, 0) / course.topics.length)}%
          </div>
          <div className="p-tilenote">across {course.topics.length} topics</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Weakest topic</div>
          <div className="p-tileval" style={{ fontSize: '1.05em', color: 'var(--p-critical)' }}>
            {weakest.name}
          </div>
          <div className="p-tilenote">{weakest.mastery}% — at risk</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Study time logged</div>
          <div className="p-tileval">6.5<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>h</span></div>
          <div className="p-tilenote">this week</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>Course of action</h3>
        <div className="p-coa">
          {COAS.map((c) => (
            <button
              key={c.id}
              className={`p-coacard${coa === c.id ? ' on' : ''}`}
              onClick={() => setCoa(c.id)}
            >
              <h4>
                <span style={{ color: c.color }}>{c.icon}</span>
                {c.label}
              </h4>
              <p>{c.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="p-grid2">
        <div className="p-panel">
          <h3>Generated plan — {active.label.toLowerCase()}</h3>
          <ul className="p-plan">
            {active.plan.map(([when, task, dur]) => (
              <li className="p-planrow" key={when + task}>
                <span className="p-pldate">{when}</span>
                <span className="p-pltask">{task}</span>
                <span className="p-plnote">{dur}</span>
              </li>
            ))}
          </ul>
          <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
            <button className="p-btn ghost">Push to Outlook</button>
            <button className="p-btn ghost">Email + text reminders</button>
          </div>
        </div>

        <div className="p-panel">
          <h3>My requirements</h3>
          <ul className="p-req">
            {[
              ['Annual cyber awareness', 'Complete', 'var(--p-good)'],
              ['Rank EPME — enrolled', 'In progress', 'var(--p-warning)'],
              ['CY range qualification', 'Due in 22 days', 'var(--p-warning)'],
              ['Course prerequisite packet', 'Complete', 'var(--p-good)'],
              ['FY safety standdown', 'Not started', 'var(--p-critical)'],
            ].map(([name, state, color]) => (
              <li className="p-reqrow" key={name}>
                <span style={{ color, fontSize: '0.8em' }}>●</span>
                <span className="p-reqname">{name}</span>
                <span style={{ color, fontSize: '0.82em' }}>{state}</span>
              </li>
            ))}
          </ul>
          <p className="p-src">Auto-enrolled from CY/FY training and EPME requirements — no manual roster entry.</p>
        </div>
      </div>
    </>
  );
}

export default StudentPath;
