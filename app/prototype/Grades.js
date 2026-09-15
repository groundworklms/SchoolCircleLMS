'use client';

import { usePrefs } from './prefs';

/* Student · Grades. The formal record: current grade and class standing per
   annex, and the counseling that went with it. Standing is shown when the
   instructor has turned it on for this course (Settings, instructor side).
   The student sees their own rank only — never other students' scores. */

const GRADES = {
  M092721: {
    scale: [['A', 90], ['B', 80], ['C', 70], ['F', 0]],
    passing: 70,
    weights: [
      ['Written exams', 50],
      ['Performance exams', 30],
      ['Assignments', 20],
    ],
    annexes: [
      { letter: 'A', title: 'DC Fundamentals', grade: 91.4, standing: 5, of: 24, counseled: '21 Aug 2026', by: 'SSgt Okafor', remark: 'Solid start. Watch the arithmetic on series-parallel — two careless errors on the written.' },
      { letter: 'B', title: 'AC Fundamentals', grade: null, standing: null, of: 24, counseled: null, by: null, remark: null, current: true, running: 84.0 },
      { letter: 'C', title: 'Power Supplies', grade: null, of: 24 },
      { letter: 'D', title: 'Switching Regulator', grade: null, of: 24 },
      { letter: 'E', title: 'Network Fundamentals', grade: null, of: 24 },
      { letter: 'F', title: 'Cable Termination', grade: null, of: 24 },
    ],
    overall: 88.7,
    standing: 6,
    of: 24,
  },
  M09CVS1: {
    scale: [['A', 90], ['B', 80], ['C', 70], ['F', 0]],
    passing: 70,
    weights: [
      ['Written exams', 40],
      ['Practical evaluations', 40],
      ['Assignments', 20],
    ],
    annexes: [
      { letter: 'A', title: 'Network Fundamentals', grade: 87.5, standing: 9, of: 31, counseled: '5 Sep 2026', by: 'Sgt Delgado', remark: 'Good on theory. Slow on the practical — speed comes with reps.' },
      { letter: 'B', title: 'Configuring Networks', grade: null, standing: null, of: 31, current: true, running: 79.2 },
      { letter: 'C', title: 'Network Security', grade: null, of: 31 },
      { letter: 'D', title: 'Network Maintenance', grade: null, of: 31 },
    ],
    overall: 84.1,
    standing: 12,
    of: 31,
  },
};

function letter(scale, g) {
  if (g == null) return '—';
  return scale.find(([, min]) => g >= min)?.[0] || 'F';
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Grades({ course }) {
  const prefs = usePrefs();
  const g = GRADES[course.id];
  const showStanding = !!prefs.showStanding?.[course.id];
  const done = g.annexes.filter((a) => a.grade != null);
  const cur = g.annexes.find((a) => a.current);

  return (
    <>
      <h2 className="p-h">Grades</h2>
      <p className="p-sub">
        Your grade and standing, annex by annex, with the counseling that went with each. Standing is your own rank —
        you never see anyone else&apos;s scores.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Current grade</div>
          <div className="p-tileval">
            {g.overall.toFixed(1)}
            <span style={{ fontSize: '0.5em', color: 'var(--p-dim)', marginLeft: '0.3rem' }}>{letter(g.scale, g.overall)}</span>
          </div>
          <div className="p-tilenote">{done.length} of {g.annexes.length} annexes graded</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Class standing</div>
          {showStanding ? (
            <>
              <div className="p-tileval">{ordinal(g.standing)}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}> of {g.of}</span></div>
              <div className="p-tilenote">as of the last graded annex</div>
            </>
          ) : (
            <>
              <div className="p-tileval" style={{ fontSize: '1.1em', color: 'var(--p-faint)' }}>Not shown</div>
              <div className="p-tilenote">Your instructor shares standing at counseling for this course.</div>
            </>
          )}
        </div>
        <div className="p-tile">
          <div className="p-tilelab">This annex so far</div>
          <div className="p-tileval">{cur ? cur.running.toFixed(1) : '—'}</div>
          <div className="p-tilenote">{cur ? `Annex ${cur.letter} · not yet final` : ''}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">To pass</div>
          <div className="p-tileval">{g.passing}</div>
          <div className="p-tilenote">course minimum</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>By annex</h3>
        <div className="p-tablewrap">
          <table className="p-table s-grades">
            <thead>
              <tr>
                <th>Annex</th>
                <th className="p-num">Grade</th>
                {showStanding && <th className="p-num">Standing</th>}
                <th>Counseled</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {g.annexes.map((a) => (
                <tr key={a.letter} className={a.current ? 'current' : a.grade == null ? 'upcoming' : ''}>
                  <td>
                    <span className="s-grades-letter">{a.letter}</span> {a.title}
                    {a.current && <span className="s-grades-now">In progress</span>}
                  </td>
                  <td className="p-num">
                    {a.grade != null ? (
                      <>
                        <b>{a.grade.toFixed(1)}</b> <span style={{ color: 'var(--p-faint)' }}>{letter(g.scale, a.grade)}</span>
                      </>
                    ) : a.current ? (
                      <span style={{ color: 'var(--p-faint)' }}>{a.running.toFixed(1)} so far</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {showStanding && (
                    <td className="p-num">{a.standing ? `${ordinal(a.standing)} of ${a.of}` : '—'}</td>
                  )}
                  <td>
                    {a.counseled ? (
                      <>
                        {a.counseled}
                        <div style={{ fontSize: '0.85em', color: 'var(--p-faint)' }}>{a.by}</div>
                      </>
                    ) : a.current ? (
                      <span style={{ color: 'var(--p-faint)' }}>After the annex exam</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="s-grades-remark">{a.remark || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-src">
          Counseling happens within two training days of each annex exam. If you disagree with a grade, say so at counseling —
          the remark records both sides.
        </p>
      </div>

      <div className="p-grid2">
        <div className="p-panel">
          <h3>How the grade is built</h3>
          <ul className="p-plan">
            {g.weights.map(([name, w]) => (
              <li className="p-planrow" key={name}>
                <span className="p-pldate">{w}%</span>
                <span className="p-pltask">{name}</span>
                <span className="p-plnote" />
              </li>
            ))}
          </ul>
        </div>
        <div className="p-panel">
          <h3>Scale</h3>
          <ul className="p-plan">
            {g.scale.map(([l, min], i) => (
              <li className="p-planrow" key={l}>
                <span className="p-pldate">{l}</span>
                <span className="p-pltask">{i === g.scale.length - 1 ? `below ${g.scale[i - 1][1]}` : `${min} and above`}</span>
                <span className="p-plnote">{min >= g.passing ? '' : 'not passing'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

export default Grades;
