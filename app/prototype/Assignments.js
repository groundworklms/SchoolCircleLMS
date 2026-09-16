'use client';

import { useRef, useState } from 'react';
import { usePrefs, setPref } from './prefs';

/* Student · Assignments for one course. Mock, like the rest of the student
   side. Instructor-assigned work with due dates, status, and grades — the
   thing Moodle does that has to survive the transition. */

const ASSIGNMENTS = {
  M092721: [
    {
      id: 'a1',
      title: 'SWR calculation worksheet',
      type: 'Worksheet',
      annex: 'C — Transmission Lines',
      due: '2026-09-16',
      dueLabel: 'Wed 16 Sep · 1900',
      points: 20,
      status: 'not-started',
      view: 'materials',
      desc: 'Ten forward/reflected power pairs. Compute the reflection coefficient and SWR for each, show the square-root step. Submit as a photo of your worked sheet or type the answers in.',
      note: 'Take the square root before you form the ratio. That is the miss the whole class is making.',
    },
    {
      id: 'a2',
      title: 'Lab report — SWR measurement',
      type: 'Lab report',
      annex: 'C — Transmission Lines',
      due: '2026-09-18',
      dueLabel: 'Fri 18 Sep · 1600',
      points: 50,
      status: 'in-progress',
      progress: 40,
      desc: 'Record your measured SWR at three feed points from Wednesday\'s lab, compare against the calculated values, and explain any difference over 0.2. One page.',
      note: null,
    },
    {
      id: 'a3',
      title: 'Fault isolation scenario — write-up',
      type: 'Write-up',
      annex: 'D — Fault Isolation',
      due: '2026-09-24',
      dueLabel: 'Thu 24 Sep · 1900',
      points: 40,
      status: 'not-started',
      desc: 'Given a transmitter with high VSWR after a field install, write the signal-flow isolation sequence you would follow, in order, with the reason for each step.',
      note: 'Cause, not symptom. If your first step is "check the VSWR meter," start over.',
    },
    {
      id: 'a4',
      title: 'Annex C practice set',
      type: 'Practice set',
      annex: 'C — Transmission Lines',
      due: '2026-09-11',
      dueLabel: 'Thu 11 Sep',
      points: 15,
      status: 'graded',
      score: 13,
      submitted: 'Thu 11 Sep · 1842',
      feedback: 'Two misses, both on the cause-vs-symptom item. See the rationale on each — it is the same mistake twice.',
      view: 'materials',
    },
    {
      id: 'a5',
      title: 'Grounding & bonding — field install checklist',
      type: 'Checklist',
      annex: 'B — Grounding & Bonding',
      due: '2026-09-04',
      dueLabel: 'Fri 4 Sep',
      points: 25,
      status: 'graded',
      score: 23,
      submitted: 'Fri 4 Sep · 1120',
      feedback: 'Good. Strap selection was the only deduction.',
    },
    {
      id: 'a6',
      title: 'Test equipment familiarization quiz',
      type: 'Quiz',
      annex: 'C — Test Equipment',
      due: '2026-09-09',
      dueLabel: 'Wed 9 Sep',
      points: 10,
      status: 'submitted',
      submitted: 'Wed 9 Sep · 0755',
      feedback: null,
    },
  ],
  M09CVS1: [
    {
      id: 'b1',
      title: 'Net entry procedure — quiz',
      type: 'Quiz',
      annex: 'B — Radio Fundamentals',
      due: '2026-09-15',
      dueLabel: 'Mon 15 Sep · 0730',
      points: 10,
      status: 'not-started',
      view: 'materials',
      desc: 'Ten items on net entry, prowords, and authentication. Open-note. Complete before the Monday block.',
      note: 'Do the Sunday reading first — it is the whole quiz.',
    },
    {
      id: 'b2',
      title: 'Radio net practical — pre-brief acknowledgement',
      type: 'Acknowledgement',
      annex: 'B — Radio Fundamentals',
      due: '2026-09-21',
      dueLabel: 'Sun 21 Sep · 2359',
      points: 0,
      status: 'not-started',
      desc: 'Read the grading sheet Sgt Delgado attached and acknowledge it. No acknowledgement, no practical.',
      note: null,
    },
    {
      id: 'b3',
      title: 'PMCS worksheet — AN/PRC-117G',
      type: 'Worksheet',
      annex: 'A — Equipment',
      due: '2026-09-05',
      dueLabel: 'Fri 5 Sep',
      points: 20,
      status: 'graded',
      score: 19,
      submitted: 'Thu 4 Sep · 2010',
      feedback: 'Clean. One step out of sequence on the antenna check.',
    },
  ],
};

const STATUS = {
  'not-started': { label: 'Not started', color: 'var(--p-dim)' },
  'in-progress': { label: 'In progress', color: 'var(--p-warning)' },
  submitted: { label: 'Submitted', color: 'var(--p-accent)' },
  graded: { label: 'Graded', color: 'var(--p-good)' },
};

const TABS = [
  { id: 'open', label: 'To do' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'graded', label: 'Graded' },
  { id: 'all', label: 'All' },
];

function isOpen(a) {
  return a.status === 'not-started' || a.status === 'in-progress';
}

/* Used on the course home: the next few open items. */
function dueSoon(courseId, n = 3) {
  return (ASSIGNMENTS[courseId] || []).filter(isOpen).sort((a, b) => a.due.localeCompare(b.due)).slice(0, n);
}

/* Student's own submissions overlay a course's static assignment list —
   status, response text, and attached file names — same localStorage-backed
   pattern as Discussions, since there is no backend yet. */
function useSubmissions(course) {
  const prefs = usePrefs();
  const local = prefs.submissions?.[course.id] || {};
  const save = (id, patch) => setPref(`submissions.${course.id}`, { ...local, [id]: { ...(local[id] || {}), ...patch } });
  return { local, save };
}

/* Inline "start" flow: type a response and/or attach files, then submit —
   moves the assignment to the Submitted tab. */
function Composer({ a, onSubmit, onCancel }) {
  const [response, setResponse] = useState('');
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);

  const addFiles = (list) => {
    const picked = Array.from(list || []);
    if (picked.length) setFiles((f) => [...f, ...picked.map((file) => file.name)]);
  };

  return (
    <div className="s-asg-composer">
      <textarea
        rows={4}
        placeholder="Type your response here, or attach a file below."
        value={response}
        onChange={(e) => setResponse(e.target.value)}
      />
      {files.length > 0 && (
        <div className="s-asg-files">
          {files.map((name, i) => (
            <div className="p-filerow" key={`${name}-${i}`}>
              <span>📎</span>
              <span className="p-fname">{name}</span>
              <button className="p-btn ghost" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <div className="p-btnrow" style={{ marginTop: '0.7rem' }}>
        <button className="p-btn" disabled={!response.trim() && files.length === 0} onClick={() => onSubmit({ response: response.trim(), files })}>
          Submit assignment
        </button>
        <button className="p-btn ghost" onClick={() => fileInput.current?.click()}>Attach files</button>
        <button className="p-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Assignments({ course, go }) {
  const baseList = ASSIGNMENTS[course.id] || [];
  const { local: submissions, save: saveSubmission } = useSubmissions(course);
  const list = baseList.map((a) => {
    const s = submissions[a.id];
    if (!s) return a;
    return { ...a, status: 'submitted', submitted: s.submittedAt, response: s.response, files: s.files, feedback: a.feedback };
  });
  const [tab, setTab] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [composingId, setComposingId] = useState(null);

  const shown = list
    .filter((a) => (tab === 'all' ? true : tab === 'open' ? isOpen(a) : a.status === tab))
    .sort((a, b) => (tab === 'open' ? a.due.localeCompare(b.due) : b.due.localeCompare(a.due)));

  const graded = list.filter((a) => a.status === 'graded');
  const earned = graded.reduce((s, a) => s + a.score, 0);
  const possible = graded.reduce((s, a) => s + a.points, 0);
  const openCount = list.filter(isOpen).length;

  return (
    <>
      <h2 className="p-h">Assignments</h2>
      <p className="p-sub">
        Work your instructors have assigned for this course. Practice sets from your study plan are not graded and live on
        Study Materials, not here.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Open</div>
          <div className="p-tileval">{openCount}</div>
          <div className="p-tilenote">{openCount === 1 ? 'item due' : 'items due'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Next due</div>
          <div className="p-tileval" style={{ fontSize: '1.05em' }}>{dueSoon(course.id, 1)[0]?.dueLabel.split(' · ')[0] || '—'}</div>
          <div className="p-tilenote">{dueSoon(course.id, 1)[0]?.title || 'Nothing open'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Graded so far</div>
          <div className="p-tileval">
            {possible ? Math.round((earned / possible) * 100) : '—'}
            {possible ? <span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>%</span> : null}
          </div>
          <div className="p-tilenote">{earned} of {possible} points</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Awaiting grade</div>
          <div className="p-tileval">{list.filter((a) => a.status === 'submitted').length}</div>
          <div className="p-tilenote">submitted</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>
          Assignments
          <span style={{ float: 'right' }}>
            <span className="p-diff">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </span>
          </span>
        </h3>

        {shown.length === 0 && <p className="p-src">Nothing here.</p>}

        <ul className="s-asg">
          {shown.map((a) => {
            const st = STATUS[a.status];
            const expanded = openId === a.id;
            return (
              <li key={a.id} className={`s-asg-row${expanded ? ' open' : ''}`}>
                <button className="s-asg-head" onClick={() => setOpenId(expanded ? null : a.id)}>
                  <span className="s-asg-main">
                    <span className="s-asg-title">{a.title}</span>
                    <span className="s-asg-meta">
                      {a.type} · Annex {a.annex}
                    </span>
                  </span>
                  <span className="s-asg-due">
                    <span className="s-asg-duelab">{isOpen(a) ? 'Due' : a.status === 'graded' ? 'Graded' : 'Submitted'}</span>
                    <span>{isOpen(a) ? a.dueLabel : a.submitted}</span>
                  </span>
                  <span className="s-asg-pts">
                    {a.status === 'graded' ? (
                      <>
                        <b>{a.score}</b>/{a.points}
                      </>
                    ) : (
                      <>{a.points} pts</>
                    )}
                  </span>
                  <span className="s-asg-status" style={{ color: st.color }}>
                    ● {st.label}
                    {a.status === 'in-progress' && a.progress ? ` · ${a.progress}%` : ''}
                  </span>
                  <span className="s-asg-twisty">{expanded ? '▾' : '▸'}</span>
                </button>

                {expanded && (
                  <div className="s-asg-body">
                    {a.desc && <p>{a.desc}</p>}
                    {a.note && (
                      <div className="p-rationale" style={{ marginTop: '0.5rem' }}>
                        <span className="p-rlab">Instructor note</span>
                        {a.note}
                      </div>
                    )}
                    {a.feedback && (
                      <div className="p-rationale" style={{ marginTop: '0.5rem', borderLeftColor: 'var(--p-good)' }}>
                        <span className="p-rlab" style={{ color: 'var(--p-good)' }}>Feedback</span>
                        {a.feedback}
                      </div>
                    )}
                    {a.status === 'submitted' && !a.feedback && (
                      <p className="p-src">
                        Submitted {a.submitted}. Waiting on the instructor.
                        {a.response && <><br />Your response: “{a.response}”</>}
                        {a.files?.length > 0 && <><br />Attached: {a.files.join(', ')}</>}
                      </p>
                    )}

                    {composingId === a.id ? (
                      <Composer
                        a={a}
                        onCancel={() => setComposingId(null)}
                        onSubmit={({ response, files }) => {
                          saveSubmission(a.id, { submittedAt: 'Just now', response, files });
                          setComposingId(null);
                          setTab('submitted');
                        }}
                      />
                    ) : (
                      <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
                        {isOpen(a) && (
                          <button className="p-btn" onClick={() => setComposingId(a.id)}>
                            {a.status === 'in-progress' ? 'Continue' : 'Start'}
                          </button>
                        )}
                        {a.view && (
                          <button className="p-btn ghost" onClick={() => go(a.view)}>
                            Open Study Materials
                          </button>
                        )}
                        {a.status === 'graded' && <button className="p-btn ghost">View submission</button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

export default Assignments;
export { dueSoon };
