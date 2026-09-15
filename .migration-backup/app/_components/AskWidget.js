'use client';

/**
 * "Ask the doctrine" — the grounded tutor, bottom-right.
 *
 * Real, not canned: every question is POSTed to this app's own /api/doctrine route, which
 * proxies Anchor. We render exactly what comes back — a cited answer, an honest refusal, or
 * a calm note when grounding isn't wired — and NEVER fabricate an answer to fill a gap.
 */

import { useEffect, useRef, useState } from 'react';

const SUGGESTIONS = [
  { label: 'Sight alignment?', q: 'What is sight alignment?' },
  { label: 'Fix trigger jerk?', q: 'How do I correct trigger jerk?' },
  { label: 'Javelin range?', q: 'What is the maximum effective range of a Javelin missile?', refuse: true },
];

const GREETING = {
  who: 'ai',
  text: 'Ask me anything from the marksmanship corpus — I answer with a citation, or say plainly when it isn’t covered.',
};

export default function AskWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send(question) {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { who: 'me', text: q }]);
    setBusy(true);
    try {
      const res = await fetch('/api/doctrine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Grounding not configured (503) is a normal state on the cloud build — say so calmly.
        const note =
          data.code === 'NO_DOCTRINE_SERVICE'
            ? 'Grounding runs on the edge device. Connect Anchor (set DOCTRINE_BASE_URL) to enable the tutor here.'
            : (data.error || 'The tutor is unavailable right now.');
        setMessages((m) => [...m, { who: 'ai', note: true, text: note }]);
      } else if (data.abstained) {
        setMessages((m) => [...m, {
          who: 'ai', refuse: true,
          text: data.answer || 'That isn’t supported by the doctrine on this device.',
          reason: data.abstainReason,
        }]);
      } else {
        setMessages((m) => [...m, {
          who: 'ai',
          text: data.answer || '(no answer returned)',
          citations: Array.isArray(data.citations) ? data.citations : [],
          meta: data.topScore != null ? `rerank ${Number(data.topScore).toFixed(2)}${data.ms ? ` · ${data.ms}ms` : ''}` : null,
        }]);
      }
    } catch {
      setMessages((m) => [...m, { who: 'ai', note: true, text: 'Couldn’t reach the tutor. Check your connection and try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="scw-fab ask" aria-label="Ask the doctrine" onClick={() => setOpen((o) => !o)}>
        <span className="flab">Ask the doctrine</span>
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      </button>

      {open && (
        <div className="scw-wgt ask" role="dialog" aria-label="Ask the doctrine">
          <div className="scw-head">
            <span className="wi">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </span>
            <div>
              <div className="wt">Ask the doctrine</div>
              <div className="ws">grounded by Anchor &middot; cite-or-refuse</div>
            </div>
            <button className="wx" aria-label="Close" onClick={() => setOpen(false)}>&times;</button>
          </div>

          <div className="scw-body" ref={chatRef}>
            <div className="scw-chips">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} className={`scw-chip${s.refuse ? ' refuse' : ''}`} onClick={() => send(s.q)}>{s.label}</button>
              ))}
            </div>
            <div className="scw-chat">
              {messages.map((m, i) => (
                <div key={i} className={`scw-bubble ${m.who}${m.refuse ? ' refuse' : ''}${m.note ? ' note' : ''}`}>
                  <div>{m.text}</div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="scw-cites">
                      {m.citations.map((c, j) => (
                        <div key={j} className="scw-cite">
                          <b>[{c.n ?? j + 1}]</b>{' '}
                          {c.citation || c.pub_id || 'source'}
                          {c.page_printed ? ` · p. ${c.page_printed}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.reason && <div className="scw-meta">not in corpus &middot; {m.reason}</div>}
                  {m.meta && <div className="scw-meta">{m.meta}</div>}
                </div>
              ))}
              {busy && (
                <div className="scw-bubble ai"><span className="scw-dots"><span></span><span></span><span></span></span></div>
              )}
            </div>
          </div>

          <div className="scw-foot">
            <div className="scw-askbar">
              <input
                ref={inputRef}
                className="scw-ti"
                placeholder="Type a question…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              />
              <button className="scw-btn" onClick={() => send()} disabled={busy || !input.trim()}>Ask</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
