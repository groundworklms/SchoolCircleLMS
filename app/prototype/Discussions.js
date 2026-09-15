'use client';

import { useMemo, useState } from 'react';
import { POIS } from './poi';
import { usePrefs, setPref } from './prefs';

/* Student · Discussions. Threads attach to a lesson (or to the course), so
   the question lives next to the material it is about. Unanswered rises to
   the top; instructor replies are marked; the asker marks the answer.
   Mock seed below; anything you post persists in prefs. */

const ME = 'Cpl Rivera';

const SEED = {
  M092721: [
    {
      id: 'd1', lessonId: 'BE.02.04', title: 'Why take the square root for the reflection coefficient?',
      author: 'LCpl Nguyen', role: 'student', when: 'Today 0812',
      body: 'On the SWR worksheet I keep getting 1.08 instead of 1.5. I know the answer is the square root but I do not get WHY power ratio needs it and voltage ratio does not.',
      replies: [
        { id: 'r1', author: 'Cpl Rivera', role: 'student', when: 'Today 0840', body: 'Power goes with voltage squared (P = V²/R). So a power ratio of 0.04 is a voltage ratio of √0.04 = 0.2. SWR is defined on voltages, so you have to get back to voltage first.' },
        { id: 'r2', author: 'SSgt Okafor', role: 'instructor', when: 'Today 0915', body: 'Rivera has it. The one-liner to remember: SWR is a voltage ratio; the meter gives you power. Convert before you compute. This is the single most-missed item in the class right now, so if this thread helps, tell your fire team.', answer: true },
      ],
      resolved: true,
    },
    {
      id: 'd2', lessonId: 'BE.02.04', title: 'Transformer reads warm with nothing connected — is that a fault?',
      author: 'PFC Adeyemi', role: 'student', when: 'Yesterday 1920',
      body: 'Lab bench 4, the 12 V supply transformer is warm to the touch with the secondary disconnected. Should I write it up?',
      replies: [
        { id: 'r3', author: 'Sgt Delgado', role: 'instructor', when: 'Yesterday 2005', body: 'Warm at no load is core loss and it is normal — see the losses page. Hot, or a smell, is a write-up. If you are unsure, take a temp reading and log it with the bench number.', answer: true },
      ],
      resolved: true,
    },
    {
      id: 'd3', lessonId: 'BE.02.03', title: 'Inductor kickback — where does the energy go when the switch opens?',
      author: 'Cpl Rivera', role: 'student', when: 'Thu 1540',
      body: 'We saw the spark on the demo when the switch opened. Where does that energy actually go if there is no flyback diode?',
      replies: [],
      resolved: false,
    },
    {
      id: 'd4', lessonId: null, title: 'Block exam Friday — calculators',
      author: 'SSgt Okafor', role: 'instructor', when: 'Wed 0700', pinned: true,
      body: 'Basic scientific calculators only. Nothing that stores text or connects to anything. If yours is questionable, bring it to me before Friday and I will tell you.',
      replies: [
        { id: 'r4', author: 'LCpl Nguyen', role: 'student', when: 'Wed 0735', body: 'Is the TI-30XS ok?' },
        { id: 'r5', author: 'SSgt Okafor', role: 'instructor', when: 'Wed 0750', body: 'Yes.' },
      ],
      resolved: false,
    },
    {
      id: 'd5', lessonId: 'BE.02.02', title: 'Test equipment: which meter for the low-ohms check on windings?',
      author: 'PFC Adeyemi', role: 'student', when: 'Tue 1105',
      body: 'The Fluke reads 0.3 Ω on everything including my leads. Is there a better meter in the cage for sub-1 Ω?',
      replies: [
        { id: 'r6', author: 'LCpl Nguyen', role: 'student', when: 'Tue 1130', body: 'Zero the leads first (touch them together, hit REL). That took mine from 0.3 to 0.0.' },
      ],
      resolved: false,
    },
  ],
  M09CVS1: [
    {
      id: 'e1', lessonId: 'TI.01.02', title: '/25 vs /26 — how do I know which block a host is in fast?',
      author: 'Cpl Rivera', role: 'student', when: 'Today 0730',
      body: 'On the practical I lose time working the binary. Is there a faster way to see which block 10.20.130.200/26 is in?',
      replies: [
        { id: 'r7', author: 'Sgt Delgado', role: 'instructor', when: 'Today 0802', body: 'Block size. 256 − 192 = 64, so blocks start at 0, 64, 128, 192. 200 is in the 192 block. No binary needed once you have the block size.', answer: true },
      ],
      resolved: true,
    },
    {
      id: 'e2', lessonId: null, title: 'Radio net practical grading sheet — attached',
      author: 'Sgt Delgado', role: 'instructor', when: 'Thu 1105', pinned: true,
      body: 'Grading sheet for the 22 Sep practical is on the course. Read it before you show up. Questions here, not in my inbox, so everyone sees the answer.',
      replies: [],
      resolved: false,
    },
  ],
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'mine', label: 'Mine' },
  { id: 'instructor', label: 'From instructors' },
];

function lessonTitle(course, id) {
  if (!id) return null;
  for (const a of POIS[course.id].annexes) {
    const l = a.lessons.find((x) => x.id === id);
    if (l) return { ...l, annex: a };
  }
  return null;
}

function isUnanswered(t) {
  return !t.resolved && !t.replies.some((r) => r.role === 'instructor' || r.answer);
}

function useThreads(course) {
  const prefs = usePrefs();
  const local = prefs.discussions?.[course.id] || { threads: [], replies: {}, resolved: {} };
  const threads = useMemo(() => {
    const base = (SEED[course.id] || []).map((t) => ({
      ...t,
      replies: [...t.replies, ...(local.replies[t.id] || [])],
      resolved: local.resolved[t.id] ?? t.resolved,
    }));
    const mine = local.threads.map((t) => ({
      ...t,
      replies: local.replies[t.id] || [],
      resolved: local.resolved[t.id] ?? false,
    }));
    return [...mine, ...base];
  }, [course.id, local]);
  const save = (patch) => setPref(`discussions.${course.id}`, { ...local, ...patch });
  return { threads, local, save };
}

function Avatar({ name, role }) {
  const ini = name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  return <span className={`s-dq-av${role === 'instructor' ? ' inst' : ''}`}>{ini}</span>;
}

/* ---------- thread view ---------- */

function Thread({ course, thread, onBack, onOpenLesson, local, save }) {
  const [text, setText] = useState('');
  const lesson = lessonTitle(course, thread.lessonId);
  const mine = thread.author === ME;

  const post = () => {
    const body = text.trim();
    if (!body) return;
    const r = { id: `r${Date.now()}`, author: ME, role: 'student', when: 'Just now', body };
    save({ replies: { ...local.replies, [thread.id]: [...(local.replies[thread.id] || []), r] } });
    setText('');
  };
  const resolve = (v) => save({ resolved: { ...local.resolved, [thread.id]: v } });

  return (
    <div className="s-dq-thread">
      <button className="s-crumbs-inline" onClick={onBack}>← All discussions</button>

      <article className="s-dq-post op">
        <div className="s-dq-meta">
          <Avatar name={thread.author} role={thread.role} />
          <span className="s-dq-who">
            <b>{thread.author}</b>
            {thread.role === 'instructor' && <span className="s-dq-badge">Instructor</span>}
            <span className="s-dq-when">{thread.when}</span>
          </span>
          {thread.pinned && <span className="s-dq-pin">Pinned</span>}
          {thread.resolved && <span className="s-dq-resolved">Resolved</span>}
        </div>
        <h1 className="s-dq-title">{thread.title}</h1>
        {lesson && (
          <button className="s-dq-lesson" onClick={() => onOpenLesson(lesson.id)}>
            <code>{lesson.id}</code> {lesson.title} · Annex {lesson.annex.letter}
          </button>
        )}
        <p className="s-dq-body">{thread.body}</p>
      </article>

      <div className="s-label" style={{ marginTop: '1.4rem' }}>
        {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
      </div>
      <div className="s-dq-replies">
        {thread.replies.map((r) => (
          <article key={r.id} className={`s-dq-post${r.answer ? ' answer' : ''}${r.role === 'instructor' ? ' from-inst' : ''}`}>
            <div className="s-dq-meta">
              <Avatar name={r.author} role={r.role} />
              <span className="s-dq-who">
                <b>{r.author}</b>
                {r.role === 'instructor' && <span className="s-dq-badge">Instructor</span>}
                <span className="s-dq-when">{r.when}</span>
              </span>
              {r.answer && <span className="s-dq-answer">✓ Answer</span>}
            </div>
            <p className="s-dq-body">{r.body}</p>
          </article>
        ))}
        {thread.replies.length === 0 && <p className="s-cal-empty">No replies yet. Instructors see unanswered questions first.</p>}
      </div>

      <div className="s-dq-compose">
        <textarea rows={3} placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="p-btnrow">
          <button className="p-btn" disabled={!text.trim()} onClick={post}>Reply</button>
          {mine && !thread.resolved && <button className="p-btn ghost" onClick={() => resolve(true)}>Mark resolved</button>}
          {mine && thread.resolved && <button className="p-btn ghost" onClick={() => resolve(false)}>Reopen</button>}
          <span className="s-reply-note">Everyone in the course can see this thread. Keep it about the material.</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- list ---------- */

function NewThread({ course, defaultLesson, onCancel, onCreate }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [lessonId, setLessonId] = useState(defaultLesson || '');
  const annexes = POIS[course.id].annexes.filter((a) => a.lessons.length);
  return (
    <div className="s-dq-new">
      <div className="s-label">New question</div>
      <input className="s-dq-input" placeholder="What are you stuck on? One line." value={title} onChange={(e) => setTitle(e.target.value)} />
      <select className="s-dq-select" value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
        <option value="">General — whole course</option>
        {annexes.map((a) => (
          <optgroup key={a.letter} label={`Annex ${a.letter} — ${a.title}`}>
            {a.lessons.map((l) => (
              <option key={l.id} value={l.id}>{l.id} · {l.title}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <textarea rows={4} placeholder="What have you tried? Where exactly did it go wrong?" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="p-btnrow">
        <button className="p-btn" disabled={!title.trim() || !body.trim()} onClick={() => onCreate({ title: title.trim(), body: body.trim(), lessonId: lessonId || null })}>Post</button>
        <button className="p-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Discussions({ course, threadId, lessonFilter, onOpenThread, onOpenLesson }) {
  const { threads, local, save } = useThreads(course);
  const [filter, setFilter] = useState('all');
  const [lessonOnly, setLessonOnly] = useState(lessonFilter || '');
  const [composing, setComposing] = useState(false);

  const thread = threadId ? threads.find((t) => t.id === threadId) : null;
  if (thread) {
    return <Thread course={course} thread={thread} local={local} save={save} onBack={() => onOpenThread(null)} onOpenLesson={onOpenLesson} />;
  }

  const shown = threads
    .filter((t) => (lessonOnly ? t.lessonId === lessonOnly : true))
    .filter((t) => {
      if (filter === 'unanswered') return isUnanswered(t);
      if (filter === 'mine') return t.author === ME || t.replies.some((r) => r.author === ME);
      if (filter === 'instructor') return t.role === 'instructor';
      return true;
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (isUnanswered(b) ? 1 : 0) - (isUnanswered(a) ? 1 : 0));

  const unanswered = threads.filter(isUnanswered).length;
  const byLesson = {};
  threads.forEach((t) => { if (t.lessonId) byLesson[t.lessonId] = (byLesson[t.lessonId] || 0) + 1; });
  const lessonOpts = Object.keys(byLesson).map((id) => lessonTitle(course, id)).filter(Boolean);

  const create = ({ title, body, lessonId }) => {
    const t = { id: `t${Date.now()}`, lessonId, title, body, author: ME, role: 'student', when: 'Just now', pinned: false };
    save({ threads: [t, ...local.threads] });
    setComposing(false);
    onOpenThread(t.id);
  };

  return (
    <>
      <div className="s-cal-head" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 className="p-h">Discussions</h2>
          <p className="p-sub" style={{ marginBottom: 0 }}>
            Questions live next to the lesson they are about. {unanswered > 0 ? `${unanswered} unanswered.` : 'Nothing unanswered.'}
          </p>
        </div>
        {!composing && <button className="p-btn" onClick={() => setComposing(true)}>Ask a question</button>}
      </div>

      {composing && <NewThread course={course} defaultLesson={lessonOnly} onCancel={() => setComposing(false)} onCreate={create} />}

      <div className="s-dq-bar">
        <div className="s-inbox-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'unanswered' && unanswered > 0 && <span className="s-inbox-pill">{unanswered}</span>}
            </button>
          ))}
        </div>
        <select className="s-dq-select small" value={lessonOnly} onChange={(e) => setLessonOnly(e.target.value)}>
          <option value="">Every lesson</option>
          {lessonOpts.map((l) => (
            <option key={l.id} value={l.id}>{l.id} · {l.title} ({byLesson[l.id]})</option>
          ))}
        </select>
      </div>

      <div className="s-dq-list">
        {shown.length === 0 && <p className="s-cal-empty" style={{ padding: '1rem' }}>Nothing here.</p>}
        {shown.map((t) => {
          const lesson = lessonTitle(course, t.lessonId);
          const un = isUnanswered(t);
          const last = t.replies[t.replies.length - 1];
          return (
            <button key={t.id} className={`s-dq-row${un ? ' unanswered' : ''}${t.pinned ? ' pinned' : ''}`} onClick={() => onOpenThread(t.id)}>
              <Avatar name={t.author} role={t.role} />
              <span className="s-dq-row-main">
                <span className="s-dq-row-title">
                  {t.pinned && <span className="s-dq-pin">Pinned</span>}
                  {t.title}
                </span>
                <span className="s-dq-row-meta">
                  {lesson ? <><code>{lesson.id}</code> {lesson.title}</> : 'General'} · {t.author}
                  {t.role === 'instructor' && <span className="s-dq-badge">Instructor</span>} · {t.when}
                </span>
              </span>
              <span className="s-dq-row-side">
                {t.resolved ? (
                  <span className="s-dq-resolved">Resolved</span>
                ) : un ? (
                  <span className="s-dq-un">Unanswered</span>
                ) : (
                  <span className="s-dq-ans">Answered</span>
                )}
                <span className="s-dq-count">{t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}{last ? ` · ${last.when}` : ''}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* For the lesson page side panel. */
export function countForLesson(course, lessonId) {
  return (SEED[course.id] || []).filter((t) => t.lessonId === lessonId).length;
}

export default Discussions;
