'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const POLL_MS = 1000;
const EVENT_START = new Date('2026-09-15T09:00:00');

/** Split raw markdown into a title + one section per `## ` heading. */
function parsePlan(raw) {
  const lines = raw.split(/\r?\n/);
  let title = 'Hackathon Planning Board';
  const sections = [];
  let current = null;
  let preamble = [];

  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h1 && !current && sections.length === 0) {
      title = h1[1].trim();
      continue;
    }
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else preamble.push(line);
  }
  if (current) sections.push(current);

  const intro = preamble.join('\n').trim();
  if (intro) sections.unshift({ heading: null, body: intro.split('\n') });

  return {
    title,
    sections: sections.map((s, i) => ({
      id: i,
      heading: s.heading,
      body: s.body.join('\n').trim(),
    })),
  };
}

function useCountdown(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const ms = target.getTime() - now;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return { days, hours, past: ms < 0 };
}

export default function Board() {
  const [raw, setRaw] = useState('');
  const [stale, setStale] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [, setTick] = useState(0);
  const [scale, setScale] = useState(1);
  const [flow, setFlow] = useState(false);
  const lastRef = useRef(null);

  // --- poll the markdown file ---
  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/plan', { cache: 'no-store' });
      const data = await res.json();
      setStale(false);
      if (data.content !== lastRef.current) {
        const first = lastRef.current === null;
        lastRef.current = data.content;
        setRaw(data.content);
        setUpdatedAt(Date.now());
        if (!first) {
          setPulse(true);
          setTimeout(() => setPulse(false), 1200);
        }
      }
    } catch {
      setStale(true);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // re-render the "updated Xs ago" label
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // --- restore + persist display prefs ---
  useEffect(() => {
    const s = parseFloat(localStorage.getItem('board.scale') || '1');
    if (!Number.isNaN(s)) setScale(s);
    setFlow(localStorage.getItem('board.flow') === '1');
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(scale));
    localStorage.setItem('board.scale', String(scale));
  }, [scale]);

  useEffect(() => {
    localStorage.setItem('board.flow', flow ? '1' : '0');
  }, [flow]);

  // --- keyboard controls ---
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(2.6, +(s + 0.1).toFixed(2)));
      else if (e.key === '-' || e.key === '_') setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(2)));
      else if (e.key === '0') setScale(1);
      else if (e.key.toLowerCase() === 'v') setFlow((f) => !f);
      else if (e.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { title, sections } = parsePlan(raw);
  const { days, hours, past } = useCountdown(EVENT_START);

  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  const agoLabel =
    ago === null ? 'connecting…' : ago < 10 ? 'just now' : ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        <div className="countdown">
          {past ? (
            <span className="num">LIVE</span>
          ) : (
            <>
              <span className="num">{days}</span>
              <span className="lbl">days</span>
              <span className="num">{hours}</span>
              <span className="lbl">hrs to kickoff</span>
            </>
          )}
        </div>
        <div className="live" title={stale ? 'Lost connection to the dev server' : 'Watching PLAN.md'}>
          <span className={`dot${pulse ? ' pulse' : ''}${stale ? ' stale' : ''}`} />
          <span>{stale ? 'disconnected' : `updated ${agoLabel}`}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[
            ['/prototype', 'Prototype', 'var(--accent)'],
            ['/learn', 'Learn app', 'var(--accent-2)'],
            ['/teach', 'Teach app', '#f87171'],
          ].map(([href, label, color]) => (
            <a
              key={href}
              href={href}
              style={{
                fontSize: '0.8em',
                color,
                textDecoration: 'none',
                border: '1px solid var(--border)',
                borderRadius: '999px',
                padding: '0.2rem 0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              {label} →
            </a>
          ))}
        </div>
        <div className="hint">
          <kbd>f</kbd> full <kbd>v</kbd> view <kbd>+</kbd>/<kbd>-</kbd> size
        </div>
      </header>

      <main className={`board${flow ? ' flow' : ''}`}>
        {sections.length === 0 && <div className="empty">Waiting for content in PLAN.md…</div>}
        {sections.map((s) => (
          <section className="card" key={s.id}>
            {s.heading && <h2>{s.heading}</h2>}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
          </section>
        ))}
      </main>
    </div>
  );
}
