'use client';

import { useState } from 'react';
import { useApiQuery } from '../_learning/useLearning';

/* The approved source behind a course. `compact` renders it as an agenda
   box (course home sidebar) instead of a full panel. */
export function SourceViewer({ sourceId, compact = false }) {
  const { data: sourceData, loading, error } = useApiQuery(`/sources/${sourceId}`);
  const [open, setOpen] = useState(false);

  if (error) {
    return <p className="s-shell-error" role="alert">{error?.error || "Error loading source"}</p>;
  }

  if (loading || !sourceData) return <p>Loading source…</p>;

  if (compact) {
    return (
      <section className="s-box">
        <h4 className="s-label">Source</h4>
        <p style={{ margin: '0 0 0.6rem', fontWeight: 600 }}>{sourceData.title || sourceId}</p>
        <p className="p-src" style={{ margin: '0 0 0.6rem' }}>
          {sourceData.pages?.length ? `${sourceData.pages.length} pages` : sourceData.chunks?.length ? `${sourceData.chunks.length} passages` : 'Approved'} · every item in this course cites it.
        </p>
        {!open ? (
          <button className="p-btn ghost" onClick={() => setOpen(true)}>Open document</button>
        ) : (
          <>
            <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: '0.6rem' }}>Close</button>
            <div style={{ maxHeight: '50vh', overflowY: 'auto', fontSize: '0.85em', whiteSpace: 'pre-wrap' }}>
              {sourceData.pages?.length > 0
                ? sourceData.pages.map((p) => <p key={p.page}><b>p. {p.page}</b> {p.text}</p>)
                : sourceData.chunks?.length > 0
                  ? sourceData.chunks.map((c, i) => <p key={i}>{c.text}</p>)
                  : sourceData.text || 'No content available.'}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="p-panel" style={{ marginTop: "2rem" }}>
      <h3>Source Document: {sourceData.title || sourceId}</h3>
      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)}>Open Document</button>
      ) : (
        <div>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: "1rem" }}>Close Document</button>
          <div style={{ background: "var(--p-surface-2)", padding: "1rem", borderRadius: "8px", maxHeight: "400px", overflowY: "auto", fontSize: "0.9em", whiteSpace: "pre-wrap" }}>
            {sourceData.pages?.length > 0 ? (
              sourceData.pages.map((p) => (
                <div key={p.page} style={{ marginBottom: "1rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.25rem", color: "var(--p-dim)" }}>Page {p.page}</strong>
                  <p style={{ margin: 0 }}>{p.text}</p>
                </div>
              ))
            ) : sourceData.chunks?.length > 0 ? (
              sourceData.chunks.map((c, i) => (
                <div key={i} style={{ marginBottom: "1rem" }}>
                  <strong style={{ display: "block", marginBottom: "0.25rem", color: "var(--p-dim)" }}>Chunk {i + 1}</strong>
                  <p style={{ margin: 0 }}>{c.text}</p>
                </div>
              ))
            ) : (
              sourceData.text || "No content available."
            )}
          </div>
        </div>
      )}
    </div>
  );
}
