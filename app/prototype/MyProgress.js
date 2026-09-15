'use client';

import { useMemo } from 'react';
import { band, MasteryPanel } from './shared';

// Fixed offsets so one student reads differently from the class average,
// without randomness (which would break SSR hydration).
const MY_OFFSETS = [-3, 6, -9, 4, -14, 8, -6, 11];

function MyProgress({ course }) {
  const mine = useMemo(
    () =>
      course.topics.map((t, i) => ({
        name: t.name,
        mastery: Math.max(5, Math.min(100, t.mastery + MY_OFFSETS[i % MY_OFFSETS.length])),
      })),
    [course.topics]
  );

  const avg = Math.round(mine.reduce((s, t) => s + t.mastery, 0) / mine.length);
  const classAvg = Math.round(course.topics.reduce((s, t) => s + t.mastery, 0) / course.topics.length);
  const weak = [...mine].sort((a, b) => a.mastery - b.mastery).slice(0, 3);
  const delta = avg - classAvg;

  return (
    <>
      <h2 className="p-h">My Progress</h2>
      <p className="p-sub">
        The student&apos;s own mastery — not the class roster. A Marine can see where they stand without
        seeing anyone else&apos;s scores.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">My average</div>
          <div className="p-tileval">{avg}%</div>
          <div className="p-tilenote" style={{ color: delta >= 0 ? 'var(--p-good)' : 'var(--p-warning)' }}>
            {delta >= 0 ? '+' : ''}
            {delta} pts vs class
          </div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Weakest topic</div>
          <div className="p-tileval" style={{ fontSize: '1.02em', color: band(weak[0].mastery).color }}>
            {weak[0].name}
          </div>
          <div className="p-tilenote">
            {weak[0].mastery}% — {band(weak[0].mastery).label.toLowerCase()}
          </div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Practice sets done</div>
          <div className="p-tileval">14</div>
          <div className="p-tilenote">this course</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Course progress</div>
          <div className="p-tileval">
            {course.week}
            <span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{course.weeks}</span>
          </div>
          <div className="p-tilenote">weeks</div>
        </div>
      </div>

      <MasteryPanel
        title="My mastery by topic"
        topics={mine}
        note="Visible to the student and to their instructor. Not visible to other students."
      />

      <div className="p-panel">
        <h3>What to work on next</h3>
        <ul className="p-plan">
          {weak.map((t, i) => (
            <li className="p-planrow" key={t.name}>
              <span className="p-pldate">Priority {i + 1}</span>
              <span className="p-pltask">
                {t.name}
                <span style={{ color: 'var(--p-faint)', fontSize: '0.9em' }}> — {t.mastery}%</span>
              </span>
              <span className="p-plnote">
                <button className="p-btn ghost" style={{ fontSize: '0.85em', padding: '0.15rem 0.6rem' }}>
                  Practice set
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default MyProgress;
