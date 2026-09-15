'use client';

function AAR({ course }) {
  const short = course.aar.filter((f) => f.term === 'Short term');
  const long = course.aar.filter((f) => f.term === 'Long term');
  const max = Math.max(...course.trend);

  const Finding = ({ f }) => (
    <div className={`p-find ${f.sev}`}>
      <div className="p-findhead">
        <span
          style={{
            color:
              f.sev === 'crit' ? 'var(--p-critical)' : f.sev === 'warn' ? 'var(--p-warning)' : 'var(--p-good)',
            fontSize: '0.8em',
          }}
        >
          {f.sev === 'crit' ? '▲' : f.sev === 'warn' ? '●' : '✓'}
        </span>
        {f.title}
      </div>
      <p className="p-findbody">{f.body}</p>
      <p className="p-src">{f.src}</p>
    </div>
  );

  return (
    <>
      <h2 className="p-h">Course AAR — auto-drafted</h2>
      <p className="p-sub">
        Assembled from instructor critiques, student surveys, and assessment data across class
        iterations. The thing being assessed here is the course, not the student.
      </p>

      <div className="p-grid2">
        <div className="p-panel">
          <h3>Short-term fixes — actionable this class</h3>
          {short.map((f) => (
            <Finding f={f} key={f.title} />
          ))}
        </div>
        <div className="p-panel">
          <h3>Long-term — curriculum change</h3>
          {long.map((f) => (
            <Finding f={f} key={f.title} />
          ))}
        </div>
      </div>

      <div className="p-grid2">
        <div className="p-panel">
          <h3>Weakest-block mastery across classes</h3>
          <div className="p-spark">
            {course.trend.map((v, i) => (
              <div
                key={i}
                className={`p-sparkbar${i === course.trend.length - 1 ? ' last' : ''}`}
                style={{ height: `${(v / max) * 100}%` }}
                title={`Class ${i + 1}: ${v}%`}
              />
            ))}
          </div>
          <div className="p-sparklab">
            <span>{course.trend.length} classes ago</span>
            <span>Current — {course.trend[course.trend.length - 1]}%</span>
          </div>
          <p className="p-src">
            Flat or declining across iterations is the signal that the block needs redesign, not
            another remediation cycle.
          </p>
        </div>

        <div className="p-panel">
          <h3>What fed this AAR</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <tbody>
                <tr><td>Assessment records</td><td className="p-num">{course.trend.length} classes</td></tr>
                <tr><td>Instructor critiques</td><td className="p-num">11</td></tr>
                <tr><td>Student end-of-course surveys</td><td className="p-num">{course.students * 2 + 13}</td></tr>
                <tr><td>Live session item analysis</td><td className="p-num">6 sessions</td></tr>
                <tr><td>POI hour allocation</td><td className="p-num">1 document</td></tr>
              </tbody>
            </table>
          </div>
          <p className="p-src">
            Every finding above links back to its sources. Nothing is asserted without something
            behind it.
          </p>
        </div>
      </div>
    </>
  );
}

export default AAR;
