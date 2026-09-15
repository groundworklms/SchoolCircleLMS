'use client';

import { useEffect, useState } from 'react';
import { band } from './shared';

const RESP_WEIGHTS = [0.55, 0.18, 0.14, 0.13];

function distribution(q, answered) {
  const ci = q.answers.findIndex((a) => a.correct);
  const others = q.answers.map((_, i) => i).filter((i) => i !== ci);
  const counts = new Array(q.answers.length).fill(0);
  counts[ci] = Math.round(answered * RESP_WEIGHTS[0]);
  others.forEach((idx, k) => {
    counts[idx] = Math.round(answered * (RESP_WEIGHTS[k + 1] || 0));
  });
  // reconcile rounding so the parts sum to the whole
  const drift = answered - counts.reduce((a, b) => a + b, 0);
  if (others.length) counts[others[others.length - 1]] += drift;
  return counts.map((c) => Math.max(0, c));
}

function LiveControl({ course }) {
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [qi, setQi] = useState(0);

  const total = course.students;
  const q = course.questions[qi];

  useEffect(() => {
    setRunning(false);
    setRevealed(false);
    setAnswered(0);
    setQi(0);
  }, [course.id]);

  useEffect(() => {
    if (!running || revealed) return;
    if (answered >= total) {
      setRevealed(true);
      return;
    }
    const t = setTimeout(() => setAnswered((a) => Math.min(total, a + 1)), 140);
    return () => clearTimeout(t);
  }, [running, revealed, answered, total]);

  const counts = distribution(q, answered);
  const correctIdx = q.answers.findIndex((a) => a.correct);
  const pctCorrect = answered ? Math.round((counts[correctIdx] / answered) * 100) : 0;

  const nextQ = () => {
    setQi((i) => (i + 1) % course.questions.length);
    setAnswered(0);
    setRevealed(false);
    setRunning(true);
  };

  return (
    <>
      <h2 className="p-h">Run Live Session</h2>
      <p className="p-sub">
        The instructor side of the classroom game. Push a question to the room, watch responses land,
        and see whether the block landed — before the end-of-course test says so.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Session</div>
          <div className="p-tileval" style={{ fontSize: '1.05em', color: running ? 'var(--p-critical)' : 'var(--p-dim)' }}>
            {running ? (
              <>
                <span className="p-pulse" /> LIVE
              </>
            ) : (
              'Idle'
            )}
          </div>
          <div className="p-tilenote">
            {course.id} · week {course.week}
          </div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Responded</div>
          <div className="p-tileval">
            {answered}
            <span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{total}</span>
          </div>
          <div className="p-tilenote">students in room</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Correct</div>
          <div className="p-tileval" style={{ color: revealed ? band(pctCorrect).color : 'var(--p-dim)' }}>
            {revealed ? `${pctCorrect}%` : '—'}
          </div>
          <div className="p-tilenote">{revealed ? band(pctCorrect).label.toLowerCase() : 'hidden until all in'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Question</div>
          <div className="p-tileval">
            {qi + 1}
            <span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{course.questions.length}</span>
          </div>
          <div className="p-tilenote">{q.topic}</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>On the classroom screen</h3>
        <p style={{ fontSize: '1.05em', margin: '0 0 0.9rem', lineHeight: 1.4 }}>{q.q}</p>

        <div className="p-respbar">
          {q.answers.map((a, i) => (
            <div className="p-resprow" key={a.text}>
              <span className="p-respkey">{String.fromCharCode(65 + i)}</span>
              <div className="p-resptrack">
                <div
                  className={`p-respfill${revealed && a.correct ? ' right' : ''}`}
                  style={{ width: answered ? `${(counts[i] / total) * 100}%` : '0%' }}
                />
                <span className="p-resptext">
                  <span>{revealed ? a.text : '• • •'}</span>
                  {revealed && a.correct && <span style={{ color: 'var(--p-good)', fontSize: '0.8em' }}>CORRECT</span>}
                </span>
              </div>
              <span className="p-num" style={{ fontSize: '0.85em', color: 'var(--p-dim)' }}>
                {revealed ? counts[i] : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="p-btnrow" style={{ marginTop: '1rem' }}>
          {!running && answered === 0 && (
            <button className="p-btn" onClick={() => setRunning(true)}>
              Push question to room
            </button>
          )}
          {running && !revealed && (
            <button className="p-btn ghost" onClick={() => setRevealed(true)}>
              Close early &amp; reveal
            </button>
          )}
          {revealed && (
            <button className="p-btn" onClick={nextQ}>
              Next question
            </button>
          )}
          {revealed && (
            <span style={{ fontSize: '0.85em', color: 'var(--p-dim)' }}>
              Written to the class record — feeds Class Mastery and the Course AAR.
            </span>
          )}
        </div>
      </div>

      {revealed && pctCorrect < 65 && (
        <div className="p-panel">
          <h3>Suggested action</h3>
          <div className="p-find crit">
            <div className="p-findhead">
              <span style={{ color: 'var(--p-critical)', fontSize: '0.8em' }}>▲</span>
              {pctCorrect}% correct on {q.topic} — below the 65% threshold
            </div>
            <p className="p-findbody">
              A 10-minute review of this topic is drafted and waiting in your queue. You decide whether
              to run it.
            </p>
          </div>
          <div className="p-btnrow">
            <button className="p-btn ghost">Review draft</button>
            <button className="p-btn ghost">Dismiss</button>
          </div>
        </div>
      )}
    </>
  );
}

export default LiveControl;
