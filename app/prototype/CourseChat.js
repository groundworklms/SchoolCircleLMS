'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../_auth/AuthProvider';
import { authenticatedFetch } from '../../lib/auth-fetch';

/* Floating course chat. Bottom-right of every course screen.
   Real when a grounded doctrine service is configured (DOCTRINE_BASE_URL):
   questions go to /api/doctrine and come back with citations, or an honest
   abstention. Without one, it answers from a small script so the interaction
   can still be demoed — and says so in the header. Never an ungrounded model. */

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

export default function CourseChat({ course, view }) {
  const { user, loading, ready } = useAuth();
  if (!ready || loading || !user) return null;
  return <SignedInCourseChat key={`${user.uid}:${course.id}`} course={course} view={view} />;
}

function SignedInCourseChat({ course, view }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null); // { ready, baseUrl?, reason? }
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    fetch('/api/doctrine')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ready: false }));
  }, []);

  useEffect(() => {
    setMsgs([]);
  }, [course.id]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const grounded = !!status?.ready;

  const ask = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText('');
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    let out;
    try {
      if (grounded) {
        const controller = new AbortController();
        requestRef.current = controller;
        const res = await authenticatedFetch('/api/doctrine', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });
        const json = await res.json();
        out = res.ok ? json : { abstained: true, answer: `The doctrine service could not answer: ${json.error || res.status}.`, citations: [], error: true };
      } else {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 400));
        out = scripted(question);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      out = { abstained: true, answer: 'The doctrine service is unreachable.', citations: [], error: true };
    }
    setMsgs((m) => [...m, { role: 'assistant', ...out }]);
    setBusy(false);
  };

  const suggestions = SUGGEST[course.id] || [];

  return (
    <>
      {!open && (
        <button className="s-chat-fab" onClick={() => setOpen(true)} aria-label="Ask about this course">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
            <path d="M8 8h8M8 11.5h5" />
          </svg>
          <span>Ask</span>
        </button>
      )}

      {open && (
        <section className="s-chat" aria-label="Course assistant">
          <header className="s-chat-head">
            <div className="s-chat-title">
              <div>Ask about this course</div>
              <div className="s-chat-sub">{course.name}</div>
            </div>
            <span className={`s-chat-status${grounded ? ' on' : ''}`} title={grounded ? `Grounded via ${status.baseUrl}` : status?.reason || 'No doctrine service configured'}>
              <span className="s-chat-dot" />
              {status === null ? 'Checking…' : grounded ? 'Grounded' : 'Scripted demo'}
            </span>
            <button className="s-chat-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>

          <div className="s-chat-body" ref={bodyRef}>
            <div className="s-chat-msg assistant">
              <div className="s-chat-bubble">
                Answers come only from the approved outlines and doctrine indexed for this course, with a citation you can open.
                If the material doesn&apos;t cover it, I&apos;ll say so rather than guess.
              </div>
            </div>

            {msgs.length === 0 && (
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
                    {m.abstained && !m.error && <div className="s-chat-abstain">Not in the course material</div>}
                    {m.error && <div className="s-chat-abstain">Service error</div>}
                    {m.answer}
                  </div>
                  {m.citations?.length > 0 && (
                    <div className="s-chat-cites">
                      {m.citations.map((c) => (
                        <button key={c.n} className="s-chat-cite" title={c.citation}>
                          <b>[{c.n}]</b> {c.pub_id}{c.page_printed ? ` · p.${c.page_printed}` : ''}
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
              placeholder={`Ask about ${view === 'lessons' ? 'this lesson' : 'this course'}…`}
              disabled={busy}
            />
            <button type="submit" className="p-btn" disabled={busy || !text.trim()} aria-label="Send">
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
