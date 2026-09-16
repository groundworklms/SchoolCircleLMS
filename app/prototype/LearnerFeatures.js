'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import { SourceViewer } from './SourceViewer';

/* Learner-side arsenal features for a real (LearningRecord) course: the
   approved course as a reader, Whetstone mastery sessions, the Cadence study
   plan, Sextant progress and the Waypoint learning profile. Everything shown
   here came through an instructor's approval on the server — this UI never
   sees pending material, and it never fills a gap with a demo number. */

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

function Err({ msg }) {
  return msg ? <p className="s-shell-error" role="alert">{msg}</p> : null;
}

function pct(v) {
  return typeof v === 'number' ? `${Math.round(v <= 1 ? v * 100 : v)}%` : '—';
}

/* ---------- course home ---------- */

export function RealCourseHome({ course, go }) {
  const { data: envelope, loading } = useApiQuery(`/courses/${course.id}`);
  const draft = envelope?.course;
  const sections = draft?.sections || [];
  const objectives = draft?.objectives || [];
  const sourceId = draft?.sourceIds?.[0];

  return (
    <div className="s-two">
      <div>
        <div className="s-pagehead">
          <h1>{course.name}</h1>
          <p>{course.school}</p>
        </div>

        <div className="s-hero">
          <div className="s-hero-tile wide">
            <div className="s-label">Course</div>
            <div className="s-hero-num">
              {sections.length} <span>sections</span>
            </div>
            <div className="s-hero-sub">Drafted from the approved source and reviewed by your instructor.</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Items</div>
            <div className="s-hero-num">{sections.reduce((n, s) => n + (s.pre?.length || 0) + (s.post?.length || 0), 0)}</div>
            <div className="s-hero-sub">pre and post checks</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Grounding</div>
            <div className="s-hero-num small" style={{ color: 'var(--p-good)' }}>Cited</div>
            <div className="s-hero-sub">every item traces to the source</div>
          </div>
        </div>

        {sections[0] && (
          <button className="s-continue" onClick={() => go('lessons')}>
            <span className="s-continue-body">
              <span className="s-continue-lab">Start with</span>
              <span className="s-continue-title">{sections[0].title || 'Section 1'}</span>
              <span className="s-continue-meta">Section 1 of {sections.length}</span>
            </span>
            <span className="s-continue-btn">Open lesson</span>
          </button>
        )}

        <h4 className="s-label">In this course</h4>
        <div className="s-quick">
          {[
            ['lessons', 'Lessons', 'The approved course, section by section, with its pre and post checks.'],
            ['mastery', 'Mastery session', 'Whetstone asks, you answer in your own words, it grades against the source.'],
            ['path', 'Learning Path', 'Three courses of action from the syllabus and your available time.'],
            ['progress', 'My Progress', 'What your saved sessions show. Yours only.'],
          ].map(([id, t, d]) => (
            <button className="s-quick-btn" key={id} onClick={() => go(id)}>
              <span className="s-quick-t">{t}</span>
              <span className="s-quick-d">{d}</span>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
        </div>

        {objectives.length > 0 && (
          <>
            <h4 className="s-label">Objectives</h4>
            <ol className="s-obj">
              {objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ol>
          </>
        )}
        {loading && <p>Loading course…</p>}
      </div>

      <aside className="s-agenda">
        {sourceId && <SourceViewer sourceId={sourceId} compact />}
      </aside>
    </div>
  );
}

/* ---------- reader ---------- */

/* The approved course, one section at a time. The server has already
   removed answer keys and rationale for learners; the checks are here to
   think with, and Whetstone is where grading happens. */
export function CourseReader({ course }) {
  const { data: envelope, loading, error } = useApiQuery(`/courses/${course.id}`);
  const [i, setI] = useState(0);
  const sections = envelope?.course?.sections || [];
  const cur = sections[i];

  if (loading) return <p>Loading course…</p>;
  if (error) return <Err msg={errText(error, 'Could not load this course.')} />;
  if (!sections.length) return <p className="p-src">This course has no sections yet.</p>;

  return (
    <div className="s-reader">
      <aside className="s-reader-toc">
        <h4 className="s-label">Sections</h4>
        <ol className="s-reader-list">
          {sections.map((s, j) => (
            <li key={s.title || j}>
              <button className={`s-reader-row${j === i ? ' on' : ''}`} onClick={() => setI(j)}>
                <span className="s-reader-id">{j + 1}</span>
                <span className="s-reader-title">{s.title || `Section ${j + 1}`}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <article className="s-reader-body">
        <div className="s-reader-head">
          <span className="s-reader-kicker">Section {i + 1} of {sections.length}</span>
          <h2>{cur.title || `Section ${i + 1}`}</h2>
        </div>
        {cur.lesson ? <p className="s-reader-p" style={{ whiteSpace: 'pre-wrap' }}>{cur.lesson}</p> : <p className="p-src">No lesson text in this section.</p>}

        {[['pre', 'Before you read — check yourself'], ['post', 'After — check yourself']].map(([k, label]) =>
          cur[k]?.length ? (
            <div className="p-panel" key={k}>
              <h3>{label}</h3>
              <ol className="s-obj">
                {cur[k].map((q, qi) => (
                  <li key={qi}>
                    {q.stem}
                    {Array.isArray(q.options) && (
                      <ul className="s-draft-opts">
                        {q.options.map((o, oi) => (
                          <li key={oi}>{typeof o === 'string' ? o : o.text}</li>
                        ))}
                      </ul>
                    )}
                    {q.citation && (
                      <span className="p-src"> {typeof q.citation === 'string' ? q.citation : q.citation.citation}</span>
                    )}
                  </li>
                ))}
              </ol>
              <p className="p-src">Answer keys stay with your instructor. Grading happens in a mastery session.</p>
            </div>
          ) : null,
        )}

        <div className="s-reader-nav">
          <button className="s-lesson-navbtn" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</button>
          <button className="s-lesson-navbtn" disabled={i >= sections.length - 1} onClick={() => setI(i + 1)}>Next →</button>
        </div>
      </article>
    </div>
  );
}

/* ---------- mastery (Whetstone) ---------- */

export function MasterySession({ course }) {
  const { data: envelope } = useApiQuery(`/courses/${course.id}`);
  const sourceId = envelope?.course?.sourceIds?.[0];
  const { data: sessions, loading, refetch } = useApiQuery(`/mastery/sessions?courseId=${course.id}`);
  const startSession = useApiMutation('/mastery/sessions', 'POST');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null); // last turn's { verdict, feedback }
  const inputRef = useRef(null);

  const active = sessions?.find((s) => s.status === 'ACTIVE') || null;
  const done = (sessions || []).filter((s) => s.status === 'COMPLETE');
  const turn = useApiMutation(`/mastery/sessions/${active?.id}/turn`, 'POST');

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus();
  }, [active?.id, active?.currentQuestion]);

  const handleStart = async () => {
    setErr(null);
    setLast(null);
    if (!sourceId) return setErr('This course has no source document to grade against.');
    try {
      await startSession.mutate({ sourceId, courseId: course.id });
      refetch();
    } catch (e) {
      setErr(errText(e, 'Could not start the session'));
    }
  };

  const handleTurn = async () => {
    if (!answer.trim() || !active || turn.loading) return;
    setErr(null);
    try {
      const res = await turn.mutate({ answer });
      setLast(res.result || null);
      setAnswer('');
      refetch();
    } catch (e) {
      if (e?.code === 'CONFLICT') {
        setErr('This session changed elsewhere — refreshed to the latest state.');
        refetch();
      } else {
        setErr(errText(e, 'Could not submit the answer'));
      }
    }
  };

  const verdictColor = (v) =>
    v === 'mastered' ? 'var(--p-good)' : v === 'competent' ? 'var(--p-accent)' : v === 'developing' ? 'var(--p-warning)' : 'var(--p-dim)';

  return (
    <>
      <h2 className="p-h">Mastery session</h2>
      <p className="p-sub">
        Whetstone asks about the approved source and grades what you say against it — in your own
        words, no multiple choice. Each answer is scored on a rubric your instructor approved.
      </p>

      <Err msg={err} />
      {loading && <p>Loading sessions…</p>}

      {!loading && !active && (
        <div className="p-panel">
          <h3>Start a session</h3>
          <p className="p-src" style={{ marginBottom: '1rem' }}>
            Grounded on <code>{sourceId || '—'}</code>. A session runs until every criterion is assessed or the turn limit is reached.
          </p>
          <button className="p-btn" onClick={handleStart} disabled={startSession.loading || !sourceId}>
            {startSession.loading ? 'Starting…' : 'Start mastery session'}
          </button>
        </div>
      )}

      {active && (
        <div className="p-panel s-mastery">
          <h3>Question</h3>
          <p className="s-mastery-q">{active.currentQuestion || 'Session initialised — submit any answer to receive the first question.'}</p>

          {last && (
            <div className="p-rationale" style={{ marginBottom: '1rem' }}>
              <span className="p-rlab" style={{ color: verdictColor(last.verdict) }}>{last.verdict || 'Graded'}</span>
              <p style={{ margin: 0 }}>{last.feedback}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <textarea
              ref={inputRef}
              className="scw-ti"
              style={{ flex: 1, padding: '0.6rem', minHeight: '4.5rem' }}
              placeholder="Answer in your own words…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleTurn();
                }
              }}
            />
            <button className="p-btn" onClick={handleTurn} disabled={turn.loading || !answer.trim()} style={{ alignSelf: 'flex-end' }}>
              {turn.loading ? 'Grading…' : 'Submit'}
            </button>
          </div>

          {active.criteria?.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h4 className="s-label">Criteria</h4>
              <ul className="p-req">
                {active.criteria.map((c, i) => (
                  <li className="p-reqrow" key={i}>
                    <span style={{ color: verdictColor(c.verdict), fontSize: '0.8em' }}>●</span>
                    <span className="p-reqname">{c.elo}</span>
                    <span style={{ color: verdictColor(c.verdict), fontSize: '0.82em' }}>{c.verdict || 'not yet assessed'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active.transcript?.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary className="p-src" style={{ cursor: 'pointer' }}>Transcript ({active.transcript.length})</summary>
              <ol className="s-obj">
                {active.transcript.map((t, i) => (
                  <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{typeof t === 'string' ? t : t.text || JSON.stringify(t)}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="p-panel">
          <h3>Completed sessions</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr><th>Session</th><th className="p-num">Score</th><th>Criteria</th></tr>
              </thead>
              <tbody>
                {done.map((s) => (
                  <tr key={s.id}>
                    <td><code>{s.id.slice(-6)}</code></td>
                    <td className="p-num">{pct(s.report?.score)}</td>
                    <td>
                      {(s.criteria || []).map((c, i) => (
                        <span key={i} style={{ color: verdictColor(c.verdict), marginRight: '0.6rem' }}>{c.elo}: {c.verdict}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!active && (
            <button className="p-btn ghost" onClick={handleStart} disabled={startSession.loading || !sourceId} style={{ marginTop: '0.8rem' }}>
              {startSession.loading ? 'Starting…' : 'Start another session'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- learning path (Cadence) ---------- */

const COA_META = {
  catch_up: { icon: '▼', color: 'var(--p-critical)', blurb: 'Catch-up plan. More minutes per day, front-loaded on what is due first.' },
  maintain: { icon: '●', color: 'var(--p-good)', blurb: 'Maintenance plan. Keeps pace with the syllabus at your available time.' },
  get_ahead: { icon: '▲', color: 'var(--p-accent)', blurb: 'Extension plan. Finishes early and leaves room for review.' },
};

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function StudyPlan({ course }) {
  const { data, loading, error, refetch } = useApiQuery(`/study-plan?courseId=${course.id}`);
  const create = useApiMutation('/study-plan', 'POST');
  const [availability, setAvailability] = useState(60);
  const [coa, setCoa] = useState(null);
  const [err, setErr] = useState(null);

  const plan = data?.plan;
  const coaKeys = plan ? Object.keys(plan.coas) : [];
  const activeKey = coa && plan?.coas[coa] ? coa : plan?.recommended;
  const active = plan?.coas[activeKey];

  const handleCreate = async () => {
    setErr(null);
    try {
      await create.mutate({
        courseId: course.id,
        asOf: new Date().toISOString().split('T')[0],
        availability,
        ics: { calendarName: `${course.name} — study plan`, startHour: 18 },
      });
      refetch();
    } catch (e) {
      setErr(errText(e, 'Could not build a plan'));
    }
  };

  const notFound = error?.code === 'STUDY_PLAN_NOT_FOUND' || error?.status === 404;

  return (
    <>
      <h2 className="p-h">My Learning Path</h2>
      <p className="p-sub">
        Built by Cadence from the course syllabus and your available time. Three courses of action,
        because &quot;behind&quot; and &quot;ahead&quot; need different plans — not the same plan at a
        different speed.
      </p>

      <Err msg={err} />
      {loading && <p>Loading plan…</p>}
      {error && !notFound && <Err msg={errText(error, 'Could not load the plan.')} />}

      {(notFound || (!loading && !error && !plan)) && (
        <div className="p-panel">
          <h3>No plan yet</h3>
          <p className="p-src" style={{ marginBottom: '1rem' }}>
            Cadence needs the course syllabus (your instructor attaches it) and how much time you can give each day.
          </p>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              Minutes per day
              <input type="number" min="10" max="480" className="scw-ti" style={{ width: '90px', marginLeft: '0.5rem', padding: '0.3rem 0.5rem' }} value={availability} onChange={(e) => setAvailability(parseInt(e.target.value, 10) || 60)} />
            </label>
            <button className="p-btn" onClick={handleCreate} disabled={create.loading}>
              {create.loading ? 'Building…' : 'Build my plan'}
            </button>
          </div>
        </div>
      )}

      {plan && (
        <>
          <div className="p-tiles">
            <div className="p-tile">
              <div className="p-tilelab">Status</div>
              <div className="p-tileval" style={{ fontSize: '1.15em', color: plan.status === 'behind' ? 'var(--p-critical)' : 'var(--p-good)' }}>{(plan.status || '').replace('_', ' ')}</div>
              <div className="p-tilenote">as of {fmtDate(plan.asOf)}</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Recommended</div>
              <div className="p-tileval" style={{ fontSize: '1.15em' }}>{plan.coas[plan.recommended]?.label}</div>
              <div className="p-tilenote">{plan.coas[plan.recommended]?.days} days</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Total time</div>
              <div className="p-tileval">{Math.round((active?.totalMinutes || 0) / 60 * 10) / 10}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>h</span></div>
              <div className="p-tilenote">{active?.label.toLowerCase()} plan</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Late risk</div>
              <div className="p-tileval" style={{ color: active?.lateRisk ? 'var(--p-warning)' : 'var(--p-good)' }}>{active?.lateRisk ?? 0}</div>
              <div className="p-tilenote">blocks past due</div>
            </div>
          </div>

          <div className="p-panel">
            <h3>Course of action</h3>
            <div className="p-coa">
              {coaKeys.map((k) => {
                const c = plan.coas[k];
                const m = COA_META[k] || { icon: '●', color: 'var(--p-dim)', blurb: '' };
                return (
                  <button key={k} className={`p-coacard${activeKey === k ? ' on' : ''}`} onClick={() => setCoa(k)}>
                    <h4>
                      <span style={{ color: m.color }}>{m.icon}</span>
                      {c.label}
                      {c.recommended && <span className="p-examtag" style={{ marginLeft: '0.4rem' }}>RECOMMENDED</span>}
                    </h4>
                    <p>{m.blurb} {c.blocks.length} blocks over {c.days} days.</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-panel">
            <h3>Plan — {active?.label.toLowerCase()}</h3>
            <ul className="p-plan">
              {(active?.blocks || []).map((b, i) => (
                <li className="p-planrow" key={i}>
                  <span className="p-pldate">{fmtDate(b.date)}</span>
                  <span className="p-pltask">{b.task}</span>
                  <span className="p-plnote">{b.minutes} min{b.kind && b.kind !== 'study' ? ` · ${b.kind}` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
              <button
                type="button"
                className="p-btn ghost"
                onClick={() => downloadAuthenticated(`/api/learning/study-plan?courseId=${course.id}&format=ics`, 'schoolcircle-study-plan.ics').catch((e) => setErr(e.message))}
              >
                Download calendar (.ics)
              </button>
              <button type="button" className="p-btn ghost" onClick={handleCreate} disabled={create.loading}>
                {create.loading ? 'Rebuilding…' : 'Rebuild plan'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- progress (Sextant) ---------- */

export function LearnerProgress({ courseId }) {
  const { data: analytics, loading, error } = useApiQuery(courseId ? `/analytics?courseId=${courseId}` : '/analytics');

  if (loading) return <p>Loading progress…</p>;
  if (error) return <Err msg={errText(error, 'Could not load progress.')} />;
  if (!analytics) return null;

  const { gain, gaps, mastery } = analytics;
  const rows = Array.isArray(mastery) ? mastery : [];
  const gapRows = Array.isArray(gaps) ? gaps : [];

  return (
    <>
      <h2 className="p-h">My Progress</h2>
      <p className="p-sub">What your saved mastery sessions show, by competency. Yours only — instructors see the class, never one Marine.</p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Competencies</div>
          <div className="p-tileval">{rows.length}</div>
          <div className="p-tilenote">assessed</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Mastered</div>
          <div className="p-tileval" style={{ color: 'var(--p-good)' }}>{rows.filter((r) => r.masteredRate >= 0.5).length}</div>
          <div className="p-tilenote">at or above half</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Learning gain</div>
          <div className="p-tileval">{gain?.status === 'insufficient_evidence' ? '—' : pct(gain?.overall?.normalizedGain ?? gain?.overall?.gain)}</div>
          <div className="p-tilenote">{gain?.status === 'insufficient_evidence' ? 'needs pre + post' : 'pre → post'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Gaps</div>
          <div className="p-tileval" style={{ color: gapRows.length ? 'var(--p-warning)' : 'var(--p-good)' }}>{gapRows.length}</div>
          <div className="p-tilenote">objectives to revisit</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>Mastery by competency</h3>
        {rows.length === 0 ? (
          <p className="p-src">{analytics.evidence?.mastery?.reason || 'No completed mastery sessions yet. Start one from the course.'}</p>
        ) : (
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr><th>Competency</th><th className="p-num">Mastered</th><th className="p-num">Competent</th><th className="p-num">Developing</th><th className="p-num">Rate</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.competency || i}>
                    <td>{r.competency}</td>
                    <td className="p-num">{r.mastered ?? '—'}</td>
                    <td className="p-num">{r.competent ?? '—'}</td>
                    <td className="p-num">{r.developing ?? '—'}</td>
                    <td className="p-num" style={{ color: r.masteredRate < 0.5 ? 'var(--p-critical)' : 'var(--p-good)' }}>{pct(r.masteredRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {gapRows.length > 0 && (
        <div className="p-panel">
          <h3>Needs work</h3>
          <ul className="p-req">
            {gapRows.map((g, i) => (
              <li className="p-reqrow" key={g.objective || i}>
                <span style={{ color: 'var(--p-critical)', fontSize: '0.8em' }}>●</span>
                <span className="p-reqname">{g.objective}</span>
                <span style={{ color: 'var(--p-critical)', fontSize: '0.82em' }}>{pct(g.missRate)} missed</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ---------- learning profile (Waypoint) ---------- */

// Waypoint's default instrument: 1..5 Likert, two items per dimension.
const INSTRUMENT = [
  ['v1', 'I learn best from diagrams, maps, or a live demonstration.'],
  ['v2', 'A chart helps me more than a paragraph of text.'],
  ['b1', 'I understand a topic better when someone explains it out loud.'],
  ['b2', 'Talking it through with others helps it stick.'],
  ['r1', 'I prefer a written study guide I can reread on my own.'],
  ['r2', 'I take detailed notes and review them later.'],
  ['h1', 'I learn by doing the task myself, not watching.'],
  ['h2', 'I need practical reps before it really sinks in.'],
  ['p1', 'I do better setting my own schedule than following a fixed one.'],
  ['p2', 'A rigid class pace tends to slow me down or leave me behind.'],
  ['s1', 'I want a clear, step-by-step path with explicit objectives.'],
  ['s2', 'Open-ended, figure-it-out tasks stress me more than they help.'],
];
const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
const MODALITY = { visual: 'Visual', verbal: 'Aural', reading: 'Read / write', hands_on: 'Hands-on' };

export function WaypointSurvey() {
  const { data, loading, error, refetch } = useApiQuery('/profile');
  const save = useApiMutation('/profile', 'POST');
  const [taking, setTaking] = useState(false);
  const [responses, setResponses] = useState({});
  const [err, setErr] = useState(null);

  const notFound = error?.code === 'PROFILE_NOT_FOUND' || error?.status === 404;
  const profile = data?.profile;

  const begin = () => {
    setResponses(data?.responses || {});
    setTaking(true);
  };

  const submit = async () => {
    setErr(null);
    try {
      await save.mutate({ responses });
      setTaking(false);
      refetch();
    } catch (e) {
      setErr(errText(e, 'Could not save your profile'));
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error && !notFound) return <Err msg={errText(error, 'Could not load your profile.')} />;

  if (profile && !taking) {
    return (
      <div>
        <div className="s-profile">
          <div className="s-profile-name">{MODALITY[profile.dominantModality] || profile.dominantModality || 'Balanced'}</div>
          <div className="s-profile-note">
            {(data.recommendations || []).slice(0, 2).join(' ')}
          </div>
          <div className="s-profile-meta">
            Pace: {profile.pace} · structure: {profile.structure} · {profile.answered} of {INSTRUMENT.length} answered · shared with your instructors as part of the class profile only
          </div>
        </div>
        <div className="p-btnrow" style={{ marginTop: '0.9rem' }}>
          <button className="p-btn ghost" onClick={begin}>Retake</button>
        </div>
      </div>
    );
  }

  if (!taking) {
    return (
      <div>
        <p className="s-settings-p">
          Twelve quick statements. Waypoint turns them into a learning profile that shapes how your study plan is
          built; instructors see the class profile (never individual answers) when they plan lessons.
        </p>
        <button className="p-btn" onClick={begin}>Start</button>
      </div>
    );
  }

  const answered = INSTRUMENT.filter(([id]) => Number.isInteger(responses[id])).length;

  return (
    <div className="s-waypoint">
      {INSTRUMENT.map(([id, text], i) => (
        <div className="s-waypoint-q" key={id}>
          <div className="s-survey-q" style={{ fontSize: '1em' }}>{i + 1}. {text}</div>
          <div className="s-waypoint-scale" role="radiogroup" aria-label={text}>
            {LIKERT.map((label, j) => (
              <button
                key={j}
                type="button"
                role="radio"
                aria-checked={responses[id] === j + 1}
                className={responses[id] === j + 1 ? 'on' : ''}
                title={label}
                onClick={() => setResponses((r) => ({ ...r, [id]: j + 1 }))}
              >
                {j + 1}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Err msg={err} />
      <div className="p-btnrow" style={{ marginTop: '0.9rem', alignItems: 'center' }}>
        <button className="p-btn" onClick={submit} disabled={save.loading || answered === 0}>
          {save.loading ? 'Saving…' : 'Save profile'}
        </button>
        <button className="p-btn ghost" onClick={() => setTaking(false)}>Cancel</button>
        <span className="p-src">{answered} of {INSTRUMENT.length} answered</span>
      </div>
    </div>
  );
}
