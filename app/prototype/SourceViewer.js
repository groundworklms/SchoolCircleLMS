'use client';

import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '../_learning/useLearning';

export function citationPage(citation) {
  const directPage = [
    citation?.page,
    citation?.pageNumber,
    citation?.printedPage,
    citation?.page_printed,
    citation?.chunk?.page,
  ].find((value) => Number.isInteger(Number(value)) && Number(value) > 0);
  if (directPage) return Number(directPage);

  const source = citation?.source || citation?.label || citation?.citation || '';
  const match = String(source).match(/\bp(?:age)?\.?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function citationPassage(citation) {
  const value = [
    citation?.passage,
    citation?.text,
    citation?.quote,
    citation?.excerpt,
    citation?.snippet,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());
  return value?.trim() || '';
}

function highlightText(text, phrase) {
  if (!phrase || typeof text !== 'string') return text;
  const start = text.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <mark style={{ background: 'var(--p-highlight, #f3d98b)', color: 'inherit' }}>
        {text.slice(start, start + phrase.length)}
      </mark>
      {text.slice(start + phrase.length)}
    </>
  );
}

/*
 * The approved source behind a course. `compact` renders it as an agenda box
 * (course home sidebar) instead of a full panel. Pages and chunks are kept
 * addressable so a tutor citation can open the exact page and passage.
 */
export function SourceViewer({ sourceId, compact = false, citation = null }) {
  const { data: sourceData, loading, error } = useApiQuery(`/sources/${sourceId}`);
  const [open, setOpen] = useState(false);
  const targetRef = useRef(null);

  useEffect(() => {
    if (sourceId && citation) setOpen(true);
  }, [sourceId, citation]);

  useEffect(() => {
    if (!open || !citation || !targetRef.current) return;
    targetRef.current.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [open, citation, sourceData]);

  if (error) {
    return <p className="s-shell-error" role="alert">{error?.error || 'Error loading source'}</p>;
  }

  if (loading || !sourceData) return <p>Loading source…</p>;

  const selectedPage = citationPage(citation);
  const selectedPassage = citationPassage(citation);
  const sourcePages = Array.isArray(sourceData.pages) ? sourceData.pages : [];
  const sourceChunks = Array.isArray(sourceData.chunks) ? sourceData.chunks : [];
  const pages = sourcePages.length
    ? sourcePages
    : sourceChunks.map((chunk, index) => ({
        page: chunk.page || index + 1,
        text: chunk.text,
        chunk,
      }));

  const pageContent = pages.length > 0 ? (
    pages.map((p, i) => {
      const pageNumber = p.page || i + 1;
      const isSelected = selectedPage !== null && selectedPage === Number(pageNumber);
      const text = p.text || '';
      const pageChunks = sourceChunks.filter((chunk) => Number(chunk.page) === Number(pageNumber));
      return (
        <section
          key={`${pageNumber}-${i}`}
          ref={isSelected ? targetRef : null}
          data-source-page={pageNumber}
          data-citation-target={isSelected ? 'true' : undefined}
          style={{
            marginBottom: '1rem',
            padding: isSelected ? '0.5rem' : 0,
            borderRadius: '6px',
            outline: isSelected ? '2px solid var(--p-good)' : undefined,
          }}
        >
          <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--p-dim)' }}>
            Page {pageNumber}
          </strong>
          {pageChunks.length > 0 ? (
            pageChunks.map((chunk, chunkIndex) => (
              <p key={chunkIndex} data-source-passage={isSelected ? 'true' : undefined} style={{ margin: '0 0 0.5rem' }}>
                {highlightText(chunk.text || '', isSelected ? selectedPassage : '')}
              </p>
            ))
          ) : (
            <p style={{ margin: 0 }}>{highlightText(text, isSelected ? selectedPassage : '')}</p>
          )}
        </section>
      );
    })
  ) : (
    sourceData.text || 'No content available.'
  );

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
            {citation && selectedPage && (
              <p role="status" style={{ color: 'var(--p-good)', fontSize: '0.82em', margin: '0 0 0.6rem' }}>
                Opened citation on page {selectedPage}{selectedPassage ? ' and highlighted passage' : ''}.
              </p>
            )}
            <div style={{ maxHeight: '50vh', overflowY: 'auto', fontSize: '0.85em', whiteSpace: 'pre-wrap' }}>
              {pageContent}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="p-panel" style={{ marginTop: '2rem' }}>
      <h3>Source Document: {sourceData.title || sourceId}</h3>
      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)}>Open Document</button>
      ) : (
        <div>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: '1rem' }}>Close Document</button>
          {citation && selectedPage && (
            <p role="status" style={{ color: 'var(--p-good)', fontSize: '0.85em', margin: '0 0 0.75rem' }}>
              Opened citation on page {selectedPage}{selectedPassage ? ' and highlighted passage' : ''}.
            </p>
          )}
          <div style={{ background: 'var(--p-surface-2)', padding: '1rem', borderRadius: '8px', maxHeight: '400px', overflowY: 'auto', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>
            {pageContent}
          </div>
        </div>
      )}
    </div>
  );
}
