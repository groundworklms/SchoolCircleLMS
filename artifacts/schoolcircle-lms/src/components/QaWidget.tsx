import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';

const REPO = 'groundworklms/SchoolCircleLMS';
const STORE = 'schoolcircle.feedback';
const MAX_DESCRIPTION_LENGTH = 10_000;

const TYPES = [
  { v: 'bug', label: '🐞 Bug' },
  { v: 'idea', label: '💡 Idea' },
  { v: 'question', label: '❓ Question' },
] as const;

type FeedbackType = (typeof TYPES)[number]['v'];

type FeedbackContext = {
  pathname: string;
  where: string;
  url: string;
  viewport: string;
  userAgent: string;
  build: string;
  time: string;
  reporter: string;
};

type SavedIdentity = {
  reporter: string;
  teamKey: string;
};

type IssueLink = {
  number: number;
  url: string;
};

type FeedbackResponse = {
  number: number;
  url: string;
};

function isFeedbackType(value: string): value is FeedbackType {
  return TYPES.some((item) => item.v === value);
}

function viewLabel(pathname: string) {
  if (!pathname || pathname === '/') return 'Landing (home)';
  if (pathname === '/plan') return 'Planning board';
  if (pathname.startsWith('/prototype')) return 'App — Student / Instructor';
  return pathname;
}

function loadIdentity(): SavedIdentity {
  if (typeof window === 'undefined') return { reporter: '', teamKey: '' };

  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORE) || 'null');
    if (!saved || typeof saved !== 'object') return { reporter: '', teamKey: '' };

    const record = saved as Record<string, unknown>;
    return {
      reporter: typeof record.reporter === 'string' ? record.reporter : '',
      // `key` is the persisted name used by the original widget. Accept
      // `teamKey` as well so an older localStorage entry is still useful.
      teamKey: typeof record.key === 'string'
        ? record.key
        : typeof record.teamKey === 'string'
          ? record.teamKey
          : '',
    };
  } catch {
    return { reporter: '', teamKey: '' };
  }
}

function captureContext(pathname: string): FeedbackContext {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';

  return {
    pathname,
    where: viewLabel(pathname),
    url: hasWindow ? window.location.href : '',
    viewport: hasWindow ? `${window.innerWidth}×${window.innerHeight}` : '',
    userAgent: hasNavigator ? navigator.userAgent : '',
    build: import.meta.env.VITE_GIT_SHA || 'unknown',
    time: new Date().toISOString(),
    reporter: '',
  };
}

function buildIssueDraft(
  type: FeedbackType,
  body: string,
  context: FeedbackContext,
) {
  const tag = type === 'bug' ? 'QA·bug' : type === 'idea' ? 'QA·idea' : 'QA·question';
  const title = `[${tag}] ${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`;
  const issueBody = [
    `**Type:** ${type}`,
    '',
    body,
    '',
    '---',
    `**Where:** ${context.where}`,
    `**Path:** ${context.pathname}`,
    `**URL:** ${context.url}`,
    `**Screen:** ${context.viewport}`,
    `**Browser:** ${context.userAgent || '?'}`,
    `**Build:** ${context.build}`,
    `**Time:** ${context.time}`,
    `**Reporter:** ${context.reporter || 'anonymous'}`,
    '',
    '_Filed via the in-app QA widget._',
  ].join('\n');

  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}` +
    `&body=${encodeURIComponent(issueBody)}&labels=${encodeURIComponent('qa')}`;
}

function isFeedbackResponse(value: unknown): value is FeedbackResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.number === 'number' &&
    Number.isInteger(record.number) &&
    record.number > 0 &&
    typeof record.url === 'string' &&
    record.url.length > 0;
}

function responseError(value: unknown, status: number) {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  return `HTTP ${status}`;
}

export default function QaWidget() {
  const [pathname] = useLocation();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [text, setText] = useState('');
  const [reporter, setReporter] = useState('');
  const [teamKey, setTeamKey] = useState('');
  const [context, setContext] = useState<FeedbackContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftHref, setDraftHref] = useState('');
  const [success, setSuccess] = useState<IssueLink | null>(null);

  useEffect(() => {
    const saved = loadIdentity();
    setReporter(saved.reporter);
    setTeamKey(saved.teamKey);
  }, []);

  // Location and viewport are client-only. Refresh them each time the panel opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    setDraftHref('');
    setSuccess(null);
    setContext(captureContext(pathname));
  }, [open, pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function submit() {
    const body = text.trim();
    if (busy) return;
    if (!body) {
      setError('Please describe the issue before submitting.');
      return;
    }
    if (body.length > MAX_DESCRIPTION_LENGTH) {
      setError(`Please keep the report under ${MAX_DESCRIPTION_LENGTH.toLocaleString()} characters.`);
      return;
    }

    const captured = context || captureContext(pathname);
    const submissionContext = { ...captured, reporter };
    const firstLine = body.split('\n')[0].trim();

    try {
      window.localStorage.setItem(STORE, JSON.stringify({ reporter, key: teamKey }));
    } catch {
      // Filing should still work when storage is unavailable.
    }

    setBusy(true);
    setError('');
    setDraftHref('');
    setSuccess(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-feedback-key': teamKey,
        },
        body: JSON.stringify({
          type,
          title: firstLine.slice(0, 80) + (firstLine.length > 80 ? '…' : ''),
          description: body,
          context: {
            // Keep the source API's where/url fields for the server while also
            // sending the raw pathname used by the Replit app.
            pathname: submissionContext.pathname,
            where: submissionContext.where,
            url: submissionContext.url,
            viewport: submissionContext.viewport,
            userAgent: submissionContext.userAgent,
            build: submissionContext.build,
            reporter: submissionContext.reporter,
          },
        }),
      });

      if (response.status === 503) {
        // A 503 means direct filing is unavailable. Do not open a tab from an
        // async callback or claim that this report was filed.
        setDraftHref(buildIssueDraft(type, body, submissionContext));
        setError('Direct filing is unavailable on this deployment. You can open a prefilled GitHub issue draft instead.');
        return;
      }

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        // The status below still gives the user an actionable error.
      }

      if (!response.ok) {
        throw new Error(responseError(data, response.status));
      }
      if (!isFeedbackResponse(data)) {
        throw new Error('Feedback service returned an invalid response.');
      }

      setText('');
      setOpen(false);
      setSuccess({ number: data.number, url: data.url });
    } catch (submissionError: unknown) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Could not file the issue.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="scw-fab issue"
        aria-label="Report an issue"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flab">Report an issue (QA)</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8v13M5 10a7 7 0 0 1 14 0v4a7 7 0 0 1-14 0z" />
        </svg>
      </button>

      {open && (
        <div className="scw-wgt issue" role="dialog" aria-label="Report an issue">
          <div className="scw-head">
            <span className="wi">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 8v13M5 10a7 7 0 0 1 14 0v4a7 7 0 0 1-14 0z" />
              </svg>
            </span>
            <div>
              <div className="wt">Report an issue</div>
              <div className="ws">files a GitHub issue with your location</div>
            </div>
            <button className="wx" aria-label="Close" onClick={() => setOpen(false)}>
              &times;
            </button>
          </div>

          <div className="scw-body">
            {context && (
              <div className="scw-ctx">
                <b>Where:</b> {context.where}<br />
                <b>Screen:</b> {context.viewport} &middot; captured {context.time.slice(11, 16)} UTC
              </div>
            )}
            <select
              className="scw-field"
              value={type}
              onChange={(event) => {
                if (isFeedbackType(event.target.value)) setType(event.target.value);
              }}
              aria-label="Issue type"
            >
              {TYPES.map((item) => (
                <option key={item.v} value={item.v}>{item.label}</option>
              ))}
            </select>
            <textarea
              className="scw-field"
              placeholder="What did you find, or what needs fixing? First line becomes the title."
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Issue description"
              aria-invalid={Boolean(error)}
            />
            <div className="scw-row">
              <input
                className="scw-field"
                placeholder="Your name"
                value={reporter}
                onChange={(event) => setReporter(event.target.value)}
              />
              <input
                className="scw-field"
                type="password"
                placeholder="Team key"
                autoComplete="off"
                value={teamKey}
                onChange={(event) => setTeamKey(event.target.value)}
              />
            </div>
            {error && (
              <p className="scw-err" role="alert">
                {error}{draftHref && (
                  <>
                    {' '}
                    <a href={draftHref} target="_blank" rel="noopener noreferrer">
                      Open issue draft →
                    </a>
                  </>
                )}
              </p>
            )}
            <button className="scw-btn full" onClick={submit} disabled={!text.trim() || busy}>
              {busy ? 'Filing…' : 'Submit to repo →'}
            </button>
            <p className="scw-note">
              Files the issue directly — no GitHub account needed. Your view, screen, URL, build &amp; time are attached.
            </p>
          </div>
        </div>
      )}

      {success && (
        <div className="scw-toast" role="status">
          <a href={success.url} target="_blank" rel="noopener noreferrer">
            Filed #{success.number} — thanks!
          </a>
        </div>
      )}
    </>
  );
}