'use client';

import { MasteryPanel } from './shared';
import { POIS } from './poi';
import { useApiQuery } from '../_learning/useLearning';

/* ---------- real course: Sextant cohort analytics ---------- */

function Insufficient({ evidence, what }) {
  return (
    <div className="p-panel">
      <h3>{what}</h3>
      <p className="p-src">
        {evidence?.reason || `Not enough evidence yet to show ${what.toLowerCase()}.`}
        {Number.isInteger(evidence?.observedLearners) && ` Observed learners: ${evidence.observedLearners} of ${evidence.minimumLearners}.`}
        {Number.isInteger(evidence?.observedContributors) && ` Contributors: ${evidence.observedContributors} of ${evidence.minimumContributors}.`}
      </p>
    </div>
  );
}

function pct(v) {
  return typeof v === 'number' ? `${Math.round(v <= 1 ? v * 100 : v)}%` : '—';
}

/* Class mastery from persisted Whetstone reports and attempts. Every
   aggregate is suppressed below five distinct learners on the server — this
   screen shows what came back and never fills a gap with a number. */
function CohortMastery({ course }) {
  const { data, loading, error } = useApiQuery(`/analytics/cohort?courseId=${course.id}`);

  if (loading) return <p>Loading class evidence…</p>;
  if (error) {
    return (
      <p className="s-shell-error" role="alert">
        {error.error || error.message || 'Could not load class analytics.'}
      </p>
    );
  }
  if (!data) return null;

  const { gain, gaps, mastery, privacy } = data;
  const masteryRows = Array.isArray(mastery) ? mastery : null;
  const gapRows = Array.isArray(gaps) ? gaps : [];

  return (
    <>
      <h2 className="p-h">Class mastery</h2>
      <p className="p-sub">
        From saved mastery sessions and attempts for this course. Aggregates appear only once
        {privacy?.cohortSuppressedBelow ? ` ${privacy.cohortSuppressedBelow}` : ' enough'} distinct learners have contributed — never any one Marine&apos;s answers.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Learners observed</div>
          <div className="p-tileval">{privacy?.observedLearners ?? '—'}</div>
          <div className="p-tilenote">with saved evidence</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Learning gain</div>
          <div className="p-tileval">{gain?.status === 'insufficient_evidence' ? '—' : pct(gain?.overall?.normalizedGain ?? gain?.overall?.gain)}</div>
          <div className="p-tilenote">{gain?.status === 'insufficient_evidence' ? 'insufficient evidence' : 'pre → post'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Gaps flagged</div>
          <div className="p-tileval" style={{ color: gapRows.length ? 'var(--p-warning)' : 'var(--p-good)' }}>{gapRows.length}</div>
          <div className="p-tilenote">objectives below threshold</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Competencies</div>
          <div className="p-tileval">{masteryRows ? masteryRows.length : '—'}</div>
          <div className="p-tilenote">with enough contributors</div>
        </div>
      </div>

      {masteryRows ? (
        <div className="p-panel">
          <h3>Mastery by competency</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Competency</th>
                  <th className="p-num">Mastered</th>
                  <th className="p-num">Competent</th>
                  <th className="p-num">Developing</th>
                  <th className="p-num">Mastered rate</th>
                </tr>
              </thead>
              <tbody>
                {masteryRows.map((row, i) => (
                  <tr key={row.competency || i}>
                    <td>{row.competency || `Competency ${i + 1}`}</td>
                    <td className="p-num">{row.mastered ?? '—'}</td>
                    <td className="p-num">{row.competent ?? '—'}</td>
                    <td className="p-num">{row.developing ?? '—'}</td>
                    <td className="p-num" style={{ color: row.masteredRate < 0.65 ? 'var(--p-critical)' : 'var(--p-good)' }}>{pct(row.masteredRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Insufficient evidence={mastery?.status ? mastery : data.evidence?.mastery} what="Mastery by competency" />
      )}

      {gapRows.length > 0 && (
        <div className="p-panel">
          <h3>Class gaps — queued for lesson review</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr>
                  <th>Objective</th>
                  <th className="p-num">Missed</th>
                  <th className="p-num">Attempts</th>
                  <th className="p-num">Learners</th>
                </tr>
              </thead>
              <tbody>
                {gapRows.map((g, i) => (
                  <tr key={g.objective || i}>
                    <td>{g.objective}</td>
                    <td className="p-num" style={{ color: g.missRate >= 0.6 ? 'var(--p-critical)' : 'var(--p-warning)' }}>{pct(g.missRate)}</td>
                    <td className="p-num">{g.attempts ?? '—'}</td>
                    <td className="p-num">{g.cohort ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="p-src">
            Sextant ranks the objectives the class misses most. The instructor decides what to re-teach.
          </p>
        </div>
      )}

      {gain?.status === 'insufficient_evidence' && <Insufficient evidence={gain} what="Learning gain" />}
    </>
  );
}

/* ---------- mock course: the demo numbers ---------- */

function Mastery({ course }) {
  if (course.record) return <CohortMastery course={course} />;

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
