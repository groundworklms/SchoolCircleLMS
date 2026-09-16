'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './manual-lesson.css';

/*
 * The manual renderer deliberately has no knowledge of the authoring editor or
 * of the database.  Drafts and published releases have the same shape, with
 * one important difference: a published release does not contain the answer
 * key.  Consequently the non-preview path only displays the result returned
 * by onAnswer; it never attempts to infer a result from content.
 */

export function lessonBlocks(content) {
  if (Array.isArray(content)) return content;
  if (Array.isArray(content?.blocks)) return content.blocks;
  return [];
}

export function normalizeLesson(content) {
  if (Array.isArray(content)) return { blocks: content };
  if (content && typeof content === 'object') return content;
  return { blocks: [] };
}

function blockType(block) {
  return String(block?.type || '').toLowerCase();
}

function Markdown({ children, className = '' }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className={`manual-markdown ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {String(children)}
      </ReactMarkdown>
    </div>
  );
}

function Feedback({ result }) {
  if (!result || typeof result !== 'object') return null;
  const text = result.feedback ?? result.explanation;
  if (!text && typeof result.correct !== 'boolean') return null;
  const correct = result.correct === true;
  return (
    <div className={`manual-feedback ${correct ? 'is-correct' : 'is-wrong'}`} role="status">
      <strong>{correct ? 'Correct' : 'Not quite'}</strong>
      {text ? <Markdown>{text}</Markdown> : null}
    </div>
  );
}

function PassiveComplete({ blockId, completed, busy, onComplete }) {
  if (completed) {
    return <p className="manual-complete-state" role="status">Completed</p>;
  }
  if (!onComplete) return null;
  return (
    <button
      type="button"
      className="manual-complete-button"
      onClick={() => onComplete(blockId)}
      disabled={Boolean(busy)}
    >
      {busy ? 'Saving…' : 'Mark complete'}
    </button>
  );
}

function MediaBlock({ block }) {
  const type = blockType(block);
  if (type === 'image') {
    return (
      <figure className="manual-media">
        <img src={block.url} alt={block.alt || ''} loading="lazy" />
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    );
  }
  return (
    <figure className="manual-media">
      <video controls preload="metadata" src={block.url} aria-label={block.alt || block.caption || 'Lesson video'}>
        Your browser does not support the lesson video.
      </video>
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}

function AccordionBlock({ block }) {
  return (
    <div className="manual-accordion">
      {(Array.isArray(block.items) ? block.items : []).map((item) => (
        <details key={item.id || item.title}>
          <summary>{item.title || 'More information'}</summary>
          <Markdown>{item.body}</Markdown>
        </details>
      ))}
    </div>
  );
}

function FlashcardsBlock({ block }) {
  const cards = Array.isArray(block.cards) ? block.cards : [];
  const [revealed, setRevealed] = useState(() => new Set());
  const toggle = (id) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="manual-flashcards" aria-label="Flashcards">
      {cards.map((card) => {
        const id = card.id || card.front;
        const isRevealed = revealed.has(id);
        return (
          <button
            type="button"
            className={`manual-flashcard ${isRevealed ? 'is-revealed' : ''}`}
            key={id}
            onClick={() => toggle(id)}
            aria-expanded={isRevealed}
          >
            <span className="manual-flashcard-label">{isRevealed ? 'Answer' : 'Prompt'}</span>
            <Markdown>{isRevealed ? card.back : card.front}</Markdown>
            <span className="manual-flashcard-action">{isRevealed ? 'Hide answer' : 'Reveal answer'}</span>
          </button>
        );
      })}
    </div>
  );
}

function HotspotsBlock({ block }) {
  const points = Array.isArray(block.points) ? block.points : [];
  const [selected, setSelected] = useState(null);

  return (
    <div className="manual-hotspots">
      <div className="manual-hotspot-image">
        <img src={block.url} alt={block.alt || 'Interactive lesson image'} />
        {points.map((point) => (
          <button
            type="button"
            className={`manual-hotspot-point ${selected === point.id ? 'is-selected' : ''}`}
            key={point.id}
            style={{ left: `${Number(point.x)}%`, top: `${Number(point.y)}%` }}
            onClick={() => setSelected(point.id)}
            aria-label={`Show ${point.label || 'hotspot'}`}
            aria-pressed={selected === point.id}
          >
            <span aria-hidden="true">{point.label || '•'}</span>
          </button>
        ))}
      </div>
      <div className="manual-hotspot-alternative" aria-label="Hotspot descriptions">
        <p className="manual-alternative-label">Image details</p>
        <ol>
          {points.map((point) => (
            <li key={point.id}>
              <button type="button" onClick={() => setSelected(point.id)} aria-pressed={selected === point.id}>
                {point.label || 'Hotspot'}
              </button>
              <Markdown>{point.body}</Markdown>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function CheckBlock({ block, preview, busy, onAnswer, answer, serverResult, onResult }) {
  const options = Array.isArray(block.options) ? block.options : [];
  const [localResult, setLocalResult] = useState(null);
  const result = preview ? localResult : serverResult;
  const selectedOption = answer?.optionId ?? localResult?.optionId ?? null;

  const choose = async (optionId) => {
    if (busy || !optionId) return;
    if (preview) {
      const correct = optionId === block.correctOptionId;
      const next = { blockId: block.id, optionId, correct, feedback: correct ? 'That is the best answer.' : 'Try again.' };
      if (block.explanation) next.feedback = block.explanation;
      setLocalResult(next);
      return;
    }
    if (!onAnswer) return;
    try {
      const response = await onAnswer(block.id, optionId);
      // A production renderer only accepts server data.  In particular, it
      // does not retain an optimistic "wrong" or "correct" answer.
      if (response?.result) onResult?.(response.result);
      else if (response && typeof response.correct === 'boolean') onResult?.(response);
    } catch {
      // The parent owns the error presentation. Its injected transport keeps
      // a retry of this same answer idempotent.
    }
  };

  return (
    <div className="manual-check">
      {block.body ? <Markdown className="manual-scenario">{block.body}</Markdown> : null}
      <div className="manual-options" role="radiogroup" aria-label={block.prompt || 'Choose an answer'}>
        {options.map((option) => (
          <button
            type="button"
            className={`manual-option ${selectedOption === option.id ? 'is-selected' : ''}`}
            key={option.id}
            onClick={() => choose(option.id)}
            disabled={Boolean(busy)}
            role="radio"
            aria-checked={selectedOption === option.id}
          >
            <span className="manual-option-marker" aria-hidden="true" />
            <span>{option.text}</span>
          </button>
        ))}
      </div>
      <Feedback result={result} />
    </div>
  );
}

function Block({ block, preview, completed, busy, onAnswer, onComplete, answer, result, setResult }) {
  const type = blockType(block);
  let body;
  let passive = true;

  if (type === 'text') body = <Markdown>{block.body}</Markdown>;
  else if (type === 'image' || type === 'video') body = <MediaBlock block={block} />;
  else if (type === 'attachment') {
    body = (
      <a className="manual-attachment" href={block.url} target="_blank" rel="noreferrer">
        <span aria-hidden="true">↗</span>
        <span>{block.label || 'Open attachment'}</span>
      </a>
    );
  } else if (type === 'accordion') body = <AccordionBlock block={block} />;
  else if (type === 'flashcards') body = <FlashcardsBlock block={block} />;
  else if (type === 'hotspots') body = <HotspotsBlock block={block} />;
  else if (type === 'check' || type === 'scenario') {
    passive = false;
    body = (
      <CheckBlock
        block={block}
        preview={preview}
        busy={busy}
        onAnswer={onAnswer}
        answer={answer}
        serverResult={result}
        onResult={setResult}
      />
    );
  } else {
    body = <p className="manual-unsupported">This lesson block is unavailable.</p>;
  }

  return (
    <section className={`manual-block manual-block-${type || 'unknown'}`} data-block-id={block.id}>
      {block.title ? <h2>{block.title}</h2> : null}
      {type === 'check' || type === 'scenario' ? (
        <h3 className="manual-prompt">{block.prompt}</h3>
      ) : null}
      {body}
      {passive ? <PassiveComplete blockId={block.id} completed={completed} busy={busy} onComplete={onComplete} /> : null}
    </section>
  );
}

/**
 * Render one lesson or a content block array.
 *
 * `onAnswer` and `onComplete` are intentionally dependency-injected.  A
 * preview passes neither callback and grades draft checks locally; a published
 * reader passes authenticated API callbacks and receives only server grading.
 */
export default function ManualLesson({
  content,
  preview = false,
  progress,
  onAnswer,
  onComplete,
  busy = false,
}) {
  const lesson = useMemo(() => normalizeLesson(content), [content]);
  const blocks = lessonBlocks(lesson);
  const completedIds = new Set(progress?.completedBlockIds || []);
  const answers = progress?.answers || {};
  const [locallyCompleted, setLocallyCompleted] = useState(() => new Set());
  const [results, setResults] = useState({});
  const title = lesson.title;

  const handleResult = (blockId, value) => {
    setResults((current) => ({ ...current, [blockId]: value }));
  };

  const handleComplete = (blockId) => {
    if (preview) {
      setLocallyCompleted((current) => new Set(current).add(blockId));
      return;
    }
    onComplete?.(blockId);
  };

  return (
    <article className={`manual-lesson ${preview ? 'manual-preview' : ''}`}>
      {title ? <h1 className="manual-lesson-title">{title}</h1> : null}
      {lesson.summary ? <Markdown className="manual-lesson-summary">{lesson.summary}</Markdown> : null}
      {lesson.objectives?.length ? (
        <ul className="manual-objectives">
          {lesson.objectives.map((objective) => <li key={objective}>{objective}</li>)}
        </ul>
      ) : null}
      <div className="manual-blocks">
        {blocks.map((block) => (
          <Block
            key={block.id}
            block={block}
            preview={preview}
            completed={completedIds.has(block.id) || locallyCompleted.has(block.id)}
            busy={typeof busy === 'object' ? busy[block.id] : busy}
            onAnswer={onAnswer}
            onComplete={preview || onComplete ? handleComplete : undefined}
            answer={answers[block.id]}
            result={results[block.id] || answers[block.id]}
            setResult={(value) => handleResult(block.id, value)}
          />
        ))}
      </div>
      {!blocks.length ? <p className="manual-empty">This lesson has no content yet.</p> : null}
    </article>
  );
}

export { Markdown, Feedback, HotspotsBlock, FlashcardsBlock, AccordionBlock };