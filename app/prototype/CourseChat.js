'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../_auth/AuthProvider';
import { authenticatedFetch } from '../../lib/auth-fetch';
import { useApiQuery } from '../_learning/useLearning';
import { SourceViewer } from './SourceViewer';
import { pageOf, provenanceOf } from '../_course/provenance';

/* The one chat. It answers only within a persisted course's server-selected,
   approved source set. The API derives both source selection and prior history
   from authenticated records; clients never supply either as evidence. */

/* Anchor returns { n, citation, pub_id, page_printed }; Sourcerer returns
   { label, source, page }. One shape for the renderer.
 *
 * The grounded tutor supplies both fields deliberately: `n` is the inline
 * marker the answer carries (lib/student-grounding.js `citedPassages`), so the
 * chip is never renumbered by its position here, and `pubId` is the publication
 * the server resolved from the approved source record. Both lead the fallback
 * chains -- a provider that sends neither keeps exactly its old rendering. */
export function normaliseCitation(c, i) {
  const citation = {
    n: c.n ?? i + 1,
    citation: c.citation ?? c.label ?? c.source ?? 'source',
    pub_id: c.pubId ?? c.pub_id ?? c.source ?? c.sourceId ?? '',
    page: c.page_printed ?? c.page ?? null,
  };
  const sourceId = c.sourceId ?? c.source_id;
  const passage = c.passage ?? c.text ?? c.quote ?? c.excerpt ?? c.snippet;
  // Keep the compact legacy citation shape unless the provider supplied a
  // locator that the viewer can use. This also keeps citations from older
  // Anchor responses backwards-compatible.
  if (sourceId) citation.sourceId = sourceId;
  if (typeof passage === 'string' && passage.trim()) citation.passage = passage;
  // Keep a Sourcerer record locator even when pub_id is a human publication
  // label. Non-enumerable preserves the compact legacy JSON shape.
  if (typeof c.source === 'string' && c.source.trim()) {
    Object.defineProperty(citation, 'source', { value: c.source, enumerable: false });
  }
  return citation;
}

/**
 * The line a learner reads on a citation chip.
 *
 * Built with the shared provenance helper, from the same resolved shape the
 * course reader hands it, so a chip reads exactly like the lesson line above
 * it: publication name, then page. A tutor citation's locator is "<source
 * record id> p.19" and the record id is a cuid — the authenticated
 * page-opening key, never the citation itself — so the publication name comes
 * from the server (`pubId`, lib/learning/core.js `courseCitations`) and the
 * page is read back off the locator, as CourseReader does.
 *
 * `pub_id` falls back to the locator for older provider shapes that carry no
 * publication at all. That is not a name, and passing it through would print
 * the locator and then its page again, so it is dropped: provenanceOf then
 * prints the locator alone, which is what those shapes already showed.
 */
export function citationProvenance(citation) {
  const locator = citation?.citation || '';
  const pubId = citation?.pub_id === locator ? '' : citation?.pub_id;
  return provenanceOf({ citation: locator, pubId, page: citation?.page ?? pageOf(locator) });
}

function citationSourceText(citation) {
  return [
    citation?.sourceId,
    citation?.source_id,
    citation?.source,
    citation?.pub_id,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function startsWithSourceId(value, sourceId) {
  const escaped = String(sourceId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A source id must end at a locator boundary. Without this check source-1
  // would incorrectly claim source-10 p.2 in a multi-source course.
  return new RegExp(`^${escaped}(?=$|[\\s,;:#()[\\]{}.])`).test(value.trim());
}

export function resolveCitationSourceId(citation, sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return null;
  const texts = citationSourceText(citation);
  const exact = sourceIds.find((sourceId) =>
    texts.some((text) => String(text).trim() === String(sourceId)),
  );
  if (exact) return exact;
  const prefixed = sourceIds.find((sourceId) =>
    texts.some((text) => startsWithSourceId(text, sourceId)),
  );
  if (prefixed) return prefixed;
  // A one-source course has no ambiguity when an older provider omits the
  // record id. Never guess in a multi-source course.
  return sourceIds.length === 1 ? sourceIds[0] : null;
}

export default function CourseChat({ course = null, view = null }) {
  const { user, loading, ready } = useAuth();
  if (!ready || loading || !user) return null;
  return <SignedInCourseChat key={`${user.uid}:${course?.id || 'doctrine'}`} course={course} view={view} />;
}

function SignedInCourseChat({ course, view }) {
  // Legacy manual-course records do not have LearningRecord source ownership
  // relationships, so they must not be treated as a tutor scope.
  const tutorMode = Boolean(course?.record) && course.record.type !== 'MANUAL_COURSE';
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [providerError, setProviderError] = useState(null);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(null);

  // Tutor mode needs the course's approved source ids (learner envelopes keep
  // sourceIds; only answer keys are stripped).
  const { data: envelope } = useApiQuery(`/courses/${course?.id}`, { enabled: tutorMode });
  const sourceIds = envelope?.course?.sourceIds || [];

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const grounded = tutorMode && sourceIds.length > 0;
  const modeLabel = tutorMode
    ? (providerError ? 'Provider unavailable' : grounded ? 'Course sources selected' : 'Waiting for sources')
    : 'Course scope required';
  const modeTitle = tutorMode
    ? `Answers require Anchor, Sourcerer, and Understudy checks over ${sourceIds.length} approved source${sourceIds.length === 1 ? '' : 's'}. Service availability is checked when you ask.`
    : 'Choose a persisted course to use the grounded tutor.';

  const ask = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText('');
    if (!tutorMode || !grounded) {
      setProviderError('Grounded chat requires a persisted course with approved sources.');
      return;
    }
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setProviderError(null);

    setBusy(true);
    let out;
    try {
      const controller = new AbortController();
      requestRef.current = controller;
      const res = await authenticatedFetch('/api/learning/tutor', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        // The server resolves source selection and history from this scope.
        body: JSON.stringify({ question, courseId: course.id }),
      });
      const json = await res.json().catch(() => ({}));
      out = res.ok
        ? { abstained: Boolean(json.refused), reason: json.reason, answer: json.answer, citations: (json.citations || []).map(normaliseCitation), stages: json.stages || [] }
        : { abstained: true, answer: 'The grounded tutor is unavailable. Please try again.', citations: [], error: true };
      if (!res.ok) setProviderError(json.error || `Tutor service returned ${res.status}.`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setProviderError(e?.message || 'The grounding service is unreachable.');
      out = { abstained: true, answer: 'The grounding service is unreachable.', citations: [], error: true };
    }
    setMsgs((m) => [...m, { role: 'assistant', ...out }]);
    setBusy(false);
  };

  const title = course ? 'Ask about this course' : 'Grounded course chat';
  const subtitle = tutorMode ? course.name : 'Select a persisted course to ask the tutor';
  const placeholder = tutorMode
    ? `Ask about ${view === 'lessons' ? 'this lesson' : 'this course'}…`
    : 'Course scope required';
  const citationSourceId = resolveCitationSourceId(selectedCitation, sourceIds);

  return (
    <>
      {!open && (
        <button className="s-chat-fab" onClick={() => setOpen(true)} aria-label={title} data-tour="ask-tutor">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
            <path d="M8 8h8M8 11.5h5" />
          </svg>
          <span>Ask</span>
        </button>
      )}

      {open && (
        <section className="s-chat" aria-label={title}>
          <header className="s-chat-head">
            <div className="s-chat-title">
              <div>{title}</div>
              <div className="s-chat-sub">{subtitle}</div>
            </div>
            <span className={`s-chat-status${grounded ? ' on' : ''}`} title={modeTitle}>
              <span className="s-chat-dot" />
              {modeLabel}
            </span>
            <button className="s-chat-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </header>

          <div className="s-chat-body" ref={bodyRef}>
            {providerError && (
              <div
                className="s-chat-provider-error"
                role="alert"
                style={{ margin: '0.6rem', padding: '0.55rem 0.7rem', borderRadius: '6px', color: 'var(--p-warning)', background: 'var(--p-surface-2)', fontSize: '0.8em' }}
              >
                {providerError}
              </div>
            )}
            <div className="s-chat-msg assistant">
              <div className="s-chat-bubble">
                {tutorMode
                  ? 'Answers come only from the approved sources behind this course, with a citation you can open. If they don\'t cover it, I\'ll say so rather than guess.'
                  : 'Grounded chat is available only inside a persisted course with approved sources.'}
              </div>
            </div>


            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div className="s-chat-msg user" key={i}>
                  <div className="s-chat-bubble">{m.text}</div>
                </div>
              ) : (
                <div className={`s-chat-msg assistant${m.abstained ? ' abstain' : ''}`} key={i}>
                  <div className="s-chat-bubble">
                    {m.abstained && !m.error && <div className="s-chat-abstain">Not in the course sources{m.reason ? ` · ${String(m.reason).replace(/_/g, ' ')}` : ''}</div>}
                    {m.error && <div className="s-chat-abstain">Service error</div>}
                    {m.answer}
                  </div>
                  {m.citations?.length > 0 && (
                    <div className="s-chat-cites">
                      {m.citations.map((c) => {
                        const provenance = citationProvenance(c);
                        return (
                          <button
                            key={c.n}
                            type="button"
                            className="s-chat-cite"
                            title={provenance?.locator || c.citation}
                            onClick={() => setSelectedCitation(c)}
                          >
                            {/* [n] is the marker the answer carries, so a chip
                                and the sentence that cites it always name the
                                same passage. The exact locator stays on
                                `title`: it is what opens the page. */}
                            <b>[{c.n}]</b> {provenance?.text || c.citation}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            )}

            {busy && (
              <div className="s-chat-msg assistant">
                <div className="s-chat-bubble s-chat-typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form
            className="s-chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              disabled={busy || !grounded}
            />
            <button type="submit" className="p-btn" disabled={busy || !text.trim() || !grounded} aria-label="Send">
              ↑
            </button>
          </form>
          <div className="s-chat-foot">
            Not available during exams. Your instructor sees what the class asks, in aggregate — never who asked.
          </div>
        </section>
      )}
      {tutorMode && citationSourceId && selectedCitation && (
        <SourceViewer
          sourceId={citationSourceId}
          citation={selectedCitation}
        />
      )}
    </>
  );
}
