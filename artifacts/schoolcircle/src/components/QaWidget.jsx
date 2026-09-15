/**
 * "Report an issue" — the QA/product intake, bottom-left.
 *
 * Auto-captures where the tester is and opens a PREFILLED GitHub issue on the repo, so a
 * Marine walking the app can file a bug or an idea without leaving it. This is the front
 * door for the whole product-feedback loop.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

const REPO = 'groundworklms/SchoolCircleLMS';

const TYPES = [
  { v: 'bug', label: '🐞 Bug' },
  { v: 'idea', label: '💡 Idea' },
  { v: 'question', label: '❓ Question' },
];

function viewLabel(pathname) {
  if (!pathname || pathname === '/' || pathname === '/plan') return 'Planning board';
  if (pathname.startsWith('/prototype')) return 'App — Student / Instructor';
  return pathname;
}

export default function QaWidget() {
  const [pathname] = useLocation();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('bug');
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState(null);
  const [toast, setToast] = useState('');

  // Context is client-only (location / innerWidth). Refresh each time the panel opens.
  useEffect(() => {
    if (!open) return;
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

  function submit() {
    const body = (text || '').trim();
    if (!body) return;
    const c = ctx || {
      where: viewLabel(pathname), url: (typeof window !== 'undefined' ? window.location.href : ''),
      viewport: '', time: new Date().toISOString(),
    };
    const tag = type === 'bug' ? 'QA·bug' : type === 'idea' ? 'QA·idea' : 'QA·question';
    const title = `[${tag}] ${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`;
    const issueBody =
      `**Type:** ${type}\n\n${body}\n\n---\n` +
      `**Where:** ${c.where}\n` +
      `**URL:** ${c.url}\n` +
      `**Screen:** ${c.viewport}\n` +
      `**Time:** ${c.time}\n\n` +
      `_Filed via the in-app QA widget._`;
    const url =
      `https://github.com/${REPO}/issues/new` +
      `?title=${encodeURIComponent(title)}` +
      `&body=${encodeURIComponent(issueBody)}` +
      `&labels=${encodeURIComponent('qa')}`;
    window.open(url, '_blank', 'noopener');
    setText('');
    setOpen(false);
    setToast('Opening a prefilled GitHub issue…');
    setTimeout(() => setToast(''), 2600);
  }

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
              placeholder="What did you find, or what needs fixing?"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="scw-btn full" onClick={submit} disabled={!text.trim()}>Submit to repo &rarr;</button>
            <p className="scw-note">Auto-captures your view, screen, URL &amp; time, then opens a prefilled GitHub issue for you to send.</p>
          </div>
        </div>
      )}

      {toast && <div className="scw-toast">{toast}</div>}
    </>
  );
}