'use client';

import { useEffect, useRef, useState } from 'react';
import { useApiQuery, useApiMutation } from '../_learning/useLearning';
import { RowActions } from './RowActions';

/* Instructor-side optional tools for a real (LearningRecord) course:
   syllabus (Cadence), doctrinal fidelity (Understudy), the after-action
   review (Hotwash), shared mastery (Sextant) and rubric generation
   (Rubricon). The primary Courses flow owns source selection, generation,
   review, approval and publish; these tools never stand in for those stages.
   Each talks to /api/learning/* and shows the server's answer or its error —
   never a made-up result. */

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

function Err({ msg }) {
  return msg ? <p className="s-shell-error" role="alert">{msg}</p> : null;
}

/* Wheel deltas arrive in pixels, lines or pages depending on the device and
   browser; normalise to pixels before handing them to an ancestor scroller. */
function wheelPixels(event, element) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * element.clientHeight;
  return event.deltaY;
}

function scrollingAncestor(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/**
 * The wheel handler that lets a gesture over a scrollable field fall through
 * to the page.
 *
 * The prototype shell is a fixed-height column whose <main> is the only
 * scroller, so nothing chains to the document. A browser latches a wheel
 * gesture to the first scrollable element under the pointer, and a textarea
 * holding more lines than it shows is one -- so a pointer resting over a
 * filled form field swallowed the gesture and the Review panel below the
 * rubric form could not be reached at all.
 *
 * It takes over only once the field has no scroll left in the wheel's
 * direction, so the field's own scrolling and its resize handle are unchanged.
 * `findScroller` is the injection seam the contract test drives it through.
 */
function wheelFallthrough(element, findScroller = scrollingAncestor) {
  return (event) => {
    // Ctrl+wheel is browser zoom, not scrolling.
    if (event.ctrlKey || event.deltaY === 0) return;
    const exhausted = event.deltaY < 0
      ? element.scrollTop <= 0
      : element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    if (!exhausted) return;
    const scroller = findScroller(element);
    if (!scroller) return;
    event.preventDefault();
    scroller.scrollTop += wheelPixels(event, element);
  };
}

/* Attached by hand rather than through onWheel: React registers wheel
   listeners passively, where preventDefault() is ignored. */
function useWheelFallthrough() {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const onWheel = wheelFallthrough(element);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);
  return ref;
}

/*
 * A mastery plan is a course-level contract.  It is deliberately rendered
 * here, rather than hidden behind the generation request: instructors must be
 * able to inspect the exact criteria and the immutable revision before they
 * approve it.  There is no "replace" action after approval; a new course
 * revision is the boundary for changing the contract.
 */
export function InstructorMasteryPlan({ courseId, course, approvedSources = [], onUpdated }) {
  const sourceIds = Array.isArray(course?.sourceIds) ? course.sourceIds : [];
  const [selectedSourceId, setSelectedSourceId] = useState(sourceIds[0] || '');
  const [plan, setPlan] = useState(course?.masteryPlan || null);
  const generatePlan = useApiMutation(`/courses/${courseId}/mastery-plan`, 'POST');
  const approvePlan = useApiMutation(`/courses/${courseId}/mastery-plan/approve`, 'POST');

  // Course detail is loaded after the shell mounts.  Keep a locally generated
  // plan stable, but pick up the persisted plan when a refreshed detail lands.
  useEffect(() => {
    if (course?.masteryPlan) setPlan(course.masteryPlan);
  }, [course?.masteryPlan]);

  useEffect(() => {
    if (!selectedSourceId && sourceIds.length > 0) setSelectedSourceId(sourceIds[0]);
  }, [selectedSourceId, sourceIds]);

  const sourceOptions = sourceIds.map((sourceId) => {
    const source = approvedSources.find((item) => item.id === sourceId);
    return {
      id: sourceId,
      label: source?.title ? `${source.title} (${sourceId})` : sourceId,
    };
  });
  const mutationError = generatePlan.error || approvePlan.error;
  const errorText = mutationError?.error || mutationError?.message || 'Unable to update the mastery plan.';

  const handleGenerate = async () => {
    if (!selectedSourceId) return;
    try {
      const response = await generatePlan.mutate({ sourceId: selectedSourceId });
      const nextPlan = response?.masteryPlan || response?.plan || (response?.revision ? response : null);
      if (nextPlan) setPlan(nextPlan);
      await onUpdated?.();
    } catch {
      // The mutation hook exposes the explicit API failure below.
    }
  };

  const handleApprove = async () => {
    if (!plan?.revision || plan.status !== 'PENDING') return;
    try {
      const response = await approvePlan.mutate({ revision: plan.revision });
      const nextPlan = response?.masteryPlan || response?.plan || (response?.revision ? response : null);
      if (nextPlan) setPlan(nextPlan);
      await onUpdated?.();
    } catch {
      // Keep the pending review visible so a stale revision is not hidden.
    }
  };

  return (
    <div className="p-panel" data-testid="instructor-mastery-plan" style={{ marginTop: '1rem' }}>
      <h3>Optional advanced tool: Shared mastery plan</h3>
      <p className="p-src" style={{ margin: '0 0 0.75rem' }}>
        One reviewed set of criteria keeps learner outcomes comparable across the cohort.
        This optional plan does not block course review or publish. Once approved, this revision
        is locked for the course.
      </p>

      {mutationError && <Err msg={`Mastery plan update failed: ${errorText}`} />}

      {!plan ? (
        <div>
          <label style={{ display: 'block', fontSize: '0.85em', marginBottom: '0.5rem' }}>
            <span style={{ display: 'block', marginBottom: '0.25rem' }}>Approved source</span>
            <select
              className="scw-ti"
              aria-label="Approved source"
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.target.value)}
              disabled={sourceOptions.length === 0 || generatePlan.loading}
              style={{ width: '100%', padding: '0.45rem' }}
            >
              {sourceOptions.length === 0 ? (
                <option value="">No approved source available</option>
              ) : (
                sourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))
              )}
            </select>
          </label>
          <button
            className="p-btn"
            onClick={handleGenerate}
            disabled={!selectedSourceId || sourceOptions.length === 0 || generatePlan.loading}
          >
            {generatePlan.loading ? 'Generating…' : 'Generate plan'}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '0.85em', margin: '0 0 0.65rem' }}>
            Status: <strong>{plan.status || 'PENDING'}</strong>
            {plan.sourceId && <span className="p-src"> · Source {plan.sourceId}</span>}
            {plan.revision && <span className="p-src"> · Revision {plan.revision}</span>}
          </p>
          <MasteryPlanCriteria criteria={plan.criteria} />
          {plan.status === 'PENDING' ? (
            <button
              className="p-btn"
              onClick={handleApprove}
              disabled={!plan.revision || approvePlan.loading}
            >
              {approvePlan.loading ? 'Approving…' : 'Approve plan'}
            </button>
          ) : plan.status === 'APPROVED' ? (
            <p className="p-src" style={{ color: 'var(--p-good)', margin: '0.65rem 0 0' }}>
              Criteria are approved and locked for this course.
            </p>
          ) : (
            <p className="p-src">This plan is not available for learner sessions.</p>
          )}
        </div>
      )}
    </div>
  );
}

function MasteryPlanCriteria({ criteria }) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return <p className="p-src">No criteria were returned for review.</p>;
  }

  const indicatorLevels = [
    ['developing', 'Developing'],
    ['competent', 'Competent'],
    ['mastered', 'Mastered'],
  ];

  return (
    <div data-testid="mastery-plan-criteria" style={{ marginBottom: '0.75rem' }}>
      <strong style={{ fontSize: '0.85em' }}>Reviewed criteria</strong>
      <ul style={{ paddingLeft: '1.25rem', margin: '0.35rem 0 0' }}>
        {criteria.map((criterion, index) => (
          <li key={`${criterion.elo || 'criterion'}-${index}`} style={{ marginBottom: '0.35rem', fontSize: '0.85em' }}>
            <strong>{criterion.elo || criterion.competency || `Criterion ${index + 1}`}</strong>
            {criterion.indicators && typeof criterion.indicators === 'object' && !Array.isArray(criterion.indicators) ? (
              <ul style={{ paddingLeft: '1.25rem', marginTop: '0.2rem' }}>
                {indicatorLevels.map(([level, label]) => (
                  <li key={level}>
                    <strong>{label}:</strong>{' '}
                    {criterion.indicators[level] || <span className="p-src">Not supplied</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="p-src"> · No indicators supplied</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- syllabus (Cadence) ---------- */

export function InstructorSyllabus({ courseId }) {
  const [syllabus, setSyllabus] = useState([{ title: '', due: '' }]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const submitSyllabus = useApiMutation(`/courses/${courseId}/syllabus`, 'POST');

  const update = (i, key, value) =>
    setSyllabus((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const handleSubmit = async () => {
    setErr(null);
    setMsg(null);
    try {
      await submitSyllabus.mutate({ syllabus: syllabus.filter((r) => r.title && r.due) });
      setMsg('Syllabus attached. Learners can now generate a study plan for this course.');
    } catch (e) {
      setErr(errText(e, 'Failed to attach syllabus'));
    }
  };

  return (
    <div className="p-panel">
      <h3>Syllabus</h3>
      <p className="p-src" style={{ marginBottom: '0.75rem' }}>
        Add one dated row per lesson or exam.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {syllabus.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
            <input className="scw-ti" placeholder="Title" value={item.title} onChange={(e) => update(i, 'title', e.target.value)} style={{ flex: 1 }} />
            <input className="scw-ti" type="date" value={item.due} onChange={(e) => update(i, 'due', e.target.value)} />
          </div>
        ))}
        <button className="p-btn ghost" onClick={() => setSyllabus((rows) => [...rows, { title: '', due: '' }])} style={{ alignSelf: 'flex-start' }}>
          + Add row
        </button>
      </div>
      <Err msg={err} />
      {msg && <p className="p-src" style={{ color: 'var(--p-good)' }}>{msg}</p>}
      <button className="p-btn" onClick={handleSubmit} disabled={submitSyllabus.loading || !syllabus.some((r) => r.title && r.due)} style={{ marginTop: '1rem' }}>
        {submitSyllabus.loading ? 'Saving…' : 'Save syllabus'}
      </button>
    </div>
  );
}

/* ---------- doctrinal fidelity (Understudy) ---------- */

export function InstructorFidelity({ courseId }) {
  const { data: fidelityData, loading, refetch } = useApiQuery(`/fidelity?courseId=${courseId}`, { enabled: !!courseId });
  const runFidelity = useApiMutation('/fidelity', 'POST');
  const runCases = useApiMutation('/fidelity/cases', 'POST');
  const [persona, setPersona] = useState('');
  const [casesList, setCasesList] = useState([{ situation: '', expect: '' }]);
  const [sourceIdsStr, setSourceIdsStr] = useState('');
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const updateCase = (i, key, value) =>
    setCasesList((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const handleRunCases = async () => {
    setErr(null);
    setSaved(false);
    try {
      await runCases.mutate({
        courseId,
        sourceIds: sourceIdsStr.split(',').map((s) => s.trim()).filter(Boolean),
        persona,
        cases: casesList.filter((c) => c.situation && c.expect),
      });
      setSaved(true);
      refetch();
    } catch (e) {
      setErr(errText(e, 'Failed to save fidelity cases'));
    }
  };

  const handleRunFidelity = async () => {
    setErr(null);
    try {
      await runFidelity.mutate({ courseId });
      refetch();
    } catch (e) {
      setErr(errText(e, 'Failed to run fidelity check'));
    }
  };

  if (loading) return <p>Loading fidelity report…</p>;

  const hasReport = fidelityData && !fidelityData.error;

  return (
    <>
      {!hasReport && (
        <div className="p-panel">
          <h3>Benchmark cases</h3>
          <p className="p-src" style={{ marginBottom: '0.75rem' }}>
            Optional advanced tool.{' '}
            Situations a learner might raise, and what doctrine says should come back. Understudy runs each through the tutor and grades the answer against the approved sources.
          </p>
          <input className="scw-ti" placeholder="Source IDs (comma-separated)" value={sourceIdsStr} onChange={(e) => setSourceIdsStr(e.target.value)} style={{ width: '100%', marginBottom: '0.5rem' }} />
          <input className="scw-ti" placeholder="Persona (e.g. a new Lance Corporal on the range)" value={persona} onChange={(e) => setPersona(e.target.value)} style={{ width: '100%', marginBottom: '0.5rem' }} />
          {casesList.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input className="scw-ti" placeholder="Situation" value={c.situation} onChange={(e) => updateCase(i, 'situation', e.target.value)} style={{ flex: 1 }} />
              <input className="scw-ti" placeholder="Expected doctrine" value={c.expect} onChange={(e) => updateCase(i, 'expect', e.target.value)} style={{ flex: 1 }} />
            </div>
          ))}
          <div className="p-btnrow">
            <button className="p-btn ghost" onClick={() => setCasesList((rows) => [...rows, { situation: '', expect: '' }])}>+ Add case</button>
            <button className="p-btn ghost" onClick={handleRunCases} disabled={runCases.loading || !persona}>
              {runCases.loading ? 'Saving…' : 'Save cases'}
            </button>
          </div>
          {saved && <p className="p-src" style={{ color: 'var(--p-good)' }}>Cases saved. Run the check below.</p>}
        </div>
      )}

      <div className="p-panel">
        <h3>Fidelity report</h3>
        <p className="p-src" style={{ marginBottom: '0.75rem' }}>
          Optional advanced tool; this report informs review but does not block course approval or publish.
        </p>
        <Err msg={err} />
        {hasReport ? (
          <>
            <div className="p-tiles">
              <div className="p-tile">
                <div className="p-tilelab">Status</div>
                <div className="p-tileval" style={{ fontSize: '1.2em' }}>{fidelityData.status}</div>
              </div>
              {fidelityData.report && (
                <>
                  <div className="p-tile">
                    <div className="p-tilelab">Fidelity</div>
                    <div className="p-tileval">{typeof fidelityData.report.fidelity === 'number' ? `${Math.round(fidelityData.report.fidelity * 100)}%` : String(fidelityData.report.fidelity)}</div>
                  </div>
                  <div className="p-tile">
                    <div className="p-tilelab">Strict mode</div>
                    <div className="p-tileval" style={{ fontSize: '1.2em' }}>{fidelityData.report.strict ? 'Yes' : 'No'}</div>
                  </div>
                </>
              )}
            </div>
            {fidelityData.runs?.length > 0 && (
              <div className="p-tablewrap">
                <table className="p-table">
                  <thead>
                    <tr>
                      <th>Verdict</th>
                      <th>Grounding</th>
                      <th className="p-num">Score</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fidelityData.runs.map((r, i) => (
                      <tr key={i}>
                        <td style={{ color: r.verdict === 'pass' ? 'var(--p-good)' : 'var(--p-critical)', fontWeight: 600 }}>{r.verdict}</td>
                        <td>{r.grounding}</td>
                        <td className="p-num">{r.score}</td>
                        <td style={{ color: 'var(--p-critical)' }}>{r.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="p-btn ghost" onClick={handleRunFidelity} disabled={runFidelity.loading} style={{ marginTop: '1rem' }}>
              {runFidelity.loading ? 'Running…' : 'Re-run fidelity check'}
            </button>
          </>
        ) : (
          <>
            <p className="p-src" style={{ marginBottom: '1rem' }}>
              Save cases, then run the check against approved doctrine.
            </p>
            <button className="p-btn" onClick={handleRunFidelity} disabled={runFidelity.loading}>
              {runFidelity.loading ? 'Running…' : 'Run fidelity check'}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/* ---------- after-action review (Hotwash) ---------- */

/* Hotwash findings are per area: { area, mentions } for sustains and
   { area, mentions, meanSeverity, impact, horizon, priority } for improves. */
function findingMeta(f) {
  const bits = [];
  if (f.mentions) bits.push(`${f.mentions} mention${f.mentions === 1 ? '' : 's'}`);
  if (f.horizon) bits.push(f.horizon === 'short_term' ? 'short term' : 'long term');
  if (typeof f.impact === 'number') bits.push(`impact ${f.impact}`);
  return bits.join(' · ');
}

export function InstructorAAR({ courseId }) {
  const { data: aarData, loading, refetch } = useApiQuery(`/aar?courseId=${courseId}`, { enabled: !!courseId });
  const generateAar = useApiMutation('/aar', 'POST');
  const submitCritiques = useApiMutation('/aar/critiques', 'POST');

  const [critiqueArea, setCritiqueArea] = useState('');
  const [critiqueKind, setCritiqueKind] = useState('sustain');
  const [critiqueText, setCritiqueText] = useState('');
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleCritiques = async () => {
    setErr(null);
    setSaved(false);
    try {
      await submitCritiques.mutate({
        courseId,
        critiques: [{ area: critiqueArea, kind: critiqueKind, text: critiqueText }],
      });
      setSaved(true);
      setCritiqueText('');
    } catch (e) {
      setErr(errText(e, 'Failed to record critique'));
    }
  };

  const handleGenerate = async () => {
    setErr(null);
    try {
      await generateAar.mutate({ courseId });
      refetch();
    } catch (e) {
      setErr(errText(e, 'Failed to build AAR'));
    }
  };

  if (loading) return <p>Loading AAR…</p>;

  const hasAar = aarData && !aarData.error;
  const report = hasAar ? aarData.report : null;

  return (
    <>
      <div className="p-panel">
        <h3>Record a critique</h3>
        <p className="p-src" style={{ marginBottom: '0.75rem' }}>
          Record instructor or survey feedback here to build the AAR.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input className="scw-ti" placeholder="Area (e.g. Annex B practical)" value={critiqueArea} onChange={(e) => setCritiqueArea(e.target.value)} style={{ flex: 1 }} />
          <select className="scw-ti" value={critiqueKind} onChange={(e) => setCritiqueKind(e.target.value)}>
            <option value="sustain">Sustain</option>
            <option value="improve">Improve</option>
          </select>
        </div>
        <textarea className="scw-ti" placeholder="What happened, and what to keep or change" value={critiqueText} onChange={(e) => setCritiqueText(e.target.value)} rows={2} style={{ width: '100%', marginBottom: '0.5rem' }} />
        <Err msg={err} />
        {saved && <p className="p-src" style={{ color: 'var(--p-good)' }}>Critique recorded.</p>}
        <button className="p-btn ghost" onClick={handleCritiques} disabled={submitCritiques.loading || !critiqueArea || !critiqueText}>
          {submitCritiques.loading ? 'Recording…' : 'Record critique'}
        </button>
      </div>

      {hasAar ? (
        <>
          <div className="p-grid2">
            <div className="p-panel">
              <h3>Sustain</h3>
              {(report?.sustains || []).length === 0 && <p className="p-src">None recorded.</p>}
              {(report?.sustains || []).map((f, i) => (
                <div className="p-find ok" key={i}>
                  <div className="p-findhead"><span style={{ color: 'var(--p-good)', fontSize: '0.8em' }}>✓</span>{f.area}</div>
                  <p className="p-src">{findingMeta(f)}</p>
                </div>
              ))}
            </div>
            <div className="p-panel">
              <h3>Improve</h3>
              {(report?.improves || []).length === 0 && <p className="p-src">None recorded.</p>}
              {(report?.improves || []).map((f, i) => (
                <div className={`p-find ${f.priority === 1 ? 'crit' : 'warn'}`} key={i}>
                  <div className="p-findhead">
                    <span style={{ color: f.priority === 1 ? 'var(--p-critical)' : 'var(--p-warning)', fontSize: '0.8em' }}>{f.priority === 1 ? '▲' : '●'}</span>
                    {f.area}
                  </div>
                  <p className="p-src">{findingMeta(f)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="p-panel">
            <h3>Memo</h3>
            <div className="p-rationale">
              <span className="p-rlab">{aarData.source === 'heuristic' ? 'Deterministic memo' : 'Model narrative'}</span>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit', fontSize: '0.9em' }}>{aarData.memo}</pre>
            </div>
            <button className="p-btn ghost" onClick={handleGenerate} disabled={generateAar.loading} style={{ marginTop: '1rem' }}>
              {generateAar.loading ? 'Building…' : 'Rebuild AAR from critiques'}
            </button>
          </div>
        </>
      ) : (
        <div className="p-panel">
          <h3>No AAR yet</h3>
          <p className="p-src" style={{ marginBottom: '1rem' }}>Record at least one critique, then build the review.</p>
          <button className="p-btn" onClick={handleGenerate} disabled={generateAar.loading}>
            {generateAar.loading ? 'Building…' : 'Build AAR'}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- rubrics (Rubricon) ---------- */

/**
 * The instructor's saved rubrics.
 *
 * This screen previously showed only the rubric it had just generated, so an
 * older one could not be found, renamed or removed. Rubrics are owner-private,
 * so this is the owner's own list.
 */
function SavedRubrics() {
  const { data: rubrics, loading, error, refetch } = useApiQuery('/rubrics');
  const list = Array.isArray(rubrics) ? rubrics : [];

  if (loading) return <p>Loading saved rubrics…</p>;
  if (error) {
    return (
      <p className="s-shell-error" role="alert">
        {errText(error, 'Could not load saved rubrics.')}
      </p>
    );
  }
  if (!list.length) return null;

  return (
    <div className="p-panel">
      <h3>Saved rubrics</h3>
      <div className="s-courselist">
        {list.map((r) => (
          <div className="s-courserow s-courserow-managed" key={r.id}>
            <div className="s-courserow-open s-courserow-static">
              <div className="s-courserow-main">
                <div className="s-card-title">{r.title}</div>
                <div className="s-card-school">
                  {r.taskCode ? <>{r.taskCode} · </> : null}
                  {/* Plain text rather than Library's StatusTag: Library already
                      imports from this module, so importing it back would be a
                      circular dependency. */}
                  {r.criteria} criteria · {r.status === 'APPROVED' ? 'Approved' : 'Draft'}
                </div>
              </div>
            </div>
            <RowActions
              label="rubric"
              title={r.title}
              endpoint={`/api/learning/rubrics/${r.id}`}
              onChanged={refetch}
              removeNote="A rubric a mastery session grades against cannot be removed."
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const RUBRIC_TIERS = [
  ['unsatisfactory', 'Unsatisfactory'],
  ['satisfactory', 'Satisfactory'],
  ['proficient', 'Proficient'],
];

function RubricTask({ task }) {
  if (!task || (!task.code && !task.title)) return null;
  return (
    <div style={{ marginBottom: '0.9rem' }}>
      <div className="s-card-title">{task.title || task.code}</div>
      {task.title && task.code && <div className="s-card-school">{task.code}</div>}
    </div>
  );
}

function RubricNotes({ notes }) {
  const list = Array.isArray(notes) ? notes.filter((n) => typeof n === 'string' && n.trim()) : [];
  if (!list.length) return null;
  return (
    <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem' }}>
      {list.map((note, i) => <li key={i} className="p-findbody">{note}</li>)}
    </ul>
  );
}

/**
 * A standard Rubricon refused to anchor.
 *
 * This is the product's headline behaviour, not an error: rather than invent
 * criteria for a standard too vague to measure, Rubricon returns the refusal
 * and what a human would have to define. The instructor has to be able to read
 * both and hand them to a subject-matter expert, so they are prose under
 * labels rather than the payload they arrive in.
 */
function FlaggedRubric({ rubric }) {
  return (
    <div className="p-find warn" role="status" data-testid="rubric-flagged">
      <div className="p-findhead">
        <span style={{ color: 'var(--p-warning)', fontSize: '0.8em' }}>●</span>
        Flagged for a subject-matter expert — no rubric was written
      </div>
      <p className="p-findbody">
        {rubric.reason || 'This standard could not be anchored to observable performance.'}
      </p>
      {rubric.needsSME && (
        <>
          <div className="p-findhead" style={{ marginTop: '0.9rem' }}>What an SME must define</div>
          <p className="p-findbody">{rubric.needsSME}</p>
        </>
      )}
      <RubricNotes notes={rubric.notes} />
      <p className="p-src">Nothing above was invented.</p>
    </div>
  );
}

/**
 * The BARS rubric itself. Each dimension carries the verbatim source phrase
 * that verifyTraceability checked its anchors against, so the grounding claim
 * in the Traceability tile can be read against the evidence beside it.
 */
function RubricDimensions({ dimensions }) {
  return (
    <div className="p-tablewrap" data-testid="rubric-dimensions">
      <table className="p-table">
        <thead>
          <tr>
            <th>Dimension</th>
            {RUBRIC_TIERS.map(([tier, label]) => <th key={tier}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {dimensions.map((dimension, i) => (
            <tr key={dimension.name || i}>
              <td>
                {dimension.name || `Dimension ${i + 1}`}
                {dimension.source && <div className="p-src">“{dimension.source}”</div>}
              </td>
              {RUBRIC_TIERS.map(([tier]) => (
                <td key={tier}>{dimension.anchors?.[tier] || <span className="p-src">Not supplied</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Rubricon returns one of exactly two shapes -- a rubric with `dimensions`, or
 * a refusal with `flagged`/`reason`/`needsSME`. This screen used to look for
 * `criteria`/`elements`, which neither shape has and no server path produces,
 * so *every* generated rubric fell through to a JSON dump and the instructor
 * read the payload instead of the rubric.
 *
 * The third branch is for a shape matching neither contract. The shape gate in
 * generateRubric should make that unreachable, so it stays collapsed and says
 * what it is rather than presenting the payload as the result.
 */
function RubricResult({ rubric }) {
  if (!rubric || typeof rubric !== 'object') return null;
  const dimensions = Array.isArray(rubric.dimensions) ? rubric.dimensions : null;
  return (
    <>
      <RubricTask task={rubric.task} />
      {rubric.flagged ? <FlaggedRubric rubric={rubric} /> : null}
      {!rubric.flagged && dimensions?.length ? (
        <>
          <RubricDimensions dimensions={dimensions} />
          <RubricNotes notes={rubric.notes} />
        </>
      ) : null}
      {!rubric.flagged && !dimensions?.length ? (
        <details>
          <summary className="p-src">
            This rubric is in a shape this screen does not recognise. Open the raw record.
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', background: 'var(--p-surface-2)', padding: '1rem', overflowX: 'auto' }}>
            {JSON.stringify(rubric, null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}

export function RubricsView() {
  const {
    data: sources,
    loading: sourcesLoading,
    error: sourcesError,
    refetch: refetchSources,
  } = useApiQuery('/sources');
  // A query has no data during its first render. Keep that distinct from a
  // successful [] response so generation never proceeds without grounding.
  const sourcesPending = sourcesLoading || (sources == null && !sourcesError);
  const sourcesUnavailable = sourcesPending || Boolean(sourcesError);
  const approvedSources = Array.isArray(sources) ? sources.filter((s) => s.status === 'APPROVED') : [];

  const [sourceId, setSourceId] = useState('');
  const [taskCode, setTaskCode] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskCondition, setTaskCondition] = useState('');
  const [taskStandard, setTaskStandard] = useState('');
  const [taskSteps, setTaskSteps] = useState('');
  const [err, setErr] = useState(null);
  const [approved, setApproved] = useState(false);

  const [generatedRubricId, setGeneratedRubricId] = useState(null);

  // Auto-filled task suggestions for the selected source.
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionOrigin, setSuggestionOrigin] = useState('');
  const [suggestionError, setSuggestionError] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  const generateRubric = useApiMutation('/rubrics/generate', 'POST');
  const suggestTasks = useApiMutation('/rubrics/task-suggestions', 'POST');
  const approveRubric = useApiMutation(`/rubrics/${generatedRubricId}/approve`, 'POST');
  const { data: rubricData, refetch } = useApiQuery(`/rubrics/${generatedRubricId}`, { enabled: !!generatedRubricId });
  // Performance steps are the one field long enough to scroll, and a scrolling
  // field here swallows the page's wheel gesture; see useWheelFallthrough.
  const stepsRef = useWheelFallthrough();
  // A flagged standard is rewritten in the Standard field of this same form,
  // so the refusal below can put the caret in it instead of describing where
  // to go. focus() is all that is needed -- browsers scroll a focused field
  // into view themselves.
  const standardRef = useRef(null);

  const applySuggestion = (task) => {
    if (!task) return;
    setTaskCode(task.code || '');
    setTaskTitle(task.title || '');
    setTaskCondition(task.condition || '');
    setTaskStandard(task.standard || '');
    setTaskSteps((task.performanceSteps || []).join('\n'));
  };

  // Selecting a source fills the whole form from it, so the ordinary path is
  // pick a source and press Generate. Every field stays editable; a failure
  // here leaves the form usable by hand rather than blocking generation.
  useEffect(() => {
    if (!sourceId) {
      setSuggestions([]);
      setSuggestionOrigin('');
      setSuggestionError(null);
      return undefined;
    }
    let current = true;
    setSuggesting(true);
    setSuggestionError(null);
    suggestTasks
      .mutate({ sourceId })
      .then((res) => {
        if (!current) return;
        const tasks = Array.isArray(res?.tasks) ? res.tasks : [];
        setSuggestions(tasks);
        setSuggestionOrigin(res?.origin || '');
        setSuggestionIndex(0);
        applySuggestion(tasks[0]);
      })
      .catch((e) => {
        if (!current) return;
        setSuggestions([]);
        setSuggestionOrigin('');
        setSuggestionError(errText(e, 'Could not read a task from this source.'));
      })
      .finally(() => {
        if (current) setSuggesting(false);
      });
    return () => {
      current = false;
    };
    // suggestTasks is a fresh object each render; the source id is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  const handleGenerate = async () => {
    if (!sourceId || !taskCode) return;
    setErr(null);
    setApproved(false);
    try {
      const res = await generateRubric.mutate({
        sourceId,
        task: {
          code: taskCode,
          title: taskTitle,
          condition: taskCondition,
          standard: taskStandard,
          performanceSteps: taskSteps.split('\n').filter(Boolean),
        },
      });
      setGeneratedRubricId(res.id);
    } catch (e) {
      setErr(errText(e, 'Failed to generate rubric'));
    }
  };

  const handleApprove = async () => {
    setErr(null);
    try {
      await approveRubric.mutate();
      setApproved(true);
      refetch();
    } catch (e) {
      setErr(errText(e, 'Failed to approve rubric'));
    }
  };

  const rubric = rubricData?.rubric;

  return (
    <>
      <div className="s-pagehead">
        <h1>Rubrics</h1>
      </div>

      <SavedRubrics />

      <div className="p-panel">
        <h3>Generate a rubric</h3>
        <p className="p-src">
          Pick an approved source and the task fields fill themselves from it. Edit anything that
          needs it, then generate.
        </p>
        {sourcesPending && <p className="p-src">Loading approved sources…</p>}
        {sourcesError && (
          <div className="s-shell-error" role="alert">
            <p style={{ margin: '0 0 0.5rem' }}>
              {errText(sourcesError, 'Could not load approved sources.')}
            </p>
            <button type="button" className="p-btn ghost" onClick={refetchSources}>Retry loading sources</button>
          </div>
        )}
        {!sourcesPending && !sourcesError && Array.isArray(sources) && approvedSources.length === 0 && (
          <p className="p-src">No approved sources. Add and approve one before generating.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <select className="scw-ti" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={sourcesUnavailable}>
            <option value="">Select an approved source…</option>
            {approvedSources.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          {suggesting && <p className="p-src">Reading the task from this source…</p>}
          {suggestionOrigin === 'quarry' && suggestions.length > 0 && (
            <p className="p-src">
              {suggestions.length === 1
                ? 'Filled from the task written in this source.'
                : `${suggestions.length} tasks in this source — pick one to fill the form.`}
            </p>
          )}
          {suggestionOrigin === 'model' && (
            <p className="p-src">
              This source has no task block, so the fields below are a draft written from its text.
              Check them before generating.
            </p>
          )}
          {suggestions.length > 1 && (
            <select
              className="scw-ti"
              aria-label="Task from this source"
              value={suggestionIndex}
              onChange={(e) => {
                const next = Number(e.target.value);
                setSuggestionIndex(next);
                applySuggestion(suggestions[next]);
              }}
            >
              {suggestions.map((task, i) => (
                <option key={task.code || i} value={i}>{task.code} — {task.title}</option>
              ))}
            </select>
          )}
          {suggestionError && (
            <p className="p-src" role="status">{suggestionError} Fill the fields in by hand.</p>
          )}
          <input className="scw-ti" placeholder="Task code (e.g. 0311-M16-1001)" value={taskCode} onChange={(e) => setTaskCode(e.target.value)} disabled={sourcesUnavailable} />
          {suggestions[suggestionIndex]?.codeGenerated && taskCode === suggestions[suggestionIndex]?.code && (
            <small style={{ color: 'var(--p-faint)', marginTop: '-0.25rem' }}>
              This source carries no task code, so one was derived from the title. Replace it with
              the real code if the task has one.
            </small>
          )}
          <input className="scw-ti" placeholder="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} disabled={sourcesUnavailable} />
          <input className="scw-ti" placeholder="Condition" value={taskCondition} onChange={(e) => setTaskCondition(e.target.value)} disabled={sourcesUnavailable} />
          <input ref={standardRef} className="scw-ti" placeholder="Standard" value={taskStandard} onChange={(e) => setTaskStandard(e.target.value)} disabled={sourcesUnavailable} />
          <textarea ref={stepsRef} className="scw-ti" placeholder="Performance steps (one per line)" value={taskSteps} onChange={(e) => setTaskSteps(e.target.value)} rows={4} disabled={sourcesUnavailable} />
          <Err msg={err} />
          <button className="p-btn" onClick={handleGenerate} disabled={generateRubric.loading || suggesting || sourcesUnavailable || !sourceId || !taskCode} style={{ alignSelf: 'flex-start' }}>
            {generateRubric.loading ? 'Generating…' : 'Generate rubric'}
          </button>
        </div>
      </div>

      {generatedRubricId && (
        <div className="p-panel">
          <h3>Review</h3>
          {rubricData ? (
            <>
              <div className="p-tiles">
                <div className="p-tile">
                  <div className="p-tilelab">Status</div>
                  <div className="p-tileval" style={{ fontSize: '1.2em', color: rubricData.status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }}>{rubricData.status}</div>
                </div>
                {rubricData.validation && (
                  <div className="p-tile">
                    <div className="p-tilelab">Validation</div>
                    <div className="p-tileval" style={{ fontSize: '1.2em', color: rubricData.validation.valid ? 'var(--p-good)' : 'var(--p-critical)' }}>{rubricData.validation.valid ? 'Valid' : 'Invalid'}</div>
                  </div>
                )}
                {rubricData.traceability && (
                  <div className="p-tile">
                    <div className="p-tilelab">Traceability</div>
                    <div className="p-tileval" style={{ fontSize: '1.2em', color: rubricData.traceability.grounded ? 'var(--p-good)' : 'var(--p-critical)' }}>{rubricData.traceability.grounded ? 'Grounded' : 'Ungrounded'}</div>
                    {/* verifyTraceability is handed no dimensions for a flagged
                        standard, so its 100% is the empty case, not a checked
                        one. Claiming full coverage beside "no rubric was
                        written" reads as a contradiction. */}
                    {rubric?.flagged
                      ? <div className="p-tilenote">Nothing to trace yet</div>
                      : typeof rubricData.traceability.coverage === 'number' && <div className="p-tilenote">{Math.round(rubricData.traceability.coverage * 100)}% coverage</div>}
                  </div>
                )}
              </div>
              {rubricData.traceability?.ungrounded?.length > 0 && (
                <p className="s-shell-error" role="alert">
                  Ungrounded elements: {rubricData.traceability.ungrounded.map((u) => (typeof u === 'string' ? u : u.source || u.element || JSON.stringify(u))).join(', ')}
                </p>
              )}
              <RubricResult rubric={rubric} />
              <Err msg={err} />
              {approved && <p className="p-src" style={{ color: 'var(--p-good)' }}>Rubric approved.</p>}
              {/* A flagged payload carries no dimensions, so there is no
                  artifact to approve and approveRubric refuses it outright. An
                  Approve button here could only ever fail, and a disabled one
                  would imply something unlocks it, so the flagged branch offers
                  the action that does exist instead: the form above, with the
                  standard rewritten to the SME wording. */}
              {rubricData.status === 'PENDING' && (rubric?.flagged ? (
                <div style={{ marginTop: '1rem' }}>
                  <p className="p-src" style={{ margin: 0 }}>
                    There is nothing to approve yet — no criteria were written, which is the
                    intended outcome. The next step is a human one: rewrite the standard so it says
                    how performance is judged, then generate again.
                  </p>
                  <button
                    type="button"
                    className="p-btn ghost"
                    onClick={() => standardRef.current?.focus()}
                    style={{ marginTop: '0.75rem' }}
                  >
                    Rewrite the standard
                  </button>
                </div>
              ) : (
                <button className="p-btn" onClick={handleApprove} disabled={approveRubric.loading} style={{ marginTop: '1rem' }}>
                  {approveRubric.loading ? 'Approving…' : 'Approve rubric'}
                </button>
              ))}
            </>
          ) : (
            <p>Loading rubric…</p>
          )}
        </div>
      )}
    </>
  );
}
