'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import { useApiMutation, useApiQuery } from '../_learning/useLearning';
import { RowActions } from './RowActions';

function message(error, fallback) {
  return error?.error || error?.message || fallback;
}

/**
 * One row in the source library: title, size, preview, and the approval click.
 *
 * Rename and removal are deliberately NOT re-implemented here -- they are the
 * shared RowActions three-dots menu (#113/#119), so a source behaves like a
 * rubric or a course and the server keeps its one removal rule (a source any
 * course still cites is refused with SOURCE_IN_USE).
 */
export function SourceLibraryCard({ source, onPreview, onRefresh, approveLabel = 'Approve' }) {
  const [error, setError] = useState('');
  const approve = useApiMutation(`/sources/${source.id}/approve`, 'POST');
  const pending = source.status !== 'APPROVED';
  const act = async (action) => {
    setError('');
    try {
      await action.mutate();
      await onRefresh();
    } catch (err) {
      setError(message(err, 'That change could not be completed.'));
    }
  };
  return (
    <article className="source-library-card">
      <div className="source-card-copy">
        <h3>{source.title || 'Untitled source'}</h3>
        <p>{source.pages ? `${source.pages} pages` : source.chunks?.length ? `${source.chunks.length} passages` : 'Source document'}</p>
      </div>
      <div className="source-card-actions">
        <button type="button" className="p-btn ghost source-preview-trigger" onClick={() => onPreview(source)}>Preview</button>
        {pending && <button type="button" className="p-btn" onClick={() => act(approve)} disabled={approve.loading}>{approve.loading ? 'Approving…' : approveLabel}</button>}
        {source.canRemove && (
          <RowActions
            label="source"
            title={source.title}
            endpoint={`/api/learning/sources/${source.id}`}
            onChanged={onRefresh}
            removeNote="A source that any course still cites cannot be removed."
          />
        )}
      </div>
      {error && <p className="s-shell-error source-action-error" role="alert">{error}</p>}
    </article>
  );
}

export function SourcePreviewDialog({ source, onClose, onRefresh }) {
  const { data: detail, loading, error, refetch } = useApiQuery(`/sources/${source?.id || '__none__'}`, { enabled: Boolean(source) });
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [pdfRetry, setPdfRetry] = useState(0);
  const [page, setPage] = useState(0);
  const [upload, setUpload] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const dialogRef = useRef(null);
  const lastFocus = useRef(null);
  const controller = useRef(null);
  const attach = useApiMutation(`/sources/${source?.id || '__none__'}/pdf`, 'POST');
  const active = detail || source;
  const pages = Array.isArray(active?.pages) ? active.pages : Array.isArray(active?.chunks) ? active.chunks : [];

  useEffect(() => {
    if (!source) return undefined;
    lastFocus.current = document.activeElement;
    const first = dialogRef.current?.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])')];
      const firstItem = items[0]; const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem?.focus(); }
      if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); lastFocus.current?.focus?.(); };
  }, [source, onClose]);

  useEffect(() => {
    setPage(0); setPdfError(''); setUploadError('');
    if (!source?.id) return undefined;
    if (!(detail?.hasPdf || source?.hasPdf)) return undefined;
    controller.current?.abort();
    const aborter = new AbortController(); controller.current = aborter;
    authFetch(`/api/learning/sources/${source.id}/pdf`, { signal: aborter.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `PDF unavailable (${response.status})`);
        return response.blob();
      }).then((blob) => { if (!aborter.signal.aborted) setPdfUrl(URL.createObjectURL(blob)); })
      .catch((err) => { if (err.name !== 'AbortError') setPdfError(message(err, 'The original PDF could not be opened.')); });
    return () => { aborter.abort(); setPdfUrl((url) => { if (url) URL.revokeObjectURL(url); return ''; }); };
  }, [source, detail?.hasPdf, pdfRetry]);

  const attachPdf = async () => {
    if (!upload) return;
    if (upload.type !== 'application/pdf' && !upload.name.toLowerCase().endsWith('.pdf')) { setUploadError('Choose a PDF file.'); return; }
    if (upload.size > 10 * 1024 * 1024) { setUploadError('Choose a PDF smaller than 10 MB.'); return; }
    const form = new FormData(); form.append('file', upload); setUploadError('');
    try {
      await attach.mutate(form);
      await onRefresh(); await refetch();
    } catch (err) { setUploadError(message(err, 'The PDF could not be attached.')); }
  };
  if (!source) return null;
  const pageItem = pages[page];
  const pageText = pageItem?.text || pageItem?.content || active?.text || 'No extracted text is available.';
  return (
    <div className="source-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="source-preview-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="source-preview-title">
        <header><div><p className="source-kicker">Document preview</p><h2 id="source-preview-title">{active?.title || 'Source document'}</h2></div><button type="button" className="source-close" onClick={onClose} aria-label="Close document preview">Close</button></header>
        {loading && <div className="source-preview-loading"><div className="source-skeleton card" /><div className="source-skeleton page" /></div>}
        {error && <div className="s-shell-error" role="alert">{message(error, 'Could not load this source.')} <button className="p-btn ghost" onClick={refetch}>Retry</button></div>}
        {!loading && !error && (
          <div className="source-preview-body">
            {active?.hasPdf ? (
              pdfUrl ? (
                <>
                  <div className="source-pdf-actions">
                    <button type="button" className="p-btn ghost" onClick={() => window.open(pdfUrl, '_blank', 'noopener,noreferrer')}>Open PDF in new tab</button>
                  </div>
                  <iframe className="source-pdf-frame" title={`PDF preview: ${active.title}`} src={pdfUrl} />
                </>
              ) : (
                <div className="source-pdf-pending" role={pdfError ? 'alert' : 'status'}>
                  <span>{pdfError || 'Preparing original PDF…'}</span>
                  {pdfError && <button type="button" className="p-btn ghost" onClick={() => setPdfRetry((value) => value + 1)}>Retry PDF</button>}
                </div>
              )
            ) : (
              <div className="source-text-preview">
                <p className="source-fallback-note">Original PDF unavailable. This is the extracted text used to ground course content.</p>
                <div className="source-text-page"><p className="source-page-label">Page {pageItem?.page || page + 1} of {Math.max(pages.length, 1)}</p><div>{pageText}</div></div>
                <nav className="source-page-nav" aria-label="Extracted text pages">
                  <button className="p-btn ghost" onClick={() => setPage((value) => value - 1)} disabled={page === 0}>Previous</button>
                  <button className="p-btn ghost" onClick={() => setPage((value) => value + 1)} disabled={page >= pages.length - 1}>Next</button>
                </nav>
              </div>
            )}
            {!active?.hasPdf && (active?.canRemove || source?.canRemove) && (
              <aside className="source-attach">
                <strong>Attach original PDF</strong>
                <p>A matching original is needed. The server checks its extracted page text and count before attachment.</p>
                <input type="file" accept="application/pdf,.pdf" onChange={(event) => setUpload(event.target.files?.[0] || null)} aria-label="Original PDF file" />
                <button type="button" className="p-btn" onClick={attachPdf} disabled={!upload || attach.loading}>{attach.loading ? 'Attaching…' : 'Attach original PDF'}</button>
                {uploadError && <p className="s-shell-error" role="alert">{uploadError}</p>}
              </aside>
            )}
          </div>
        )}
      </section>
    </div>
  );
}