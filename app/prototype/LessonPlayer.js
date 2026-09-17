'use client';

import { useEffect, useMemo, useState } from 'react';
import { Block, CheckItem, localGrade } from './lesson-blocks';

/* The lesson player. A lesson is a sequence of items, one per screen, behind
   an overview screen. Progress (which items are done, how checks were
   answered, which hotspots were explored) is owned by the caller and handed
   back through onProgress, so the authored mock lessons keep it in prefs and
   a live course can keep it wherever it likes. A check has to be answered
   before Next unlocks -- the Moodle question-page rule -- and a page with
   diagram callouts stays gated until every callout has been opened.

   `grade(item, k)` resolves a check: synchronously from the item's own key
   (authored lessons, instructor preview) or from the server (learners). */

export const KIND = { page: 'Read', check: 'Check', practice: 'Practice', attachments: 'Files', overview: 'Overview' };

const EMPTY = { seen: [], answers: {}, hotspots: {}, complete: false };

/* Older saved progress stored a check as the picked index; resolve it against
   the key on the item so the screen and the map still read correctly. */
function resultFor(item, stored) {
  if (stored == null) return null;
  if (typeof stored === 'number') return item.answers?.some((a) => 'correct' in a) ? localGrade(item, stored) : null;
  return stored;
}

export default function LessonPlayer({
  lessonId,
  kicker,
  title,
  titleTag = null,
  intro,
  facts = [],
  items,
  notAuthored = false,
  page,
  onPage,
  progress,
  onProgress,
  grade,
  onBack,
  backLabel = '← All lessons',
  prev = null,
  next = null,
  onPick,
  renderItem,
  overviewExtra = null,
  sideExtra = null,
  mapLabel = 'Lesson map',
}) {
  const prog = { ...EMPTY, ...(progress || {}) };
  const [checking, setChecking] = useState(null);
  const [checkError, setCheckError] = useState(null);

  // Screen 1 is the overview; items follow.
  const screens = useMemo(
    () => [{ id: `${lessonId}#0`, type: 'overview', title: 'Overview' }, ...items],
    [items, lessonId]
  );
  const idx = Math.min(Math.max((page || 1) - 1, 0), screens.length - 1);
  const cur = screens[idx];

  const save = (patch) => onProgress({ ...prog, ...patch });

  // Seeing a screen records it. Checks record only when answered.
  useEffect(() => {
    if (cur.type !== 'check' && !prog.seen.includes(cur.id)) save({ seen: [...prog.seen, cur.id] });
    setCheckError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.id]);

  const unexploredHotspots = (sc) =>
    sc.type === 'page' &&
    sc.blocks.some((b, bi) => b.type === 'hotspots' && (prog.hotspots?.[`${sc.id}::${bi}`]?.length || 0) < b.spots.length);
  const onExplore = (blockKey, i) =>
    save({ hotspots: { ...prog.hotspots, [blockKey]: [...new Set([...(prog.hotspots?.[blockKey] || []), i])] } });

  const answerFor = (sc) => resultFor(sc, prog.answers[sc.id]);
  const doneIds = new Set(prog.seen);
  const isDone = (sc) => (sc.type === 'check' ? answerFor(sc) != null : doneIds.has(sc.id));
  const isGatedScreen = (sc) => (sc.type === 'check' && answerFor(sc) == null) || unexploredHotspots(sc);
  const gated = isGatedScreen(cur);
  const doneCount = screens.filter(isDone).length;
  const pct = Math.round((doneCount / screens.length) * 100);
  const checks = items.filter((it) => it.type === 'check');
  const correct = checks.filter((c) => answerFor(c)?.correct).length;
  const atEnd = idx === screens.length - 1;
  const allDone = screens.every(isDone);

  // Sequential: you can jump back freely, forward only as far as you've unlocked.
  const firstLocked = screens.findIndex((sc, k) => k > 0 && isGatedScreen(sc));
  const maxReach = firstLocked === -1 ? screens.length - 1 : firstLocked;
  const canOpen = (k) => k <= maxReach;

  const goTo = (k) => onPage(Math.min(Math.max(k, 0), screens.length - 1) + 1);
  const finish = () => save({ complete: true });

  const pick = async (item, k) => {
    setCheckError(null);
    setChecking(item.id);
    try {
      const result = await grade(item, k);
      save({ answers: { ...prog.answers, [item.id]: result } });
    } catch (error) {
      setCheckError(error?.message || 'The course service did not grade this answer.');
    } finally {
      setChecking(null);
    }
  };

  const custom = cur.type !== 'overview' && cur.type !== 'page' && cur.type !== 'check' && renderItem ? renderItem(cur) : null;

  return (
    <div className="s-lp">
      <div className="s-lp-main">
        <div className="s-lp-top">
          <button className="s-crumbs-inline" onClick={onBack}>{backLabel}</button>
          <span className="s-lp-topmeta">{kicker}</span>
        </div>

        <div className="s-lp-progress">
          <div className="s-lp-bar"><div className="s-lp-fill" style={{ width: `${pct}%` }} /></div>
          <span className="s-lp-count">{idx + 1} of {screens.length}</span>
        </div>

        <article className="s-lp-card" key={cur.id}>
          <div className="s-lp-kind">{KIND[cur.type] || 'Read'}{notAuthored && cur.type !== 'overview' ? ' · not yet authored' : ''}</div>

          {cur.type === 'overview' && (
            <>
              <h1 className="s-ls-title">
                {title}
                {titleTag}
              </h1>
              <p className="s-ls-intro">{intro}</p>
              {facts.length > 0 && (
                <div className="s-lp-facts">
                  <div><b>{items.filter((it) => it.type === 'page').length}</b> pages</div>
                  <div><b>{checks.length}</b> checks</div>
                  {facts.map(([b, label]) => <div key={label}><b>{b}</b> {label}</div>)}
                </div>
              )}
              {overviewExtra}
              {prog.complete && <div className="s-ls-callout tip" style={{ marginTop: '1rem' }}><div className="s-ls-callout-t">Completed</div><div>You have finished this lesson. Pages stay open for review.</div></div>}
            </>
          )}

          {cur.type === 'page' && (
            <>
              <h2 className="s-lp-h">{cur.title}</h2>
              {cur.blocks.map((b, bi) => (
                <Block
                  key={bi}
                  block={b}
                  blockKey={`${cur.id}::${bi}`}
                  explored={prog.hotspots?.[`${cur.id}::${bi}`]}
                  onExplore={onExplore}
                />
              ))}
            </>
          )}

          {cur.type === 'check' && (
            <CheckItem
              item={cur}
              result={answerFor(cur)}
              busy={checking === cur.id}
              error={checkError}
              onPick={(k) => pick(cur, k)}
            />
          )}

          {custom}
        </article>

        <div className="s-lp-nav">
          <button className="p-btn ghost" disabled={idx === 0} onClick={() => goTo(idx - 1)}>← Previous</button>
          <span className="s-lp-navmid">
            {gated
              ? (cur.type === 'check' ? 'Answer to continue' : 'Explore every callout to continue')
              : cur.type === 'overview' ? (prog.complete ? 'Review' : 'Start the lesson') : ''}
          </span>
          {!atEnd ? (
            <button className="p-btn" disabled={gated} onClick={() => goTo(idx + 1)}>
              {cur.type === 'overview' ? (prog.complete ? 'Review →' : 'Start →') : 'Next →'}
            </button>
          ) : prog.complete ? (
            next ? <button className="p-btn" onClick={() => onPick(next)}>Next lesson: {next.title} →</button> : <button className="p-btn ghost" onClick={onBack}>Back to lessons</button>
          ) : (
            <button className="p-btn" disabled={!allDone} onClick={finish} title={allDone ? '' : 'Answer every check first'}>
              Finish lesson ✓
            </button>
          )}
        </div>
      </div>

      <aside className="s-lp-side">
        <div className="s-outline">
          <div className="s-label">{mapLabel}</div>
          <ol className="s-map">
            {screens.map((sc, k) => {
              const done = isDone(sc);
              const locked = !canOpen(k);
              const ans = sc.type === 'check' ? (answerFor(sc)?.correct ?? null) : null;
              return (
                <li key={sc.id}>
                  <button className={`s-map-item${k === idx ? ' on' : ''}${locked ? ' locked' : ''}`} disabled={locked} onClick={() => goTo(k)}>
                    <span className={`s-map-mark ${sc.type}${done ? ' done' : ''}${ans === false ? ' miss' : ''}`}>
                      {done ? (ans === false ? '!' : '✓') : ''}
                    </span>
                    <span className="s-map-text">
                      <span className="s-map-title">{sc.title}</span>
                      <span className="s-map-kind">{KIND[sc.type] || 'Read'}{ans === false ? ' · missed' : ''}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="s-outline-foot">
            {doneCount} of {screens.length} done{checks.length ? ` · ${correct}/${checks.length} checks correct` : ''}
          </div>
        </div>
        {sideExtra}
        {(prev || next) && (
          <div className="s-lp-jump">
            {prev && <button className="s-lesson-navbtn" onClick={() => onPick(prev)}><span>← Previous lesson</span><b>{prev.title}</b></button>}
            {next && <button className="s-lesson-navbtn" onClick={() => onPick(next)}><span>Next lesson →</span><b>{next.title}</b></button>}
          </div>
        )}
      </aside>
    </div>
  );
}
