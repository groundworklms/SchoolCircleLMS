'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './walkthrough.css';
import { href } from './routes';
import { useLearningCourses } from './learning';
import { WalkthroughContext } from './walkthrough-context';
import {
  ACTS,
  BUDGET_SECONDS,
  STEPS,
  actIndexOf,
  actOf,
  budgetSeconds,
  formatClock,
  needsCourse,
  resolveLocation,
  startOffsetSeconds,
} from './walkthrough-steps';

/* The guided demo.
 *
 * The script lives in walkthrough-steps.js; this draws it. Three things here
 * are deliberate rather than incidental:
 *
 *   - It navigates the real app and highlights real elements. There is no
 *     parallel set of demo screens to drift out of date, and nothing on screen
 *     during the tour is staged.
 *   - It waits for its target instead of assuming it. The slowest list on this
 *     app takes about 1.6s to arrive, so a tour that measured immediately after
 *     navigating would point at empty space on the very screens it is meant to
 *     show off.
 *   - It runs a stopwatch against the scripted time. We are given seven
 *     minutes, so the clock is part of the instrument, not a nicety: it shows
 *     whether the presenter is ahead or behind while there is still time to
 *     correct.
 */

const STORAGE_KEY = 'sc.walkthrough.v1';
const TARGET_TIMEOUT_MS = 6000;
const TARGET_POLL_MS = 120;
const SPOTLIGHT_PAD = 8;
const CARD_WIDTH = 384;
const CARD_GAP = 14;
const VIEWPORT_MARGIN = 12;

function readSaved() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.index !== 'number') return null;
    return {
      index: Math.min(Math.max(0, Math.trunc(parsed.index)), STEPS.length - 1),
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
      dismissed: Boolean(parsed.dismissed),
    };
  } catch {
    return null;
  }
}

function writeSaved(value) {
  if (typeof window === 'undefined') return;
  try {
    if (!value) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* A tour is not worth breaking a demo over if storage is unavailable. */
  }
}

/** Pick the course the tour runs on: a published one if there is one, since a
    draft is hidden from the learner half of the script and the student act
    would land on an empty screen. */
export function pickDemoCourse(courses) {
  const list = Array.isArray(courses) ? courses : [];
  return list.find((course) => course?.status === 'APPROVED') || list[0] || null;
}

/* Card placement: below the target if it fits, above if it does not, and
   clamped inside the viewport either way so it is never half off-screen. */
function placeCard(rect, viewport) {
  if (!rect) {
    return { left: Math.max(VIEWPORT_MARGIN, (viewport.width - CARD_WIDTH) / 2), top: viewport.height * 0.34, centered: true };
  }
  const below = rect.bottom + CARD_GAP;
  const estimatedHeight = 210;
  const fitsBelow = below + estimatedHeight < viewport.height - VIEWPORT_MARGIN;
  const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - CARD_GAP - estimatedHeight);
  const preferredLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, preferredLeft),
    Math.max(VIEWPORT_MARGIN, viewport.width - CARD_WIDTH - VIEWPORT_MARGIN),
  );
  return { left, top, centered: false };
}

export default function WalkthroughProvider({ nav, enabled = true, children }) {
  const { courses } = useLearningCourses();
  const demoCourse = useMemo(() => pickDemoCourse(courses), [courses]);

  const [state, setState] = useState(() => ({ running: false, index: 0, startedAt: null, dismissed: false }));
  const [rect, setRect] = useState(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });

  const step = STEPS[state.index] || null;
  const scriptTotal = useMemo(() => budgetSeconds(), []);

  /* Restore a tour in progress, and honour ?tour=1 as a demo entry point so the
     whole run can be opened from a single bookmark. */
  useEffect(() => {
    const saved = readSaved();
    const params = new URLSearchParams(window.location.search);
    const wants = params.get('tour');
    if (wants === '1' || wants === 'start') {
      setState({ running: true, index: 0, startedAt: Date.now(), dismissed: false });
      return;
    }
    if (saved) setState((prev) => ({ ...prev, ...saved, running: false }));
  }, []);

  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /* Stopwatch. Runs off the start timestamp rather than accumulating ticks, so
     a slow frame or a backgrounded tab cannot make the clock lie. */
  useEffect(() => {
    if (!state.running || !state.startedAt) return undefined;
    const tick = () => setElapsed(Math.round((Date.now() - state.startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [state.running, state.startedAt]);

  const persist = useCallback((next) => {
    writeSaved({ index: next.index, startedAt: next.startedAt, dismissed: next.dismissed });
  }, []);

  const goToStep = useCallback((index) => {
    setState((prev) => {
      const clamped = Math.min(Math.max(0, index), STEPS.length - 1);
      const next = { ...prev, index: clamped, running: true, startedAt: prev.startedAt || Date.now() };
      persist(next);
      return next;
    });
  }, [persist]);

  const start = useCallback(() => {
    const next = { running: true, index: 0, startedAt: Date.now(), dismissed: false };
    setState(next);
    persist(next);
  }, [persist]);

  const stop = useCallback((dismissed) => {
    setState((prev) => {
      const next = { ...prev, running: false, dismissed: Boolean(dismissed) };
      persist({ index: 0, startedAt: null, dismissed: Boolean(dismissed) });
      return next;
    });
    setRect(null);
  }, [persist]);

  /* Navigate to the step's screen. Compared as rendered addresses so an
     equivalent location does not trigger a second push, and every field is
     named (see fullLocation) so nothing stale rides along. */
  const targetLocation = step ? resolveLocation(step, demoCourse?.id) : null;
  const targetHref = targetLocation ? href(targetLocation) : null;
  const currentHref = href({
    role: nav.role,
    area: nav.area,
    courseId: nav.courseId,
    view: nav.view,
    lessonId: nav.lessonId,
    page: nav.page,
    threadId: nav.threadId,
    tab: nav.tab,
  });

  useEffect(() => {
    if (!state.running || !targetHref) return;
    if (targetHref !== currentHref) nav.go(targetLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.running, targetHref, currentHref]);

  /* Find and follow the target. Polls because the screens the tour visits load
     their data after navigating, then keeps the highlight aligned while the
     page scrolls or reflows. */
  useEffect(() => {
    if (!state.running || !step) return undefined;
    setTargetMissing(false);
    let cancelled = false;
    let timer = null;
    const deadline = Date.now() + TARGET_TIMEOUT_MS;

    const locate = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      if (el) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 || box.height > 0) {
          setRect({ top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom });
          setTargetMissing(false);
          const offscreen = box.top < 0 || box.bottom > window.innerHeight;
          if (offscreen) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          timer = window.setTimeout(locate, 400);
          return;
        }
      }
      if (Date.now() > deadline) {
        /* Say so rather than pointing at nothing: the card falls back to the
           middle of the screen and the copy still carries the narration. */
        setRect(null);
        setTargetMissing(true);
        return;
      }
      timer = window.setTimeout(locate, TARGET_POLL_MS);
    };

    locate();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [state.running, step, currentHref]);

  const next = useCallback(() => {
    if (state.index >= STEPS.length - 1) stop(false);
    else goToStep(state.index + 1);
  }, [state.index, goToStep, stop]);

  const back = useCallback(() => goToStep(state.index - 1), [state.index, goToStep]);

  useEffect(() => {
    if (!state.running) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') stop(false);
      else if (event.key === 'ArrowRight' || event.key === 'Enter') next();
      else if (event.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.running, next, back, stop]);

  /* Published for the account menu in each shell. `start` is null when the tour
     cannot run, so a shell omits the item rather than offering a dead end. */
  const contextValue = useMemo(() => ({
    start: enabled ? start : null,
    running: state.running,
    scriptLabel: formatClock(scriptTotal),
  }), [enabled, start, state.running, scriptTotal]);

  const overlay = enabled && state.running && step ? renderOverlay() : null;

  return (
    <WalkthroughContext.Provider value={contextValue}>
      {children}
      {overlay}
    </WalkthroughContext.Provider>
  );

  function renderOverlay() {
  const act = actOf(step);
  const actNumber = actIndexOf(step) + 1;
  const scheduled = startOffsetSeconds(state.index) + step.seconds;
  const drift = elapsed - scheduled;
  const overBudget = elapsed > BUDGET_SECONDS;
  const pace = overBudget ? 'over' : drift > 20 ? 'behind' : drift < -20 ? 'ahead' : 'onpace';
  const card = placeCard(rect, viewport);
  const waitingForCourse = needsCourse(step) && !demoCourse;

  return (
    <div className="sc-tour" role="dialog" aria-modal="false" aria-label={`Guided tour, step ${state.index + 1} of ${STEPS.length}`}>
      {rect ? (
        <div
          className="sc-tour-spot"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
          }}
        />
      ) : (
        <div className="sc-tour-scrim" />
      )}

      <section
        className={`sc-tour-card${card.centered ? ' is-centered' : ''}`}
        style={{ top: card.top, left: card.left, width: CARD_WIDTH }}
      >
        <header className="sc-tour-head">
          <span className="sc-tour-act">
            Act {actNumber} of {ACTS.length} · {act?.label}
          </span>
          <span className={`sc-tour-clock is-${pace}`} title={`Scripted ${formatClock(scheduled)} by this point`}>
            {formatClock(elapsed)} / {formatClock(scriptTotal)}
          </span>
        </header>

        <h2 className="sc-tour-title">{step.title}</h2>
        <p className="sc-tour-body">{step.body}</p>

        {waitingForCourse && (
          <p className="sc-tour-note">
            This step needs a published course. Publish one from the instructor library and the
            tour will pick it up.
          </p>
        )}
        {targetMissing && !waitingForCourse && (
          <p className="sc-tour-note">
            Still loading this screen — the narration above is the point; the highlight will catch up.
          </p>
        )}

        <footer className="sc-tour-foot">
          <div className="sc-tour-progress" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`sc-tour-pip${i === state.index ? ' is-now' : ''}${i < state.index ? ' is-done' : ''}`} />
            ))}
          </div>
          <div className="sc-tour-actions">
            <button type="button" className="sc-tour-btn quiet" onClick={() => stop(true)}>
              Exit
            </button>
            <button type="button" className="sc-tour-btn" onClick={back} disabled={state.index === 0}>
              Back
            </button>
            <button type="button" className="sc-tour-btn primary" onClick={next}>
              {state.index === STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </footer>
        <p className="sc-tour-hint">
          Step {state.index + 1} of {STEPS.length} · arrow keys to move, Esc to leave
        </p>
      </section>
    </div>
  );
  }
}
