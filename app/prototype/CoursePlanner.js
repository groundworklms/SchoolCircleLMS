'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import { useApiQuery } from '../_learning/useLearning';
import { groupSourcesByCollection } from './source-groups';

/* Whole-course planning: survey the sources in batches, outline annexes and
   lessons, map sources to each lesson by retrieval, then build one lesson at a
   time into a single course draft. Each stage is one bounded request repeated
   until the server says the stage is done, so a 48-lesson course is an hour
   of small steps that survive a reload, a timeout, or a walk to get coffee --
   see lib/learning/course-plan.js. */


function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

async function post(path, body) {
  const res = await authFetch(`/api/learning${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* status below is the message */ }
  if (!res.ok) throw json || new Error(`Status ${res.status}`);
  return json;
}

const STAGE_LABEL = {
  survey: 'Reading the sources',
  outline: 'Outlining annexes and lessons',
  map: 'Mapping sources to lessons',
  build: 'Building lessons',
  complete: 'Complete',
};
const STAGE_ORDER = ['survey', 'outline', 'map', 'build', 'complete'];
const STEP_PATH = { survey: 'survey', outline: 'outline', map: 'map', build: 'build' };

/* ---------- create ---------- */

export function PlanCourseModal({ sources, onCreated }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [diagrams, setDiagrams] = useState(true);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const approved = (Array.isArray(sources) ? sources : []).filter((s) => s.status === 'APPROVED');
  const groups = useMemo(() => groupSourcesByCollection(approved), [approved]);

  const toggle = (id) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleGroup = (ids) => setPicked((prev) => {
    const next = new Set(prev);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });

  const submit = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const plan = await post('/plans', { title: title.trim(), sourceIds: [...picked], diagrams });
      setOpen(false);
      setPicked(new Set());
      setTitle('');
      onCreated?.(plan);
    } catch (error) {
      setErr(errText(error, 'The plan could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="p-btn ghost" onClick={() => setOpen(true)} disabled={!approved.length} title={approved.length ? '' : 'Approve sources first'}>
        Plan a full course
      </button>
      {open && (
        <div className="p-modalback" role="dialog" aria-modal="true" aria-label="Plan a full course">
          <div className="p-panel p-modal p-modal-lg">
            <div className="p-modalhead">
              <h3>Plan a full course</h3>
              <p className="p-src" style={{ margin: 0 }}>
                Pick every document the course draws on -- program of instruction, lesson plans, student material, references.
                SchoolCircle reads them in batches, outlines the annexes and lessons, maps the sources to each lesson, then writes
                one lesson at a time. You review and approve the result like any other draft.
              </p>
            </div>
            <div className="p-modalbody">
              <label className="p-field">
                <span>Course title (optional -- the outline names it otherwise)</span>
                <input className="p-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Basic Electronics Course" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0' }}>
                <input type="checkbox" checked={diagrams} onChange={(e) => setDiagrams(e.target.checked)} />
                <span>Draw a labelled diagram for each lesson where the source supports one (one more model call per lesson)</span>
              </label>
              <div className="p-field">
                <span>Sources · {picked.size} of {approved.length} selected</span>
                <div className="p-btnrow" style={{ marginBottom: '0.5rem' }}>
                  <button type="button" className="p-btn ghost" onClick={() => setPicked(new Set(approved.map((s) => s.id)))}>Select all</button>
                  <button type="button" className="p-btn ghost" onClick={() => setPicked(new Set())}>Clear</button>
                </div>
                <div style={{ maxHeight: '40vh', overflow: 'auto', border: '1px solid var(--p-border)', borderRadius: 10, padding: '0.5rem 0.75rem' }}>
                  {groups.map((group) => {
                    const ids = group.sources.map((s) => s.id);
                    const all = ids.every((id) => picked.has(id));
                    return (
                      <div key={group.name} style={{ marginBottom: '0.6rem' }}>
                        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 600 }}>
                          <input type="checkbox" checked={all} onChange={() => toggleGroup(ids)} />
                          <span>{group.name}</span>
                          <span className="p-src" style={{ margin: 0 }}>· {ids.length}</span>
                        </label>
                        <ul style={{ listStyle: 'none', margin: '0.25rem 0 0', padding: '0 0 0 1.5rem' }}>
                          {group.sources.map((s) => (
                            <li key={s.id}>
                              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.92em' }}>
                                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                                <span>{s.title || s.sourceId || s.id}</span>
                                <span className="p-src" style={{ margin: 0 }}>{s.pages ? `· ${s.pages} pages` : ''}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
              {err && <p className="s-shell-error" role="alert">{err}</p>}
            </div>
            <div className="p-modalfoot">
              <span className="p-footnote">Nothing is generated until you start the plan.</span>
              <button type="button" className="p-btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="p-btn" onClick={submit} disabled={busy || !picked.size}>{busy ? 'Creating…' : 'Create plan'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- list ---------- */

export function PlansList({ plans, onOpen }) {
  if (!plans?.length) return null;
  return (
    <div className="s-courselist" style={{ marginBottom: '1.25rem' }}>
      {plans.map((p) => (
        <div className="s-courserow s-courserow-managed" key={p.id}>
          <button className="s-courserow-open" onClick={() => onOpen(p.id)}>
            <div className="s-courserow-main">
              <div className="s-card-title">{p.title || 'Untitled plan'}</div>
              <div className="s-card-school">
                Course plan · {p.sourceIds.length} sources · {p.lessons ? `${p.lessons} lessons` : `${p.surveyed}/${p.sourceIds.length} read`} · <strong>{STAGE_LABEL[p.status] || p.status}</strong>
                {p.status === 'build' ? ` · ${p.counts.drafted}/${p.lessons} built` : ''}
              </div>
            </div>
            <span className="s-quick-arrow">→</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- planner ---------- */

const LESSON_STATE = {
  planned: ['Queued', ''],
  building: ['Building…', 'var(--p-accent)'],
  drafted: ['Built', 'var(--p-good)'],
  failed: ['Failed', 'var(--p-critical)'],
  ungrounded: ['No source covers it', 'var(--p-warning)'],
};

export function CoursePlanner({ planId, onBack, onOpenCourse }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const runningRef = useRef(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/learning/plans/${planId}`);
    const json = await res.json();
    if (!res.ok) throw json;
    setPlan(json);
    return json;
  }, [planId]);

  useEffect(() => {
    load().catch((e) => setError(errText(e, 'Could not load the plan.')));
    return () => { stopRef.current = true; };
  }, [load]);

  const note = (text) => setLog((prev) => [{ at: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 200));

  /* The loop: one step, read the plan back, decide the next step from its
     status. Nothing is inferred client-side; the server is the state. */
  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setError(null);
    try {
      let current = plan || (await load());
      while (!stopRef.current && current && current.status !== 'complete') {
        const path = STEP_PATH[current.status];
        if (!path) break;
        const before = current;
        current = await post(`/plans/${planId}/${path}`);
        setPlan(current);
        if (path === 'survey') note(`Read ${current.surveyed} of ${current.sourceIds.length} sources`);
        else if (path === 'outline') note(`Outlined ${current.annexes.length} annexes, ${current.lessons} lessons${current.dropped.length ? ` (${current.dropped.length} not planned)` : ''}`);
        else if (path === 'map') note(`Mapped sources to ${current.lessons} lessons · ${current.counts.ungrounded || 0} with no covering passage`);
        else if (path === 'build' && current.built) note(`${current.built.ok ? 'Built' : 'Could not build'} ${current.built.id} ${current.built.title}${current.built.reason ? ` — ${current.built.reason}` : ''}`);
        if (current.status === before.status && current.version === before.version) break;
      }
      if (current?.status === 'complete') note('Plan complete. Open the course draft to review and approve it.');
    } catch (e) {
      setError(errText(e, 'A step failed. Continue to retry it.'));
      note(`Stopped: ${errText(e, 'step failed')}`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const pause = () => { stopRef.current = true; };

  const retry = async (lessonId) => {
    try {
      setPlan(await post(`/plans/${planId}/retry`, { lessonId }));
    } catch (e) {
      setError(errText(e, 'Could not requeue that lesson.'));
    }
  };

  const reoutline = async () => {
    if (typeof window !== 'undefined' && !window.confirm('Outline again? The current annexes and lessons are replaced.')) return;
    try {
      setPlan(await post(`/plans/${planId}/outline`, { again: true }));
      note('Outlined again');
    } catch (e) {
      setError(errText(e, 'Could not outline again.'));
    }
  };

  if (error && !plan) return <div className="s-shell-error" role="alert"><p>{error}</p><button className="p-btn ghost" onClick={onBack}>Back</button></div>;
  if (!plan) return <p>Loading plan…</p>;

  const stageIndex = STAGE_ORDER.indexOf(plan.status);
  const total = plan.lessons || 0;
  const done = (plan.counts.drafted || 0) + (plan.counts.failed || 0);
  const canRun = plan.status !== 'complete';

  return (
    <>
      <button className="s-crumbs-inline" onClick={onBack}>← Courses</button>
      <div className="course-review-heading">
        <div>
          <p className="p-src" style={{ margin: 0 }}>Course plan · {plan.sourceIds.length} sources</p>
          <h2 className="p-h">{plan.title || 'Untitled course plan'}</h2>
          <p className="p-sub">
            {STAGE_LABEL[plan.status]}
            {plan.status === 'survey' ? ` · ${plan.surveyed} of ${plan.sourceIds.length} read` : ''}
            {plan.status === 'build' ? ` · ${done} of ${total}` : ''}
          </p>
        </div>
        <span className={`p-live${plan.status === 'complete' ? ' on' : ''}`}>{plan.status === 'complete' ? 'COMPLETE' : running ? 'RUNNING' : 'PAUSED'}</span>
      </div>

      {error && <p className="s-shell-error" role="alert">{error}</p>}

      <div className="p-btnrow" style={{ marginBottom: '1rem' }}>
        {canRun && !running && <button type="button" className="p-btn" onClick={run}>{plan.status === 'survey' && plan.surveyed === 0 ? 'Start the plan' : 'Continue'}</button>}
        {running && <button type="button" className="p-btn ghost" onClick={pause}>Pause after this step</button>}
        {plan.courseId && <button type="button" className="p-btn ghost" onClick={() => onOpenCourse(plan.courseId)}>Open the course draft{plan.status !== 'complete' ? ' so far' : ''}</button>}
        {stageIndex >= 2 && !plan.courseId && !running && <button type="button" className="p-btn ghost" onClick={reoutline}>Outline again</button>}
      </div>

      <ol className="p-plan" style={{ marginBottom: '1.25rem' }}>
        {STAGE_ORDER.slice(0, 4).map((stage, i) => {
          const state = i < stageIndex ? 'done' : i === stageIndex ? (running ? 'running' : 'current') : 'waiting';
          const detail = stage === 'survey' ? `${plan.surveyed}/${plan.sourceIds.length}`
            : stage === 'outline' ? (plan.lessons ? `${plan.annexes.length} annexes · ${plan.lessons} lessons` : '')
            : stage === 'map' ? (stageIndex > 2 ? `${plan.counts.ungrounded || 0} ungrounded` : '')
            : stage === 'build' ? (total ? `${done}/${total}` : '') : '';
          return (
            <li className="p-planrow" key={stage}>
              <span className="p-pldate" style={{ color: state === 'done' ? 'var(--p-good)' : state === 'waiting' ? 'var(--p-faint)' : 'var(--p-accent)' }}>
                {state === 'done' ? '✓' : state === 'running' ? '●' : state === 'current' ? '○' : '·'}
              </span>
              <span className="p-pltask">{STAGE_LABEL[stage]}</span>
              <span className="p-plnote">{detail}</span>
            </li>
          );
        })}
      </ol>

      {plan.status === 'survey' && plan.survey.length > 0 && (
        <details className="p-panel">
          <summary>What has been read so far · {plan.survey.length}</summary>
          <ul>
            {plan.survey.map((s) => (
              <li key={s.id}><strong>{s.title}</strong> · {s.kind}{s.summary ? ` — ${s.summary}` : ''}{s.lessons?.length ? ` (lists ${s.lessons.length} lessons)` : ''}</li>
            ))}
          </ul>
        </details>
      )}

      {plan.annexes.length > 0 && (
        <div className="s-modules">
          {plan.annexes.map((annex) => {
            const built = annex.lessons.filter((l) => l.status === 'drafted').length;
            return (
              <section key={annex.letter} className={`s-module ${built === annex.lessons.length ? 'complete' : built > 0 ? 'current' : 'upcoming'}`}>
                <div className="s-module-head" style={{ cursor: 'default' }}>
                  <span className="s-module-twisty">▾</span>
                  <span className="s-module-letter">{annex.letter}</span>
                  <span className="s-module-title">{annex.title}</span>
                  <span className="s-module-meta">{annex.lessons.length} lessons</span>
                  <span className={`s-module-status ${built === annex.lessons.length ? 'complete' : 'current'}`}>{built}/{annex.lessons.length} built</span>
                </div>
                <ol className="s-lessons">
                  {annex.lessons.map((l) => {
                    const [label, color] = LESSON_STATE[l.status] || [l.status, ''];
                    return (
                      <li key={l.id}>
                        <div className="s-lesson" style={{ cursor: 'default' }}>
                          <span className="s-lesson-mark">{l.status === 'drafted' ? '✓' : l.status === 'failed' || l.status === 'ungrounded' ? '!' : ''}</span>
                          <code>{l.id}</code>
                          <span className="s-lesson-title">
                            {l.title}
                            <div className="p-src" style={{ margin: '0.15rem 0 0', fontSize: '0.85em' }}>
                              {l.objective}
                              {l.sourceIds?.length ? ` · ${l.sourceIds.length} source${l.sourceIds.length === 1 ? '' : 's'}, ${l.passages || 0} passages` : ''}
                              {l.reason ? ` · ${l.reason}` : ''}
                            </div>
                          </span>
                          <span className="s-lesson-hours" />
                          <span className="s-lesson-status" style={{ color }}>
                            {label}
                            {(l.status === 'failed' || l.status === 'ungrounded') && !running && (
                              <button type="button" className="p-btn ghost" style={{ height: '1.6rem', fontSize: '0.8em', marginLeft: '0.4rem' }} onClick={() => retry(l.id)}>Retry</button>
                            )}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      {plan.dropped.length > 0 && (
        <details className="p-panel">
          <summary>Not planned · {plan.dropped.length}</summary>
          <ul>{plan.dropped.map((d, i) => <li key={i}><strong>{d.title}</strong> — {d.reason}</li>)}</ul>
        </details>
      )}

      {log.length > 0 && (
        <details className="p-panel" open>
          <summary>Activity</summary>
          <ul style={{ fontFamily: 'var(--p-mono)', fontSize: '0.82em' }}>
            {log.map((entry, i) => <li key={i}>{entry.at} · {entry.text}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/** The instructor's plans, for the Courses library. */
export function usePlans() {
  return useApiQuery('/plans');
}
