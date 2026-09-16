'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../_auth/AuthProvider';
import { authenticatedFetch } from '../../lib/auth-fetch';
import { useApiQuery } from '../_learning/useLearning';
import { unlockedLessonIds } from './Lessons';
import { usePrefs } from './prefs';

/* The one chat. Bottom-right of every student screen. Which grounding it
   uses depends on what is on screen:

     real course   -> Sourcerer over that course's approved sources
                      (/api/learning/tutor). Cite-or-refuse; every turn is
                      recorded for the class view, never attributed.
     mock course   -> Anchor over the doctrine corpus (/api/doctrine) when a
                      service is configured; a small script otherwise, and the
                      header says so.
     no course     -> Anchor over the doctrine corpus, or the same script.

   Never an ungrounded model. Citations from either backend are normalised to
   one shape (see `normaliseCitation`) so the renderer is the same. */

const SUGGEST = {
  M092721: [
    'How do I calculate SWR from forward and reflected power?',
    'What is the difference between a cause and a symptom in fault isolation?',
    'Why does bonding matter at RF?',
  ],
  M09CVS1: [
    'What are the steps for net entry?',
    'What is a proword?',
    'What does PMCS cover on the AN/PRC-117G?',
  ],
};

const DOCTRINE_SUGGEST = [
  'What is sight alignment?',
  'How do I correct trigger jerk?',
  'What is the maximum effective range of a Javelin missile?',
];

// Scripted fallback. Keyed by a regex over the question; the answer shape
// matches what the doctrine service returns so the renderer is the same.
const SCRIPT = [
  {
    match: /swr|standing wave/i,
    answer:
      'Convert the power ratio to a voltage ratio first. The reflection coefficient is the square root of reflected over forward power — √(4 W / 100 W) = 0.2. SWR is then (1 + Γ) / (1 − Γ) = 1.2 / 0.8 = 1.5 : 1. [1] The common miss is using the raw power ratio (0.04), which gives about 1.08 : 1 and understates the mismatch.',
    citations: [{ n: 1, citation: 'Student Outline — RF Fundamentals, "Transmission Lines", para 4', pub_id: 'POI 2841 §4.2' }],
  },
  {
    match: /cause|symptom|vswr|fault isolation/i,
    answer:
      'A symptom is what you observe; a cause is what you can fix. High VSWR, power foldback and low output are all downstream effects of one impedance mismatch — a damaged or water-intruded connector is the physical cause. [1] Signal-flow isolation works stage by stage from the last known-good point toward the fault, so your first step is never "check the meter that told you there was a problem."',
    citations: [{ n: 1, citation: 'Student Outline — Fault Isolation Procedures, "Cause vs. symptom", para 2', pub_id: 'POI 2841 §6.1' }],
  },
  {
    match: /bond|ground/i,
    answer:
      'Bonding provides a low-impedance path between metallic parts so they sit at the same potential. At RF this matters because a strap or wire that is a meaningful fraction of a wavelength stops behaving like a short — it has reactance — so strap selection and length are part of the standard, not just contact. [1]',
    citations: [{ n: 1, citation: 'Student Outline — Grounding & Bonding, "Bonding at RF", para 1', pub_id: 'POI 2841 §3.4' }],
  },
  {
    match: /net entry|enter the net/i,
    answer:
      'Net entry: listen before transmitting, call the net control station using the net call sign, identify yourself, authenticate when challenged, and wait for acknowledgement before passing traffic. [1] The order matters — authenticating before you are challenged is the fumble people make under time pressure.',
    citations: [{ n: 1, citation: 'Student Outline — Radio Fundamentals, "Net entry procedure", para 3', pub_id: 'POI M09CVS1 Annex B' }],
  },
  {
    match: /proword/i,
    answer:
      'A proword is a word or phrase with an assigned meaning used to speed and standardise net traffic — "OVER", "OUT", "ROGER", "WILCO", "SAY AGAIN". Each replaces a sentence, and the meaning is fixed so there is nothing to interpret. [1]',
    citations: [{ n: 1, citation: 'Student Outline — Radio Fundamentals, "Prowords", table 1', pub_id: 'POI M09CVS1 Annex B' }],
  },
  {
    match: /pmcs/i,
    answer:
      'Operator-level PMCS on the AN/PRC-117G covers the before/during/after checks in the -10: case and connectors, battery condition and seating, antenna and connector inspection, power-on self-test, and a comm check. [1] The step people put out of sequence is the antenna check — it comes before power-on, not after.',
    citations: [{ n: 1, citation: 'TM-XXXXX-10, Ch 2, "Operator PMCS", table 2-1', pub_id: 'TM-XXXXX-10' }],
  },
  {
    match: /sight alignment/i,
    answer:
      'Sight alignment is the relationship between the front sight post and the rear sight aperture: the top of the front post centred in the aperture, level with an equal amount of light on each side. [1] Sight picture adds the target — but alignment comes first, because an alignment error grows with range while a picture error does not.',
    citations: [{ n: 1, citation: 'TC 3-22.9, Ch 7, "Aiming — sight alignment"', pub_id: 'TC 3-22.9 §7' }],
  },
  {
    match: /trigger jerk|trigger control/i,
    answer:
      'Trigger jerk is an abrupt rearward pull that disturbs the sights at the instant of firing. Correct it with a steady, increasing pressure straight to the rear, applied so the shot surprises you, with follow-through — hold the sight picture through recoil. [1] Dry-fire with a coin on the barrel exposes it fast.',
    citations: [{ n: 1, citation: 'TC 3-22.9, Ch 8, "Trigger control & follow-through"', pub_id: 'TC 3-22.9 §8' }],
  },
];

const ABSTAIN = {
  abstained: true,
  answer:
    'I can\'t answer that from the approved course material. Nothing in the student outlines or the doctrine indexed for this course supports an answer — ask your instructor, or try rephrasing with the term as it appears in the outline.',
  citations: [],
};

function scripted(q) {
  const hit = SCRIPT.find((s) => s.match.test(q));
  return hit ? { abstained: false, answer: hit.answer, citations: hit.citations } : ABSTAIN;
}

// A student has to have reached a lesson before the tutor will answer from it —
// study aid for reinforcement, not a shortcut around the lesson (#63). There is
// no real link between the doctrine corpus and a mock course's lesson content,
// so this is a best-effort keyword match on lesson titles, for the mock course
// on screen; real courses and the bare doctrine mode have nothing to gate.
const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'before', 'their', 'there', 'these', 'those',
  'which', 'while', 'would', 'could', 'should', 'where', 'when', 'what', 'with', 'from', 'into',
]);
function keywordsOf(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4 && !STOPWORDS.has(w));
}

function useLockedLessons(course) {
  const prefs = usePrefs();
  const mock = course && !course.record && Array.isArray(course.topics) ? course : null;
  return useMemo(() => {
    if (!mock) return [];
    const { ids, flat } = unlockedLessonIds(mock, prefs.progress);
    const unlockedKeywords = new Set(flat.filter((l) => ids.has(l.id)).flatMap((l) => keywordsOf(l.title)));
    return flat
      .filter((l) => !ids.has(l.id))
      .map((lesson) => ({ lesson, keywords: keywordsOf(lesson.title).filter((k) => !unlockedKeywords.has(k)) }))
      .filter((x) => x.keywords.length > 0);
  }, [mock, prefs.progress]);
}

function findLockedLesson(lockedLessons, question) {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;
  const hit = lockedLessons.find(({ keywords }) => keywords.some((k) => q.includes(` ${k} `)));
  return hit?.lesson || null;
}

/* Anchor returns { n, citation, pub_id, page_printed }; Sourcerer returns
   { label, source, page }. One shape for the renderer. */
export function normaliseCitation(c, i) {
  return {
    n: c.n ?? i + 1,
    citation: c.citation ?? c.label ?? c.source ?? 'source',
    pub_id: c.pub_id ?? c.source ?? c.sourceId ?? '',
    page: c.page_printed ?? c.page ?? null,
  };
}

export default function CourseChat({ course = null, view = null }) {
  const { user, loading, ready } = useAuth();
  if (!ready || loading || !user) return null;
  return <SignedInCourseChat key={`${user.uid}:${course?.id || 'doctrine'}`} course={course} view={view} />;
}

function SignedInCourseChat({ course, view }) {
  const tutorMode = Boolean(course?.record);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null); // { ready, baseUrl?, reason? }
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  const lockedLessons = useLockedLessons(course);

  // Tutor mode needs the course's approved source ids (learner envelopes keep
  // sourceIds; only answer keys are stripped).
  const { data: envelope } = useApiQuery(`/courses/${course?.id}`, { enabled: tutorMode });
  const sourceIds = envelope?.course?.sourceIds || [];

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (tutorMode) return;
    fetch('/api/doctrine')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ready: false }));
  }, [tutorMode]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const grounded = tutorMode ? sourceIds.length > 0 : !!status?.ready;
  const modeLabel = tutorMode
    ? (grounded ? 'Grounded · course sources' : 'Waiting for sources')
    : status === null ? 'Checking…' : grounded ? 'Grounded · doctrine' : 'Scripted demo';
  const modeTitle = tutorMode
    ? `Sourcerer over ${sourceIds.length} approved source${sourceIds.length === 1 ? '' : 's'}`
    : grounded ? `Anchor via ${status.baseUrl}` : status?.reason || 'No doctrine service configured';

  const ask = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText('');
    const history = msgs
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.error))
      .map((m) => ({ role: m.role, text: m.role === 'user' ? m.text : m.answer }));
    setMsgs((m) => [...m, { role: 'user', text: question }]);

    const locked = findLockedLesson(lockedLessons, question);
    if (locked) {
      setMsgs((m) => [...m, {
        role: 'assistant',
        abstained: true,
        locked: true,
        answer: `That's covered in a lesson you haven't reached yet — ${locked.title} (${locked.id}). Work through it first, then I can help you review it.`,
        citations: [],
      }]);
      return;
    }

    setBusy(true);
    let out;
    try {
      const controller = new AbortController();
      requestRef.current = controller;
      if (tutorMode) {
        const res = await authenticatedFetch('/api/learning/tutor', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, sourceIds, history }),
        });
        const json = await res.json().catch(() => ({}));
        out = res.ok
          ? { abstained: Boolean(json.refused), reason: json.reason, answer: json.answer, citations: (json.citations || []).map(normaliseCitation) }
          : { abstained: true, answer: `The tutor could not answer: ${json.error || res.status}.`, citations: [], error: true };
      } else if (grounded) {
        const res = await authenticatedFetch('/api/doctrine', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const json = await res.json().catch(() => ({}));
        out = res.ok
          ? { ...json, citations: (json.citations || []).map(normaliseCitation) }
          : { abstained: true, answer: `The doctrine service could not answer: ${json.error || res.status}.`, citations: [], error: true };
      } else {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
        out = scripted(question);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      out = { abstained: true, answer: 'The grounding service is unreachable.', citations: [], error: true };
    }
    setMsgs((m) => [...m, { role: 'assistant', ...out }]);
    setBusy(false);
  };

  const suggestions = course ? SUGGEST[course.id] || [] : DOCTRINE_SUGGEST;
  const title = course ? 'Ask about this course' : 'Ask the doctrine';
  const subtitle = course ? course.name : 'Grounded by Anchor · cite-or-refuse';
  const placeholder = !course ? 'Ask the doctrine…' : `Ask about ${view === 'lessons' ? 'this lesson' : 'this course'}…`;

  return (
    <>
      {!open && (
        <button className="s-chat-fab" onClick={() => setOpen(true)} aria-label={title}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
            <path d="M8 8h8M8 11.5h5" />
          </svg>
          <span>Ask</span>
        </button>
      )}

      {open && (
        <section className="s-chat" aria-label={title}>
          <header className="s-chat-head">
            <div className="s-chat-title">
              <div>{title}</div>
              <div className="s-chat-sub">{subtitle}</div>
            </div>
            <span className={`s-chat-status${grounded ? ' on' : ''}`} title={modeTitle}>
              <span className="s-chat-dot" />
              {modeLabel}
            </span>
            <button className="s-chat-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>

          <div className="s-chat-body" ref={bodyRef}>
            <div className="s-chat-msg assistant">
              <div className="s-chat-bubble">
                {tutorMode
                  ? 'Answers come only from the approved sources behind this course, with a citation you can open. If they don\'t cover it, I\'ll say so rather than guess.'
                  : 'Answers come only from the approved outlines and doctrine, with a citation you can open. If the material doesn\'t cover it, I\'ll say so rather than guess.'}
              </div>
            </div>

            {msgs.length === 0 && suggestions.length > 0 && (
              <div className="s-chat-suggest">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}

            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div className="s-chat-msg user" key={i}>
                  <div className="s-chat-bubble">{m.text}</div>
                </div>
              ) : (
                <div className={`s-chat-msg assistant${m.abstained ? ' abstain' : ''}`} key={i}>
                  <div className="s-chat-bubble">
                    {m.locked && <div className="s-chat-abstain">Not yet unlocked</div>}
                    {m.abstained && !m.error && !m.locked && <div className="s-chat-abstain">Not in the {tutorMode ? 'course sources' : 'course material'}{m.reason ? ` · ${String(m.reason).replace(/_/g, ' ')}` : ''}</div>}
                    {m.error && <div className="s-chat-abstain">Service error</div>}
                    {m.answer}
                  </div>
                  {m.citations?.length > 0 && (
                    <div className="s-chat-cites">
                      {m.citations.map((c) => (
                        <button key={c.n} className="s-chat-cite" title={c.citation}>
                          <b>[{c.n}]</b> {c.pub_id || c.citation}{c.page ? ` · p.${c.page}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}

            {busy && (
              <div className="s-chat-msg assistant">
                <div className="s-chat-bubble s-chat-typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form
            className="s-chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              disabled={busy || (tutorMode && !grounded)}
            />
            <button type="submit" className="p-btn" disabled={busy || !text.trim() || (tutorMode && !grounded)} aria-label="Send">
              ↑
            </button>
          </form>
          <div className="s-chat-foot">
            Not available during exams. Your instructor sees what the class asks, in aggregate — never who asked.
          </div>
        </section>
      )}
    </>
  );
}
