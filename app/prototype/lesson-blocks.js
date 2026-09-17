'use client';

import { useState } from 'react';

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
      <div className="s-vid-foot">{block.title} · {block.prompts.filter((p) => p.kind === 'question').length} questions in the video. Tap a marker to jump to it.</div>
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

export function CheckItem({ item, result, onPick, busy = false, error = null }) {
  const picked = result?.picked ?? null;
  const key = picked !== null ? keyLetter(result.answer) : null;
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
          }
          return (
            <button key={a.text} className={`p-ans${cls}`} disabled={picked !== null || busy} onClick={() => onPick(i)}>
              <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
              <span>{a.text}</span>
            </button>
          );
        })}
      </div>
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
