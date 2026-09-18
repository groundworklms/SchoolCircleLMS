'use client';

/**
 * Per-item ratification — the human-in-the-loop gate between generation and a
 * learner.
 *
 * Approving a course releases a delivery snapshot; it does not release the
 * items inside it. Every materialised Item lands PENDING, and the
 * learner-facing queries return only APPROVED, so this screen is where a
 * generated question actually becomes teachable. Each item is shown with the
 * evidence behind it — the citation that grounds it and the HHEM support score
 * measured against its keyed answer — because that evidence is what the
 * instructor is being asked to judge.
 *
 * Revising an item edits its content and ratifies it in one action: a reviewer
 * who had to fix an item has, by fixing it, reviewed it. The citation and the
 * support score are never rewritten here — they are measurements, not content.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';
import { provenanceOf } from '../_course/provenance';
import './item-review.css';

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

const KIND_LABEL = { QUESTION: 'Question', LESSON: 'Lesson', SCENARIO: 'Scenario' };

const STATUS = {
  APPROVED: { className: 'is-approved', label: 'Approved' },
  REJECTED: { className: 'is-rejected', label: 'Withheld' },
  PENDING: { className: 'is-pending', label: 'Needs review' },
};

function statusOf(item) {
  return STATUS[item.status] || STATUS.PENDING;
}

function optionsOf(item) {
  return Array.isArray(item.options) ? item.options : [];
}

/* A LESSON row's `options` is not a choice list but the structured teaching
   content a learner reads the prose through -- pages, diagram, cards (see
   lib/learning/project-course.js `lessonContent`). The reviewer approving
   the row is approving that too, so the card says what rides along. */
function lessonContentOf(item) {
  if (item?.kind !== 'LESSON' || !item.options || typeof item.options !== 'object' || Array.isArray(item.options)) return null;
  const content = item.options;
  const parts = [];
  if (Array.isArray(content.pages) && content.pages.length) parts.push(`${content.pages.length} lesson page${content.pages.length === 1 ? '' : 's'}`);
  if (content.diagram) parts.push(`a diagram${Array.isArray(content.labels) && content.labels.length ? ` with ${content.labels.length} explained labels` : ''}`);
  if (Array.isArray(content.flashcards) && content.flashcards.length) parts.push(`${content.flashcards.length} flashcards`);
  return parts.length ? { summary: parts.join(', '), pages: Array.isArray(content.pages) ? content.pages : [] } : null;
}

/* `support` is the HHEM score for the keyed answer. It is absent on items that
   were never verified, and "absent" has to read differently from "scored low". */
function Evidence({ item }) {
  const provenance = provenanceOf(item.citation);
  const verified = typeof item.support === 'number';
  return (
    <p className={`item-review-evidence${verified ? '' : ' is-unverified'}`}>
      {provenance
        ? <span title={provenance.locator || undefined}>Grounded in {provenance.text}</span>
        : 'No citation recorded'}
      {' · '}
      {verified ? `support ${item.support.toFixed(2)}` : 'not verified'}
    </p>
  );
}

/** The edit half of a revision. Only authored fields are editable. */
function ReviseForm({ item, busy, onCancel, onSubmit, onSuggest }) {
  const keyed = item.kind === 'QUESTION' && optionsOf(item).length > 0;
  const [stem, setStem] = useState(item.stem || '');
  const [options, setOptions] = useState(optionsOf(item));
  const [answer, setAnswer] = useState(Number.isInteger(item.answer) ? item.answer : 0);
  const [rationale, setRationale] = useState(item.rationale || '');
  const [asking, setAsking] = useState(false);
  const [suggestError, setSuggestError] = useState(null);
  const [suggested, setSuggested] = useState(false);

  /* The model writes into the form; the human saves.
   *
   * This screen ratifies items on a course that is already published and may
   * already have learners in it, so a rewrite that applied itself would be
   * changing the course out from under them. The suggestion lands in the
   * fields, where it can be read, edited or abandoned, and the save below is
   * the same one a hand-typed edit uses -- which is also what ratifies the
   * item and records who did it.
   *
   * The citation and support score are untouched. They measure the item as it
   * stands, and a suggestion is not the item until someone saves it.
   */
  const askForRewrite = async () => {
    if (asking || busy) return;
    setAsking(true);
    setSuggestError(null);
    try {
      const next = await onSuggest(item.id);
      setStem(next.stem);
      if (Array.isArray(next.options) && next.options.length) setOptions(next.options);
      if (Number.isInteger(next.answer)) setAnswer(next.answer);
      setRationale(next.rationale || '');
      setSuggested(true);
    } catch (error) {
      setSuggestError(errText(error, 'The model could not suggest a rewrite for this item.'));
    } finally {
      setAsking(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    const payload = { decision: 'REVISE', stem, rationale: rationale.trim() || null };
    if (keyed) {
      payload.options = options;
      payload.answer = answer;
    }
    onSubmit(payload).catch(() => {
      // The parent shows the explicit API error and keeps the form usable.
    });
  };

  return (
    <form className="item-review-form" onSubmit={submit}>
      <label>
        <span>{item.kind === 'QUESTION' ? 'Question stem' : 'Content'}</span>
        <textarea
          rows={item.kind === 'QUESTION' ? 3 : 8}
          value={stem}
          onChange={(event) => setStem(event.target.value)}
          required
          autoFocus
        />
      </label>

      {keyed && options.map((option, index) => (
        // Choices are positional: the index IS the identity here.
        <label className="item-review-option" key={index}>
          <input
            type="radio"
            name={`answer-${item.id}`}
            checked={answer === index}
            onChange={() => setAnswer(index)}
            aria-label={`Keyed answer: choice ${index + 1}`}
          />
          <input
            type="text"
            value={option}
            onChange={(event) =>
              setOptions(options.map((current, i) => (i === index ? event.target.value : current)))
            }
            required
          />
        </label>
      ))}

      <label>
        <span>{item.kind === 'QUESTION' ? 'Rationale (instructor-only)' : 'Coaching note'}</span>
        <textarea rows={2} value={rationale} onChange={(event) => setRationale(event.target.value)} />
      </label>

      {item.kind === 'QUESTION' && typeof onSuggest === 'function' && (
        <div className="item-review-suggest">
          <button type="button" className="p-btn ghost" onClick={askForRewrite} disabled={asking || busy}>
            {asking ? 'Asking the model…' : 'Ask AI to rewrite'}
          </button>
          {/* Said before it is pressed, not after. A reviewer deciding whether
              to press it needs to know the rewrite is bounded by the same
              source the item is cited to. */}
          <span className="p-src">
            Written from this item&rsquo;s cited passage, into the fields above. Nothing is saved
            until you save it.
          </span>
        </div>
      )}
      {suggested && (
        <p className="p-check ok" role="status">
          <strong>The fields above are the model&rsquo;s suggestion.</strong> Read it, change what you
          want, and save when it is right.
        </p>
      )}
      {suggestError && <p className="s-shell-error" role="alert">{suggestError}</p>}

      {/* What saving this form actually does, including the part a reviewer
          would not guess: it ratifies the item. Set to be read, not filed under
          the form as a grey footnote. */}
      <p className="p-truth">
        The citation and support score stay as measured. Saving also approves the item.
      </p>
      <div className="p-btnrow">
        <button type="submit" className="p-btn" disabled={busy}>
          {busy ? 'Saving…' : 'Save and approve'}
        </button>
        <button type="button" className="p-btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ItemCard({ item, busy, onDecide, onSuggest }) {
  const [editing, setEditing] = useState(false);
  const state = statusOf(item);

  const decide = async (payload) => {
    await onDecide(item.id, payload);
    setEditing(false);
  };

  return (
    <li className={`item-review-card ${state.className}`}>
      <div className="item-review-card-head">
        <span>{KIND_LABEL[item.kind] || item.kind}</span>
        <strong className="item-review-status">{state.label}</strong>
      </div>

      <p className="item-review-stem">{item.stem}</p>

      {optionsOf(item).length > 0 && (
        <ol className="item-review-options">
          {optionsOf(item).map((option, index) => (
            // Choices are positional: the index IS the identity here.
            <li key={index} className={index === item.answer ? 'is-key' : undefined}>
              {option}
              {index === item.answer && <span> · keyed answer</span>}
            </li>
          ))}
        </ol>
      )}

      {item.rationale && <p className="item-review-rationale">{item.rationale}</p>}

      {lessonContentOf(item) && (
        <details className="item-review-rationale">
          <summary>Released with this lesson: {lessonContentOf(item).summary}.</summary>
          <ol>
            {lessonContentOf(item).pages.map((page, index) => (
              <li key={index}>
                <strong>{page.title}</strong>
                {' '}· {(page.blocks || []).map((block) => block.type).join(', ')}
              </li>
            ))}
          </ol>
        </details>
      )}

      <Evidence item={item} />

      {editing ? (
        <ReviseForm
          item={item}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={decide}
          onSuggest={onSuggest}
        />
      ) : (
        /* Three weights, not one. Approve is the affirmative act a named human
           is accountable for, so it carries the accent; Revise is the neutral
           middle; Withhold is deliberate and reversible and must not read as an
           equal-and-opposite button sitting next to the approval. */
        <div className="p-btnrow item-review-actions">
          {item.status !== 'APPROVED' && (
            <button type="button" className="p-btn" disabled={busy} onClick={() => decide({ decision: 'APPROVE' }).catch(() => {})}>
              Approve
            </button>
          )}
          <button type="button" className="p-btn ghost" disabled={busy} onClick={() => setEditing(true)}>
            Revise
          </button>
          {item.status !== 'REJECTED' && (
            <button type="button" className="p-btn quiet" disabled={busy} onClick={() => decide({ decision: 'REJECT' }).catch(() => {})}>
              Withhold
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * @param {{ courseId: string, onChanged?: () => unknown }} props
 *   `courseId` is the COURSE_DRAFT record id. The server resolves the delivery
 *   course behind it, so the caller never has to know the release id.
 */
export function CourseItemReview({ courseId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState(null);

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      try {
        const res = await authFetch(`/api/learning/courses/${courseId}/items`, { signal });
        const json = await res.json();
        if (!res.ok) throw json;
        setData(json);
        setError(null);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setError(err);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [courseId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = async (itemId, payload) => {
    setBusyItem(itemId);
    setError(null);
    try {
      const res = await authFetch(
        `/api/learning/courses/${courseId}/items/${encodeURIComponent(itemId)}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok) throw json;
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusyItem(null);
    }
  };

  /* One deliberate click for everything still pending. The count is on the
     button, the confirmation restates it, and withheld items are untouched. */
  /* Ask for a rewrite. Returns it; saves nothing.
   *
   * Deliberately not routed through `decide`: that path persists and ratifies,
   * and this one must do neither. The suggestion goes back to the form and
   * stops there until a human saves it. An error is thrown rather than
   * swallowed so the form can say what went wrong -- "the passage this item
   * cites could not be resolved" is a fact a reviewer can act on, and a
   * silently unchanged form is not.
   */
  const suggest = async (itemId) => {
    const res = await authFetch(`/api/learning/courses/${courseId}/items/${itemId}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw json || new Error(`Status ${res.status}`);
    if (!json?.suggestion) throw new Error('The model returned no suggestion.');
    return json.suggestion;
  };

  const [approvingAll, setApprovingAll] = useState(false);
  const approveAll = async () => {
    const pendingCount = data?.counts?.PENDING || 0;
    if (!pendingCount) return;
    if (typeof window !== 'undefined' && !window.confirm(`Approve all ${pendingCount} pending items? Each will be shown to learners as written. Withheld items stay withheld.`)) return;
    setApprovingAll(true);
    setError(null);
    try {
      const res = await authFetch(`/api/learning/courses/${courseId}/items/approve-all`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw json;
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setApprovingAll(false);
    }
  };

  if (loading && !data) return <p className="p-src">Loading items for review…</p>;
  if (error && !data) {
    return (
      <div className="s-shell-error" role="alert">
        <p>{errText(error, 'Could not load the items for review.')}</p>
        <button type="button" className="p-btn ghost" onClick={() => load()}>Reload items</button>
      </div>
    );
  }

  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const counts = data?.counts || { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  const total = data?.total ?? 0;

  return (
    <div className="p-panel">
      <div className="item-review-head">
        <div>
          <h3>Item review</h3>
          <p className="p-sub">
            {total === 0 ? (
              'No items have been materialised for this release yet.'
            ) : counts.PENDING > 0 ? (
              <>
                <strong>{counts.PENDING}</strong> of {total} item{total === 1 ? '' : 's'} still
                {' '}need review.
              </>
            ) : (
              <>
                All {total} items reviewed · {counts.APPROVED} approved, {counts.REJECTED} withheld.
              </>
            )}
          </p>
        </div>
        <span className={`p-live${counts.PENDING === 0 && counts.APPROVED > 0 ? ' on' : ''}`}>
          {counts.PENDING === 0 ? 'RELEASED' : `${counts.PENDING} PENDING`}
        </span>
      </div>

      {/* The standing guarantee this whole screen exists to enforce. It was a
          trailing clause on the count line and only appeared while something
          was still pending; it is true of every release and it is the reason a
          reviewer can leave an item alone without taking a risk, so it is said
          plainly and it is always on screen. */}
      <p className="p-truth">A learner sees only the approved ones.</p>

      {counts.PENDING > 1 && (
        <div className="p-btnrow" style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="p-btn ghost" disabled={approvingAll || Boolean(busyItem)} onClick={approveAll}>
            {approvingAll ? 'Approving…' : `Approve all ${counts.PENDING} pending`}
          </button>
          <span className="p-src">Every pending lesson, check and card, as written.</span>
        </div>
      )}

      {error && data && (
        <p className="s-shell-error" role="alert">{errText(error, 'That decision could not be saved.')}</p>
      )}

      {sections.map((section, index) => {
        const pending = section.items.filter((item) => item.status === 'PENDING').length;
        return (
          <details className="item-review-section" key={section.id} open={pending > 0 || index === 0}>
            <summary>
              <span>{section.title}</span>
              <small>{pending > 0 ? `${pending} needing review` : `${section.items.length} reviewed`}</small>
            </summary>
            <ul className="item-review-list">
              {section.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  busy={busyItem === item.id}
                  onDecide={decide}
                  onSuggest={suggest}
                />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
