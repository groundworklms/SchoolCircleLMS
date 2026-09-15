'use client';

import { useEffect, useMemo, useState } from 'react';
import { useNarration } from './shared';
import { useDoctrineCourse, itemsOfKind } from './grounded';

const DIFFICULTY = [
  { id: 'basic', label: 'Basic', note: 'Recall and definitions' },
  { id: 'standard', label: 'Standard', note: 'Matches the tested standard' },
  { id: 'challenge', label: 'Challenge', note: 'Application and edge cases' },
];

const KEY_TERMS = {
  'TC32209': [
    ['Sight alignment', 'The relationship between the front and rear sights and the aiming eye.'],
    ['Sight picture', 'The placement of the aligned sights on the target once the sights are aligned.'],
    ['Trigger control', 'Firing the weapon while maintaining aim and stabilization until the bullet leaves the muzzle.'],
    ['Natural point of aim', 'Where the weapon settles on the target with the body relaxed, without muscular correction.'],
    ['Follow-through', 'Holding trigger and position after the shot so the muzzle is not disturbed before the round exits.'],
  ],
  'M092721': [
    ['SWR', 'Ratio of maximum to minimum voltage on a transmission line. A perfect match is 1:1.'],
    ['Reflection coefficient', 'Fraction of incident voltage returned by a mismatch. The square root of the power ratio.'],
    ['Bonding', 'Joining metallic parts to form a low-impedance electrical path.'],
    ['Signal flow', 'Tracing a signal stage by stage to isolate a fault to one component.'],
  ],
  'M09CVS1': [
    ['Proword', 'A word with an assigned meaning, used to speed and standardize net traffic.'],
    ['Net entry', 'The procedure for joining an established radio net.'],
    ['PMCS', 'Preventive maintenance checks and services performed at the operator level.'],
    ['Squelch', 'A circuit that mutes the receiver until a signal of sufficient strength is present.'],
  ],
};

function StudyMaterials({ course }) {
  const [diff, setDiff] = useState('standard');
  const [picked, setPicked] = useState(null);
  const [qi, setQi] = useState(0);
  const narration = useNarration();

  // Real, human-ratified, cited questions from the seeded course DB (issue #8). Each APPROVED
  // QUESTION carries its options, keyed answer, rationale, and Anchor citation. When this course
  // has them we practice on the real bank; otherwise we fall back to the prototype's mock set.
  const { db } = useDoctrineCourse(course.id);
  const groundedQs = useMemo(
    () =>
      itemsOfKind(db, 'QUESTION').map((it) => ({
        q: it.stem,
        answers: (it.options || []).map((text, i) => ({ text, correct: i === it.answer })),
        rationale: it.rationale || '',
        topic: it.section,
        citation: it.citation || null,
        support: it.support,
        grounded: true,
      })),
    [db]
  );
  const questions = groundedQs.length ? groundedQs : course.questions;

  useEffect(() => {
    setPicked(null);
    setQi(0);
  }, [course.id, diff]);

  const q = questions[qi % questions.length];
  const terms = KEY_TERMS[course.id] || [];

  return (
    <>
      <h2 className="p-h">Study Materials</h2>
      <p className="p-sub">
        Generated from the student outline the instructor approved. Practice questions explain why an
        answer is right or wrong — the explanation is the point, not the score.
      </p>

      <div className="p-grid2">
        <div className="p-panel">
          <h3>
            Study guide — generated from {course.outline}
            {narration.supported && (
              <button
                className="p-btn ghost"
                style={{ float: 'right', fontSize: '0.9em', padding: '0.15rem 0.6rem', textTransform: 'none', letterSpacing: 0 }}
                onClick={() =>
                  narration.speak(
                    `Study guide for ${course.name}. ` +
                      terms.map(([t, d]) => `${t}. ${d}`).join(' ') +
                      ' Objectives. ' +
                      course.objectives.join('. ')
                  )
                }
              >
                {narration.speaking ? '■ Stop' : '▶ Listen'}
              </button>
            )}
          </h3>
          <div className="p-guide">
            <h4>What this block covers</h4>
            <p>
              {course.objectives.length} learning objectives drawn from {course.sourceDoc}, organized
              into a reading order rather than the order they appear in the POI.
            </p>
            <h4>Key terms</h4>
            {terms.map(([t, d]) => (
              <div className="p-keyterm" key={t}>
                <b>{t}</b>
                <span>{d}</span>
              </div>
            ))}
            <h4>Objectives</h4>
            <ul style={{ margin: '0.3em 0', paddingLeft: '1.15em' }}>
              {course.objectives.map((o, i) => (
                <li key={o} style={{ color: 'var(--p-dim)', margin: '0.2em 0' }}>
                  {o}
                  <span className="p-cite">{course.references[i % course.references.length].tag}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="p-src">Instructor-approved 12 Sep. Students never see unreviewed material.</p>
        </div>

        <div className="p-panel">
          <h3>
            Practice
            {groundedQs.length > 0 && (
              <span
                className="p-cite"
                style={{ marginLeft: '0.5rem', background: 'var(--p-accent-tint)', color: 'var(--p-accent)', border: 'none' }}
              >
                ✓ Grounded · approved question bank
              </span>
            )}
            <span style={{ float: 'right' }}>
              <span className="p-diff">
                {DIFFICULTY.map((d) => (
                  <button key={d.id} className={diff === d.id ? 'on' : ''} onClick={() => setDiff(d.id)}>
                    {d.label}
                  </button>
                ))}
              </span>
            </span>
          </h3>
          <p style={{ fontSize: '0.8em', color: 'var(--p-faint)', margin: '0 0 0.8rem' }}>
            {DIFFICULTY.find((d) => d.id === diff).note}
          </p>

          <p style={{ fontSize: '1.02em', margin: '0 0 0.8rem', lineHeight: 1.4 }}>{q.q}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {q.answers.map((a, i) => {
              let cls = '';
              if (picked !== null) {
                if (a.correct) cls = ' correct';
                else if (i === picked) cls = ' wrong';
              }
              return (
                <button
                  key={a.text}
                  className={`p-ans${cls}`}
                  disabled={picked !== null}
                  onClick={() => setPicked(i)}
                  style={{ fontSize: '0.9em', padding: '0.6rem 0.75rem' }}
                >
                  <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
                  <span>{a.text}</span>
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <>
              <div className="p-rationale">
                <span className="p-rlab">
                  {q.answers[picked].correct ? 'Correct — here is why' : 'Not quite — here is why'}
                </span>
                {q.rationale}
              </div>
              {q.citation && (
                <div className="s-gkp-passage" style={{ marginTop: '0.6rem' }}>
                  <div className="s-gkp-loc">
                    <span><b>Source</b> {q.citation.citation}</span>
                    {q.citation.page && <span><b>Page</b> {q.citation.page}</span>}
                    {typeof q.support === 'number' && (
                      <span><b>HHEM support</b> {(q.support * 100).toFixed(0)}%</span>
                    )}
                  </div>
                </div>
              )}
              <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
                <button
                  className="p-btn"
                  onClick={() => {
                    setQi(qi + 1);
                    setPicked(null);
                  }}
                >
                  Next question
                </button>
                <span style={{ fontSize: '0.82em', color: 'var(--p-faint)' }}>Topic: {q.topic}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default StudyMaterials;
