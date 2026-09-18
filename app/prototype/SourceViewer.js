'use client';

import { useEffect, useRef, useState } from 'react';
import { useApiQuery } from '../_learning/useLearning';
import { publicationName } from '../_course/provenance';

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
      <mark className="p-hl">
        {text.slice(start, start + phrase.length)}
      </mark>
      {text.slice(start + phrase.length)}
    </>
  );
}

/* How much of the document there is, said the way the record knows it. */
function extentOf(sourceData) {
  if (sourceData?.pages?.length) {
    return `${sourceData.pages.length} page${sourceData.pages.length === 1 ? '' : 's'}`;
  }
  if (sourceData?.chunks?.length) {
    return `${sourceData.chunks.length} passage${sourceData.chunks.length === 1 ? '' : 's'}`;
  }
  return '';
}

/*
 * The approved source behind a course. `compact` renders it as an agenda box
 * (course home sidebar) instead of a full panel. Pages and chunks are kept
 * addressable so a tutor citation can open the exact page and passage.
 *
 * Reading happens in a full-screen reader rather than inline. The document was
 * previously expanded into whichever box held the trigger -- in the source
 * library that is a ~280px grid card, so a 220-page coursebook was read in a
 * narrow column with a horizontal scrollbar on its body text, in a card that
 * had grown several times taller than its neighbours. Inspecting a cited
 * passage is the act this product asks an instructor to perform before they
 * put their name to an item, so it gets the whole screen, real page framing
 * and a fixed measure, and it leaves the layout behind it untouched.
 */
/*
 * `asReader` opens the document straight away and renders nothing else.
 *
 * Clicking a citation in the grounded chat used to mount the full panel form of
 * this component at shell level -- a "Source document" card sitting in its own
 * column beside the lesson, with no way to dismiss it, because nothing ever
 * cleared the selected citation. A learner who checked one source got a second
 * sidebar for the rest of the session.
 *
 * Checking a citation is a look, not a mode. So that path opens the reader --
 * which already has Close and already honours Escape -- and closing it tells
 * the caller, so the selection goes with it.
 */
export function SourceViewer({
  sourceId,
  compact = false,
  citation = null,
  asReader = false,
  onClose = null,
}) {
  const { data: sourceData, loading, error } = useApiQuery(`/sources/${sourceId}`);
  // Kept first: the rendering tests drive this component by supplying the
  // first useState, and `open` is the state they are driving.
  const [open, setOpen] = useState(asReader);
  const targetRef = useRef(null);

  useEffect(() => {
    if (sourceId && citation) setOpen(true);
  }, [sourceId, citation]);

  useEffect(() => {
    if (!open || !citation || !targetRef.current) return;
    targetRef.current.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [open, citation, sourceData]);

  // Escape is what a reader that covers the screen has to answer to.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (error) {
    return <p className="s-shell-error" role="alert">{error?.error || 'Error loading source'}</p>;
  }

  /* One way to close, so the button, Escape and the caller cannot disagree. */
  const close = () => {
    setOpen(false);
    onClose?.();
  };

  // As a reader there is no card to put a loading line in, and a bare one would
  // be a stray paragraph beside the lesson -- the same shell-level litter this
  // mode exists to remove. The document appears when it is there.
  if (loading || !sourceData) return asReader ? null : <p>Loading source…</p>;

  /* A file upload records the document under its filename, so this card said
     "AY27_8670_..._Moodle.pdf" — one unbroken token, which ran out of the
     20rem agenda column it sits in and took the page's horizontal scrollbar
     with it. The name is the publication, not the path. */
  const title = publicationName(sourceData.title || '') || sourceId;
  const extent = extentOf(sourceData);
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

  /* Each page is a page: its own sheet, its own number, one comfortable column
     of text. The extracted run used to arrive as one undivided block, which is
     what made it read as a debug dump rather than as the document it is. */
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
          className={`p-page${isSelected ? ' is-cited' : ''}`}
          data-source-page={pageNumber}
          data-citation-target={isSelected ? 'true' : undefined}
        >
          <strong className="p-pagenum">Page {pageNumber}</strong>
          {pageChunks.length > 0 ? (
            pageChunks.map((chunk, chunkIndex) => (
              <p
                key={chunkIndex}
                className="p-pagetext"
                data-source-passage={isSelected ? 'true' : undefined}
              >
                {highlightText(chunk.text || '', isSelected ? selectedPassage : '')}
              </p>
            ))
          ) : (
            <p className="p-pagetext">{highlightText(text, isSelected ? selectedPassage : '')}</p>
          )}
        </section>
      );
    })
  ) : (
    <section className="p-page">
      <p className="p-pagetext">{sourceData.text || 'No content available.'}</p>
    </section>
  );

  const reader = open ? (
    <div className="p-reader" role="dialog" aria-modal="true" aria-label={`Source document: ${title}`}>
      <header className="p-readerhead">
        <div className="p-readertitle">
          <h2>{title}</h2>
          <p>{extent ? `${extent} · ` : ''}Approved source</p>
        </div>
        <button type="button" className="p-btn ghost" onClick={close}>Close</button>
      </header>
      <div className="p-readerscroll">
        <div className="p-readerdoc">
          {citation && selectedPage && (
            <p className="p-readercited" role="status">
              Opened citation on page {selectedPage}{selectedPassage ? ' and highlighted the passage' : ''}.
            </p>
          )}
          {pageContent}
        </div>
      </div>
    </div>
  ) : null;

  // No card, no column: the document itself, already open.
  if (asReader) return reader;

  if (compact) {
    return (
      <section className="s-box">
        <h4 className="s-label">Source</h4>
        <p className="p-srcname" title={sourceData.title || undefined}>{title}</p>
        <p className="p-src" style={{ margin: '0 0 0.8rem' }}>
          {extent || 'Approved'} · every item in this course cites it.
        </p>
        <button type="button" className="p-btn ghost" onClick={() => setOpen(true)}>Open document</button>
        {reader}
      </section>
    );
  }

  return (
    <div className="p-panel" style={{ marginTop: '2rem' }}>
      <h3>Source document</h3>
      <p className="p-srcname" title={sourceData.title || undefined}>{title}</p>
      <p className="p-src" style={{ margin: '0 0 0.9rem' }}>{extent || 'Approved source'}</p>
      <button type="button" className="p-btn ghost" onClick={() => setOpen(true)}>Open document</button>
      {reader}
    </div>
  );
}
