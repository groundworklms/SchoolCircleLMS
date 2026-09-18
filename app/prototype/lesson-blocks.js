'use client';

import { useState } from 'react';
import { CONFIDENCE } from '../../lib/learning/calibration';

/* The screens a lesson is made of, shared by the authored mock lessons
   (lessonContent.js) and the live generated courses (lib/learning/lesson-pages.js).
   Block vocabulary: p, h, list, callout{kind,title,text}, terms{items},
   figure{caption,svg}, example{title,steps,result}, accordion{items},
   hotspots{svg,caption,spots}, video{prompts}, flashcards{cards}. */

export function Block({ block, blockKey, explored, onExplore }) {
  switch (block.type) {
    case 'p':
      return <p className="s-ls-p">{block.text}</p>;
    case 'h':
      return <h4 className="s-ls-h4">{block.text}</h4>;
    case 'list':
      return (
        <ul className="s-ls-list">
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'callout':
      return (
        <aside className={`s-ls-callout ${block.kind}`}>
          <div className="s-ls-callout-t">{block.title}</div>
          <div>{block.text}</div>
        </aside>
      );
    case 'terms':
      return (
        <dl className="s-ls-terms">
          {block.items.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      );
    case 'figure':
      return (
        <figure className="s-ls-fig">
          <div className="s-ls-fig-art" dangerouslySetInnerHTML={{ __html: block.svg }} />
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    case 'example':
      return (
        <div className="s-ls-ex">
          <div className="s-ls-ex-t">{block.title}</div>
          <ol>
            {block.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
          {block.result && <div className="s-ls-ex-r">{block.result}</div>}
        </div>
      );
    case 'accordion':
      return <Accordion items={block.items} />;
    case 'hotspots':
      return <Hotspots block={block} explored={explored || []} onExplore={(i) => onExplore(blockKey, i)} />;
    case 'video':
      return <InteractiveVideo block={block} />;
    case 'flashcards':
      return <Flashcards cards={block.cards} />;
    default:
      return null;
  }
}

/* ---- H5P-style interactive blocks ---- */

function Accordion({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="s-acc">
      {items.map((it, i) => (
        <div key={it.title} className={`s-acc-item${open === i ? ' open' : ''}`}>
          <button className="s-acc-head" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            <span>{it.title}</span>
            <span className="s-acc-chev">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <div className="s-acc-body">{it.text}</div>}
        </div>
      ))}
    </div>
  );
}

function Hotspots({ block, explored, onExplore }) {
  const [on, setOn] = useState(null);
  const seen = new Set(explored);
  const pick = (i) => {
    setOn(on === i ? null : i);
    if (!seen.has(i)) onExplore(i);
  };
  const spot = on != null ? block.spots[on] : null;
  const allSeen = seen.size >= block.spots.length;
  return (
    <figure className="s-ls-fig s-hs">
      <div className="s-ls-fig-art s-hs-art">
        <div dangerouslySetInnerHTML={{ __html: block.svg }} />
        {block.spots.map((sp, i) => (
          <button
            key={sp.title}
            className={`s-hs-dot${on === i ? ' on' : ''}${seen.has(i) ? ' seen' : ''}`}
            style={{ left: `${sp.x}%`, top: `${sp.y}%` }}
            onClick={() => pick(i)}
            aria-label={sp.title}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="s-hs-panel">
        {spot ? (
          <>
            <div className="s-hs-title">{on + 1} · {spot.title}</div>
            <div className="s-hs-text">{spot.text}</div>
          </>
        ) : (
          <div className="s-hs-text" style={{ color: allSeen ? 'var(--p-good)' : 'var(--p-faint)' }}>
            {seen.size} of {block.spots.length} explored{allSeen ? ' — all explored' : ', tap each point to continue'}
          </div>
        )}
      </div>
      <figcaption>{block.caption}</figcaption>
    </figure>
  );
}

function fmt(t) {
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function InteractiveVideo({ block }) {
  const [t, setT] = useState(0);
  const [openPrompt, setOpenPrompt] = useState(null);
  const [picked, setPicked] = useState({});
  const pr = openPrompt != null ? block.prompts[openPrompt] : null;
  const jump = (i) => {
    setT(block.prompts[i].at);
    setOpenPrompt(i);
  };
  return (
    <div className="s-vid">
      <div className="s-vid-screen">
        <div className="s-vid-poster">
          <span className="s-vid-play">▶</span>
          <span>{block.poster}</span>
        </div>
        {pr && (
          <div className="s-vid-overlay">
            <div className="s-vid-ov-lab">{fmt(pr.at)} · {pr.kind === 'question' ? 'Question' : 'Note'}</div>
            {pr.kind === 'note' ? (
              <div className="s-vid-ov-text">{pr.text}</div>
            ) : (
              <>
                <div className="s-vid-ov-text">{pr.q}</div>
                <div className="s-vid-ov-a">
                  {pr.answers.map((a, i) => {
                    const p = picked[openPrompt];
                    let cls = '';
                    if (p != null) cls = a.correct ? ' correct' : i === p ? ' wrong' : '';
                    return (
                      <button key={a.text} className={`p-ans${cls}`} disabled={p != null} onClick={() => setPicked({ ...picked, [openPrompt]: i })}>
                        <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
                        <span>{a.text}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em', marginTop: '0.6rem' }} onClick={() => setOpenPrompt(null)}>Continue</button>
          </div>
        )}
      </div>
      <div className="s-vid-bar">
        <span className="s-vid-time">{fmt(t)}</span>
        <div className="s-vid-track" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.round(((e.clientX - r.left) / r.width) * block.duration)); }}>
          <div className="s-vid-fill" style={{ width: `${(t / block.duration) * 100}%` }} />
          {block.prompts.map((p, i) => (
            <button
              key={p.at}
              className={`s-vid-mark ${p.kind}${picked[i] != null ? ' done' : ''}`}
              style={{ left: `${(p.at / block.duration) * 100}%` }}
              onClick={(e) => { e.stopPropagation(); jump(i); }}
              title={`${fmt(p.at)} · ${p.kind}`}
            />
          ))}
        </div>
        <span className="s-vid-time">{fmt(block.duration)}</span>
      </div>
      <div className="s-vid-foot">{block.title} · {block.prompts.filter((p) => p.kind === 'question').length} questions · tap a marker to jump.</div>
    </div>
  );
}

function Flashcards({ cards }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[i];
  const go = (n) => {
    setFlipped(false);
    setI((i + n + cards.length) % cards.length);
  };
  return (
    <div className="s-fc">
      <button className={`s-fc-card${flipped ? ' flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
        <span className="s-fc-side">{card.front}</span>
        <span className="s-fc-side back">{card.back}</span>
      </button>
      <div className="s-fc-nav">
        <button className="p-btn ghost" onClick={() => go(-1)}>←</button>
        <span className="s-fc-count">{i + 1} of {cards.length} · tap the card to flip</span>
        <button className="p-btn ghost" onClick={() => go(1)}>→</button>
      </div>
    </div>
  );
}

/* A check resolves to a result { picked, correct, answer, rationale }. For an
   authored lesson the key is on the item and the player grades locally; for a
   live course the learner's copy has no key and the player asks the server.
   Either way this screen only ever sees the result. */
export function localGrade(item, k) {
  const answer = item.answers.findIndex((a) => a.correct);
  return { picked: k, correct: item.answers[k]?.correct === true, answer, rationale: item.rationale || '' };
}

/* The letter of a keyed answer, or null when the result carries none. A live
   course grades on the server and returns answer: null on a miss -- the key
   never leaves the server -- so 65 + null would have read as "A" every time. */
function keyLetter(index) {
  return Number.isInteger(index) && index >= 0 ? String.fromCharCode(65 + index) : null;
}

/*
 * How sure the learner is, asked between choosing and seeing.
 *
 * It has to be here rather than on a results screen, because after the reveal
 * the question is worthless -- nobody can un-know a keyed answer, and an
 * answer to "how sure were you?" given afterwards is a memory of a feeling.
 * The one useful reading is the one taken while the answer is still unknown.
 *
 * Skippable on purpose. A learner who does not want to rate every question
 * still gets graded, and their attempt is simply not part of a calibration --
 * see lib/learning/calibration.js on why an absent rating must never become a
 * zero. Skipping is a plain control, not a dismissal tucked in a corner.
 */
function ConfidencePrompt({ onAnswer, busy }) {
  return (
    <div className="s-chk-conf" role="group" aria-label="How sure are you?">
      <div className="s-chk-conf-lab">Before you see the answer — how sure are you?</div>
      <div className="s-chk-conf-row">
        {CONFIDENCE.map((point) => (
          <button
            key={point.value}
            type="button"
            className="p-btn ghost s-chk-conf-btn"
            disabled={busy}
            onClick={() => onAnswer(point.value)}
          >
            {point.label}
          </button>
        ))}
        <button
          type="button"
          className="s-chk-conf-skip"
          disabled={busy}
          onClick={() => onAnswer(null)}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export function CheckItem({ item, result, onPick, busy = false, error = null, askConfidence = false }) {
  const picked = result?.picked ?? null;
  const key = picked !== null ? keyLetter(result.answer) : null;
  // The option the learner chose but has not been graded on yet, held here
  // while the confidence question is up. Nothing is sent until they answer it
  // or skip, so the grade and the rating arrive together.
  const [pending, setPending] = useState(null);
  const awaiting = askConfidence && pending !== null && picked === null;

  const choose = (index) => {
    if (!askConfidence) return onPick(index);
    return setPending(index);
  };
  const answerConfidence = (confidence) => {
    const index = pending;
    setPending(null);
    return onPick(index, confidence);
  };

  return (
    <div className="s-chk" data-item-id={item.itemId || undefined}>
      <div className="s-chk-lab">Check your understanding</div>
      <div className="s-chk-q">{item.q}</div>
      <div className="s-chk-a">
        {item.answers.map((a, i) => {
          let cls = '';
          if (picked !== null) {
            if (i === result.answer) cls = ' correct';
            else if (i === picked) cls = ' wrong';
          } else if (awaiting && i === pending) {
            cls = ' picked';
          }
          return (
            <button
              key={a.text}
              className={`p-ans${cls}`}
              aria-pressed={awaiting ? i === pending : undefined}
              disabled={picked !== null || busy}
              onClick={() => choose(i)}
            >
              <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
              <span>{a.text}</span>
            </button>
          );
        })}
      </div>
      {awaiting && <ConfidencePrompt onAnswer={answerConfidence} busy={busy} />}
      {busy && <div className="p-src" style={{ marginTop: '0.6rem' }}>Checking…</div>}
      {error && <div className="s-ls-callout warn" style={{ marginTop: '0.6rem' }}><div className="s-ls-callout-t">Could not check that answer</div><div>{error}</div></div>}
      {picked !== null && (
        <div className="p-rationale">
          <span className="p-rlab">{result.correct ? 'Correct — here is why' : 'Not quite — here is why'}</span>
          {result.rationale || (result.correct
            ? 'That is the keyed answer.'
            : key ? `The keyed answer is ${key}.` : 'That is not the keyed answer.')}
        </div>
      )}
    </div>
  );
}
