'use client';

import { useEffect, useState } from 'react';
import { LEADERBOARD } from './data';

function LiveSession({ course }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [time, setTime] = useState(20);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const questions = course.questions;
  const q = questions[idx];

  useEffect(() => {
    setIdx(0);
    setPicked(null);
    setTime(20);
    setScore(0);
    setFinished(false);
  }, [course.id]);

  useEffect(() => {
    if (picked !== null || finished) return;
    if (time <= 0) {
      setPicked(-1); // timed out
      return;
    }
    const t = setTimeout(() => setTime((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [time, picked, finished]);

  const pick = (i) => {
    if (picked !== null) return;
    setPicked(i);
    if (q.answers[i].correct) setScore((s) => s + 700 + time * 15);
  };

  const next = () => {
    if (idx + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    setTime(20);
  };

  const restart = () => {
    setIdx(0);
    setPicked(null);
    setTime(20);
    setScore(0);
    setFinished(false);
  };

  if (finished) {
    const board = [...LEADERBOARD.filter((r) => !r.you), { name: 'You', score, you: true }].sort(
      (a, b) => b.score - a.score
    );
    return (
      <>
        <h2 className="p-h">Session complete</h2>
        <p className="p-sub">
          Every answer just became data — it feeds the mastery view and the course AAR without anyone
          filling out a form.
        </p>
        <div className="p-grid2">
          <div className="p-panel">
            <h3>Leaderboard</h3>
            <ul className="p-lead">
              {board.map((r, i) => (
                <li className={`p-leadrow${r.you ? ' you' : ''}`} key={r.name}>
                  <span className="p-rank">{i + 1}</span>
                  <span>{r.name}</span>
                  <span className="p-num">{r.score.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="p-panel">
            <h3>What the instructor sees</h3>
            <p className="p-findbody">
              Live item analysis is written straight to the class record. Topics where the room
              underperformed are queued for review before the next block — not discovered at the
              end-of-course test.
            </p>
            <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
              <button className="p-btn" onClick={restart}>Run again</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const timedOut = picked === -1;

  return (
    <div className="p-quiz">
      <h2 className="p-h">Live Session</h2>
      <p className="p-sub">
        Class-wide competitive review, run off the approved question bank. Same questions, same
        rationale — delivered as a game instead of a worksheet.
      </p>

      <div className="p-qhead">
        <span className="p-qcount">
          Question {idx + 1} of {questions.length}
        </span>
        <span className="p-tag">{q.topic}</span>
        <span className="p-timer">{picked === null ? `0:${String(time).padStart(2, '0')}` : '—'}</span>
      </div>

      <p className="p-qtext">{q.q}</p>

      <div className="p-answers">
        {q.answers.map((a, i) => {
          let cls = '';
          if (picked !== null) {
            if (a.correct) cls = ' correct';
            else if (i === picked) cls = ' wrong';
          }
          return (
            <button key={a.text} className={`p-ans${cls}`} disabled={picked !== null} onClick={() => pick(i)}>
              <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
              <span>{a.text}</span>
              {picked !== null && a.correct && <span className="p-ansmark" style={{ color: 'var(--p-good)' }}>CORRECT</span>}
              {picked !== null && !a.correct && i === picked && (
                <span className="p-ansmark" style={{ color: 'var(--p-critical)' }}>YOUR ANSWER</span>
              )}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <>
          <div className="p-rationale">
            <span className="p-rlab">{timedOut ? 'Time expired — why the answer is what it is' : 'Why'}</span>
            {q.rationale}
          </div>
          <div className="p-btnrow" style={{ marginTop: '0.9rem' }}>
            <button className="p-btn" onClick={next}>
              {idx + 1 >= questions.length ? 'Finish' : 'Next question'}
            </button>
            <span style={{ fontSize: '0.85em', color: 'var(--p-dim)' }}>
              Score {score.toLocaleString()}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default LiveSession;
