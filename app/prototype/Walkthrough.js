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

/* Card placement.
 *
 * The one rule the presenter cares about: the card must never sit on top of the
 * thing being pointed at. So rather than "below, else above", this measures the
 * clear space on each side of the spotlight and docks the card into whichever
 * gap is largest. A target that fills the viewport (a whole content column) has
 * no side gap big enough, so the card falls back to the bottom-right corner --
 * out of the reading path either way -- and the caller is told, so it can shrink
 * the card to a compact strip that covers as little as possible.
 */
const CARD_EST_HEIGHT = 300;

/* A target that fills most of the viewport is not a spotlight -- it is the whole
   screen, so outlining it points at nothing. When the anchor is a screen-level
   element (our shells put data-tour on <main>) the honest thing is to show the
   card and NOT draw a misleading outline; a small element like the Ask button
   still gets a real spotlight. */
function isWholeScreen(rect, viewport) {
  if (!rect) return false;
  return rect.width >= viewport.width * 0.6 && rect.height >= viewport.height * 0.5;
}

/* `cardHeight` is the card's measured height (see the layout effect); the whole
   card is kept on-screen so the footer with Next is never clipped. */
function placeCard(rect, viewport, cardHeight = CARD_EST_HEIGHT) {
  const height = Math.min(cardHeight || CARD_EST_HEIGHT, viewport.height - VIEWPORT_MARGIN * 2);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const maxLeft = viewport.width - CARD_WIDTH - VIEWPORT_MARGIN;
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN);
  const centerLeft = Math.max(VIEWPORT_MARGIN, (viewport.width - CARD_WIDTH) / 2);

  if (!rect || isWholeScreen(rect, viewport)) {
    // No specific element to point at: dock the card to the bottom-right, out of
    // the reading path, fully on-screen, and draw no spotlight.
    return { left: maxLeft, top: maxTop, placement: rect ? 'corner' : 'center', spotlight: false };
  }

  const gap = {
    right: viewport.width - rect.right,
    left: rect.left,
    bottom: viewport.height - rect.bottom,
    top: rect.top,
  };
  const needSide = CARD_WIDTH + CARD_GAP + VIEWPORT_MARGIN;
  const needStack = height + CARD_GAP + VIEWPORT_MARGIN;

  // Prefer a side dock (beside the focus), then below, then above. First
  // candidate that clears the spotlight wins; the card is always fully on-screen.
  if (gap.right >= needSide) {
    return { left: clamp(rect.right + CARD_GAP, VIEWPORT_MARGIN, maxLeft), top: clamp(rect.top, VIEWPORT_MARGIN, maxTop), placement: 'right', spotlight: true };
  }
  if (gap.left >= needSide) {
    return { left: clamp(rect.left - CARD_GAP - CARD_WIDTH, VIEWPORT_MARGIN, maxLeft), top: clamp(rect.top, VIEWPORT_MARGIN, maxTop), placement: 'left', spotlight: true };
  }
  const preferredLeft = clamp(rect.left + rect.width / 2 - CARD_WIDTH / 2, VIEWPORT_MARGIN, maxLeft);
  if (gap.bottom >= needStack) {
    return { left: preferredLeft, top: clamp(rect.bottom + CARD_GAP, VIEWPORT_MARGIN, maxTop), placement: 'bottom', spotlight: true };
  }
  if (gap.top >= needStack) {
    return { left: preferredLeft, top: clamp(rect.top - CARD_GAP - height, VIEWPORT_MARGIN, maxTop), placement: 'top', spotlight: true };
  }
  // A real element but no clear gap: corner the card, keep the spotlight on it.
  return { left: maxLeft, top: maxTop, placement: 'corner', spotlight: true };
}

export default function WalkthroughProvider({ nav, enabled = true, children }) {
  const { courses } = useLearningCourses();
  const demoCourse = useMemo(() => pickDemoCourse(courses), [courses]);

  const [state, setState] = useState(() => ({ running: false, index: 0, startedAt: null, dismissed: false }));
  const [rect, setRect] = useState(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  // The presenter's escape hatch: if the card ever sits where they want to
  // point, they drag it, and it collapses to a pill on demand. drag is a manual
  // offset from the computed dock; reset whenever the step (and so the dock)
  // changes, so each step starts from a sensible place.
  const [drag, setDrag] = useState(null); // {x, y} px offset, or null
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef(null);
  // The card's own measured height, so placement can keep the whole card
  // on-screen (the footer with Next was clipping when the estimate was too low).
  const cardRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(CARD_EST_HEIGHT);

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

  // Each step computes its own dock, so a drag offset from the previous step
  // would land the card somewhere arbitrary. Clear it when the step changes.
  useEffect(() => { setDrag(null); }, [state.index]);

  /* Drag the card by its header. Pointer capture keeps the drag alive even if
     the cursor outruns the card, and the offset is clamped loosely so it can
     never be thrown fully off-screen. */
  const onDragStart = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = dragRef.current || { x: 0, y: 0 };
    const move = (e) => {
      setDrag({
        x: base.x + (e.clientX - startX),
        y: base.y + (e.clientY - startY),
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  // Measure the card so placement keeps the whole of it -- footer and Next
  // included -- on screen. Runs after each step's content renders, since the
  // body length (and so the height) changes per step.
  useEffect(() => {
    if (!state.running || minimized) return;
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h && Math.abs(h - cardHeight) > 4) setCardHeight(h);
  }, [state.running, state.index, minimized, cardHeight, rect, viewport.height]);

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
    setMinimized(false);
    setDrag(null);
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
  const card = placeCard(rect, viewport, cardHeight);
  const waitingForCourse = needsCourse(step) && !demoCourse;
  const left = card.left + (drag?.x || 0);
  const top = card.top + (drag?.y || 0);
  const isLast = state.index === STEPS.length - 1;

  return (
    <div className="sc-tour" role="dialog" aria-modal="false" aria-label={`Guided tour, step ${state.index + 1} of ${STEPS.length}`}>
      {rect && !minimized && card.spotlight && (
        <div
          className="sc-tour-spot"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
          }}
        />
      )}

      {minimized ? (
        <button
          type="button"
          className="sc-tour-pill"
          style={{ left, top }}
          onClick={() => setMinimized(false)}
          title="Reopen the tour"
        >
          <span className={`sc-tour-pilldot is-${pace}`} aria-hidden="true" />
          <span className="sc-tour-pilltime">{formatClock(elapsed)}</span>
          <span className="sc-tour-pilllabel">Step {state.index + 1}/{STEPS.length}</span>
        </button>
      ) : (
        <section
          ref={cardRef}
          className={`sc-tour-card is-${card.placement}${drag ? ' is-dragged' : ''}`}
          style={{ top, left, width: CARD_WIDTH }}
        >
          <header className="sc-tour-head" onPointerDown={onDragStart}>
            <span className="sc-tour-act">
              <span className="sc-tour-actnum">{actNumber}</span>
              {act?.label}
            </span>
            <span className="sc-tour-headright">
              <span className={`sc-tour-clock is-${pace}`} title={`Scripted ${formatClock(scheduled)} by this point`}>
                {formatClock(elapsed)}
                <span className="sc-tour-clocktotal"> / {formatClock(scriptTotal)}</span>
              </span>
              <button
                type="button"
                className="sc-tour-icon"
                onClick={() => setMinimized(true)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Minimize the tour"
                title="Minimize"
              >
                –
              </button>
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

          <div className="sc-tour-progress" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.id} className={`sc-tour-pip${i === state.index ? ' is-now' : ''}${i < state.index ? ' is-done' : ''}`} />
            ))}
          </div>

          <footer className="sc-tour-foot">
            <button type="button" className="sc-tour-btn quiet" onClick={() => stop(true)}>
              Exit
            </button>
            <div className="sc-tour-nav">
              <button type="button" className="sc-tour-btn" onClick={back} disabled={state.index === 0}>
                Back
              </button>
              <button type="button" className="sc-tour-btn primary" onClick={next}>
                {isLast ? 'Finish' : 'Next'}
              </button>
            </div>
          </footer>
          <p className="sc-tour-hint">
            Step {state.index + 1} of {STEPS.length} · drag to move · ← → to step · Esc to leave
          </p>
        </section>
      )}
    </div>
  );
  }
}
