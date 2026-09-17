'use client';

/**
 * "Report an issue" — the QA/product intake, bottom-left.
 *
 * Auto-captures where the tester is and files a GitHub issue on the repo directly from
 * the app (via /api/feedback), so a Marine walking the app can file a bug or an idea
 * without leaving it or needing a GitHub account. This is the front door for the whole
 * product-feedback loop.
 *
 * Reporter name + team key are remembered in localStorage so testers enter them once.
 * If the deployment has no GITHUB_FEEDBACK_TOKEN the API answers 503 and we fall back
 * to opening a prefilled github.com/issues/new tab.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const REPO = 'groundworklms/SchoolCircleLMS';
const STORE = 'schoolcircle.feedback';

const TYPES = [
  { v: 'bug', label: '🐞 Bug' },
  { v: 'idea', label: '💡 Idea' },
  { v: 'question', label: '❓ Question' },
];

function viewLabel(pathname) {
  if (!pathname || pathname === '/') return 'Landing (home)';
  if (pathname.startsWith('/prototype/instructor')) return `App — Instructor (${pathname})`;
  if (pathname.startsWith('/prototype')) return `App — Student (${pathname})`;
  if (pathname === '/login') return 'Sign in';
  if (pathname.startsWith('/plan')) return 'Planning board';
  return pathname;
}

function loadIdentity() {
  try {
    return JSON.parse(window.localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

/* The QA intake is an internal testing tool, not a product surface: it files
 * GitHub issues on our own repo and has no place in a demo or in front of a
 * judge. It is off by default and opts in only when a tester asks for it with
 * ?qa=1 (sticky for the tab via sessionStorage) -- so we keep the tool without
 * shipping a stray "report a bug" button on the live app. */
function qaEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('qa') === '1') {
      window.sessionStorage.setItem('schoolcircle.qa', '1');
    }
    return window.sessionStorage.getItem('schoolcircle.qa') === '1';
  } catch {
    return false;
  }
}

export default function QaWidget() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { setEnabled(qaEnabled()); }, []);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('bug');
  const [text, setText] = useState('');
  const [reporter, setReporter] = useState('');
  const [teamKey, setTeamKey] = useState('');
  const [ctx, setCtx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null); // string | { text, href }

  useEffect(() => {
    const saved = loadIdentity();
    if (saved.reporter) setReporter(saved.reporter);
    if (saved.key) setTeamKey(saved.key);
  }, []);

  // Context is client-only (location / innerWidth). Refresh each time the panel opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    setCtx({
      where: viewLabel(pathname),
      url: window.location.href,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      time: new Date().toISOString(),
    });
  }, [open, pathname]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function showToast(t) {
    setToast(t);
    setTimeout(() => setToast(null), 6000);
  }

  // Fallback when the server has no token: prefilled issue page in a new tab.
  function openPrefilled(c, body) {
    const tag = type === 'bug' ? 'QA·bug' : type === 'idea' ? 'QA·idea' : 'QA·question';
    const title = `[${tag}] ${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`;
    const issueBody =
      `**Type:** ${type}\n\n${body}\n\n---\n` +
      `**Where:** ${c.where}\n**URL:** ${c.url}\n**Screen:** ${c.viewport}\n**Time:** ${c.time}\n\n` +
      `_Filed via the in-app QA widget._`;
    window.open(
      `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}` +
        `&body=${encodeURIComponent(issueBody)}&labels=${encodeURIComponent('qa')}`,
      '_blank',
      'noopener',
    );
  }

  async function submit() {
    const body = (text || '').trim();
    const who = (reporter || '').trim();
    if (!body || busy) return;
    if (!who) {
      setError('Please add your name so we know who to follow up with.');
      return;
    }
    const c = ctx || {
      where: viewLabel(pathname), url: (typeof window !== 'undefined' ? window.location.href : ''),
      viewport: '', time: new Date().toISOString(),
    };
    try { window.localStorage.setItem(STORE, JSON.stringify({ reporter, key: teamKey })); } catch {}

    setBusy(true);
    setError('');
    try {
      const firstLine = body.split('\n')[0];
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-feedback-key': teamKey },
        body: JSON.stringify({
          type,
          title: firstLine.slice(0, 80) + (firstLine.length > 80 ? '…' : ''),
          description: body,
          context: {
            where: c.where,
            url: c.url,
            viewport: c.viewport,
            userAgent: navigator.userAgent,
            build: process.env.NEXT_PUBLIC_GIT_SHA || 'unknown',
            reporter: who,
          },
        }),
      });
      if (res.status === 503) {
        openPrefilled(c, body);
        setText('');
        setOpen(false);
        showToast('Direct filing is off here — opening a prefilled GitHub issue…');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setText('');
      setOpen(false);
      showToast({ text: `Filed #${data.number} — thanks!`, href: data.url });
    } catch (err) {
      setError(err.message || 'Could not file the issue.');
    } finally {
      setBusy(false);
    }
  }

  // Every hook above runs unconditionally; only the render is gated, so the
  // hook order is stable whether or not QA mode is on.
  if (!enabled) return null;

  return (
    <>
      <button className="scw-fab issue" aria-label="Report an issue" onClick={() => setOpen((o) => !o)}>
        <span className="flab">Report an issue (QA)</span>
        <svg viewBox="0 0 24 24"><path d="M12 8v13M5 10a7 7 0 0 1 14 0v4a7 7 0 0 1-14 0z" /></svg>
      </button>

      {open && (
        <div className="scw-wgt issue" role="dialog" aria-label="Report an issue">
          <div className="scw-head">
            <span className="wi">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v13M5 10a7 7 0 0 1 14 0v4a7 7 0 0 1-14 0z" /></svg>
            </span>
            <div>
              <div className="wt">Report an issue</div>
              <div className="ws">files a GitHub issue with your location</div>
            </div>
            <button className="wx" aria-label="Close" onClick={() => setOpen(false)}>&times;</button>
          </div>

          <div className="scw-body">
            {ctx && (
              <div className="scw-ctx">
                <b>Where:</b> {ctx.where}<br />
                <b>Screen:</b> {ctx.viewport} &middot; captured {ctx.time.slice(11, 16)} UTC
              </div>
            )}
            <select className="scw-field" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <textarea
              className="scw-field"
              placeholder="What did you find, or what needs fixing? First line becomes the title."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="scw-row">
              <input
                className="scw-field"
                placeholder="Your name (required)"
                required
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
              />
              <input
                className="scw-field"
                type="password"
                placeholder="Team key"
                autoComplete="off"
                value={teamKey}
                onChange={(e) => setTeamKey(e.target.value)}
              />
            </div>
            {error && <p className="scw-err">{error}</p>}
            <button className="scw-btn full" onClick={submit} disabled={!text.trim() || !reporter.trim() || busy}>
              {busy ? 'Filing…' : 'Submit to repo →'}
            </button>
            <p className="scw-note">Files the issue directly — no GitHub account needed. Your view, screen, URL, build &amp; time are attached.</p>
          </div>
        </div>
      )}

      {toast && (
        <div className="scw-toast">
          {typeof toast === 'string' ? toast : (
            <a href={toast.href} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{toast.text}</a>
          )}
        </div>
      )}
    </>
  );
}
