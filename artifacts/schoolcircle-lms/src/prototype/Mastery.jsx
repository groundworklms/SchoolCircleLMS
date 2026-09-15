'use client';

import { MasteryPanel } from './shared';
import { POIS } from './poi';

function Mastery({ course }) {
  const avg = Math.round(course.topics.reduce((s, t) => s + t.mastery, 0) / course.topics.length);
  const atRisk = course.topics.filter((t) => t.mastery < 65);

  return (
    <>
      <h2 className="p-h">Mastery &amp; Insights</h2>
      <p className="p-sub">
        Curriculum mastery by topic for the current class. The point is not the score — it is that the
        weak block is visible while there is still time to do something about it.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Class average</div>
          <div className="p-tileval">{avg}%</div>
          <div className="p-tilenote">{course.students} students</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Topics at risk</div>
          <div className="p-tileval" style={{ color: atRisk.length ? 'var(--p-critical)' : 'var(--p-good)' }}>
            {atRisk.length}
          </div>
          <div className="p-tilenote">below 65%</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Course progress</div>
          <div className="p-tileval">
            {course.week}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{course.weeks}</span>
          </div>
          <div className="p-tilenote">weeks</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Items flagged</div>
          <div className="p-tileval" style={{ color: 'var(--p-warning)' }}>{course.missed.length}</div>
          <div className="p-tilenote">for review</div>
        </div>
      </div>

      <MasteryPanel
        title="Mastery by annex"
        topics={POIS[course.id].mastery.map((m) => ({ name: `${m.letter} — ${m.title}`, mastery: m.mastery }))}
      />

      <div className="p-panel">
        <h3>Most-missed items — queued for lesson review</h3>
        <div className="p-tablewrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Topic</th>
                <th className="p-num">Missed</th>
                <th>Likely reason</th>
              </tr>
            </thead>
            <tbody>
              {course.missed.map((m) => (
                <tr key={m.q}>
                  <td>{m.q}</td>
                  <td>{m.topic}</td>
                  <td className="p-num" style={{ color: m.pct >= 60 ? 'var(--p-critical)' : 'var(--p-warning)' }}>
                    {m.pct}%
                  </td>
                  <td>{m.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-src">
          Drafted from item analysis. The instructor decides what to re-teach — the platform only
          brings it to the top of the pile.
        </p>
      </div>
    </>
  );
}

export default Mastery;
