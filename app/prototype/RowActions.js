'use client';

/**
 * The "three dots" menu for a library row: rename, and remove.
 *
 * Sources, rubrics and courses had no row actions at all, so a mistyped title
 * was permanent and a record could never be cleared. This is the one control
 * for both, shared so the three libraries behave identically.
 *
 * Two deliberate choices:
 *
 *   Rename is the only edit. Source text and generated course content are not
 *   free-text editable -- #78 retired the manual editors and content changes go
 *   through the grounded AI revision flow so every lesson keeps a citation.
 *   A label is metadata, so it is safe to change here.
 *
 *   Remove asks first, and the server decides what removal means. Anything a
 *   learner has worked in is archived instead of deleted, and the server's
 *   reason is shown verbatim rather than being reworded into a success
 *   message -- "archived because learners have 7 attempts" is information the
 *   instructor needs, not an error to hide.
 */

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import './row-actions.css';

function errText(error, fallback) {
  return error?.error || error?.message || fallback;
}

export function RowActions({
  label,
  title,
  endpoint,
  onChanged,
  canRename = true,
  canRemove = true,
  removeNote = null,
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // 'rename' | 'confirm'
  const [draft, setDraft] = useState(title || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const wrapRef = useRef(null);

  // Close on an outside click or Escape, like the account menu does. Without
  // this the menu stays open behind whatever the instructor clicks next.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
        setMode(null);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); setMode(null); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { setDraft(title || ''); }, [title]);

  async function send(method, body) {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await authFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw json;
      return json;
    } catch (error) {
      setErr(errText(error, 'That did not work.'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function rename(event) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === title) { setMode(null); setOpen(false); return; }
    const json = await send('PATCH', { title: next });
    if (json) {
      setMode(null);
      setOpen(false);
      onChanged?.();
    }
  }

  async function remove() {
    const json = await send('DELETE');
    if (!json) return;
    setMode(null);
    setOpen(false);
    // An archive is not a failure, but it is not what was asked for either.
    // Say which happened, in the server's words.
    if (json.archived && json.reason) setNotice(json.reason);
    onChanged?.();
  }

  if (!canRename && !canRemove) return null;

  return (
    <div className="row-actions" ref={wrapRef}>
      <button
        type="button"
        className="row-actions-trigger"
        aria-label={`Actions for ${label || title || 'this item'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setMode(null); setErr(null); }}
        disabled={busy}
      >
        {/* Three dots, drawn rather than typed so it cannot render as tofu. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="3" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </button>

      {open && mode === null && (
        <div className="row-actions-menu" role="menu">
          {canRename && (
            <button type="button" role="menuitem" onClick={() => setMode('rename')}>
              Rename
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => setMode('confirm')}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {open && mode === 'rename' && (
        <form className="row-actions-menu row-actions-form" onSubmit={rename}>
          <label>
            <span>Rename</span>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={200}
              autoFocus
              disabled={busy}
            />
          </label>
          <div className="row-actions-buttons">
            <button type="submit" className="p-btn" disabled={busy || !draft.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="p-btn ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {open && mode === 'confirm' && (
        <div className="row-actions-menu row-actions-form" role="alertdialog">
          <p className="row-actions-confirm">
            Remove <strong>{title || label}</strong>?
          </p>
          {removeNote && <p className="row-actions-note">{removeNote}</p>}
          <div className="row-actions-buttons">
            <button type="button" className="p-btn danger" onClick={remove} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
            <button type="button" className="p-btn ghost" onClick={() => setMode(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {err && <p className="row-actions-error s-shell-error" role="alert">{err}</p>}
      {notice && <p className="row-actions-note" role="status">{notice}</p>}
    </div>
  );
}

export default RowActions;
