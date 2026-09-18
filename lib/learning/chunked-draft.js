/**
 * A course generation that can be stopped and picked up again.
 *
 * WHY. Writing a twelve-section course is twenty minutes of model calls, and
 * the process doing it does not reliably live that long: Firebase App Hosting
 * replaces the instance on every push to main, and a course that had written
 * all twelve sections was lost that way twice in one evening. Saving the
 * sections before the page pass helped and did not solve it, because the
 * twenty minutes BEFORE that save were still one indivisible unit of work.
 *
 * WHAT THIS DOES. The work is cut into pieces that each finish, and the state
 * between them lives on the job row rather than in a closure. A plan is made
 * once and written down. Each section is written on its own and written down
 * as it lands. When the last one is in, the course is assembled, validated and
 * saved. Anything that kills the process costs the section in flight -- one
 * model call's worth of work -- and a resumed run reads the row, sees what is
 * already there, and carries on from the next one.
 *
 * WHAT MAKES IT CORRECT RATHER THAN MERELY RESTARTABLE. Two pieces of state
 * that used to live in one long-running closure now travel on the row:
 *
 *   - the stems every section has already asked, so the duplicate-question
 *     checks do not go blind at a chunk boundary;
 *   - the paragraph openings the course has already spent, for the same reason
 *     in the page pass.
 *
 * Without those, a resumed course is not the same course as an uninterrupted
 * one, and the checks that make it worth generating quietly stop working at
 * exactly the seams nobody looks at.
 *
 * WHAT IS STILL NOT SAFE. The section in flight. Making that atomic would mean
 * chunking inside one model call, which is not a thing.
 */

import { assembleCourse, planCourse, writeCourseSection } from '../arsenal-core.js';

/** Nothing written yet. The shape every later stage reads and adds to. */
export function emptyProgress() {
  return { stage: 'plan', sections: [], usedStems: [], written: 0 };
}

/**
 * The next thing to do, given what is already on the row.
 *
 * Pure, so a caller can ask "what is left" without touching a model, and so
 * the resume logic is testable without a database or a provider.
 */
export function nextStep(progress) {
  const state = progress && typeof progress === 'object' ? progress : emptyProgress();
  if (!state.plan) return { do: 'plan' };
  const total = Array.isArray(state.plan.grounded) ? state.plan.grounded.length : 0;
  const done = Array.isArray(state.sections) ? state.sections.length : 0;
  if (done < total) return { do: 'section', index: done, total };
  return { do: 'assemble', total };
}

/**
 * Run the generation to completion, saving progress after every step.
 *
 * `save` is called with the whole progress object each time something is
 * finished, and is the only reason this is resumable. `progress` is whatever a
 * previous run left behind, so passing one back in continues it and passing
 * nothing starts fresh.
 */
export async function runChunkedDraft(
  { title, objectives, documents, diagrams = false, pages = true, progress },
  { ask, load, emit, save } = {},
) {
  let state = progress && typeof progress === 'object' && progress.plan
    ? { ...progress }
    : emptyProgress();
  const checkpoint = async () => {
    if (typeof save === 'function') await save(state);
  };

  if (!state.plan) {
    const planned = await planCourse({ title, objectives, documents }, { ask, load, emit });
    // Only the serialisable half. `coursewright` is a module and `modelAsk` is
    // a closure; both are rebuilt below on every run, including a resumed one.
    state = {
      ...emptyProgress(),
      stage: 'sections',
      plan: {
        resolvedTitle: planned.resolvedTitle,
        resolvedObjectives: planned.resolvedObjectives,
        grounded: planned.grounded,
        notCovered: planned.notCovered,
        thinCoverage: planned.thinCoverage,
      },
    };
    await checkpoint();
  }

  const { grounded, resolvedTitle, notCovered, thinCoverage, resolvedObjectives } = state.plan;

  safeEmitLocal(emit, {
    phase: 'sections',
    status: 'start',
    total: grounded.length,
    passages: grounded.reduce((total, entry) => total + (entry?.passages || 0), 0),
  });

  // Replay what a resumed run already reported, so the progress view is the
  // whole generation rather than the part this process happened to do.
  for (const done of state.sections) {
    safeEmitLocal(emit, { phase: 'coursewright', step: 'section', section: done?.title || '' });
  }

  for (;;) {
    const step = nextStep(state);
    if (step.do !== 'section') break;
    const entry = grounded[step.index];
    const last = step.index === grounded.length - 1;
    const written = await writeCourseSection(
      {
        entry,
        resolvedTitle,
        diagrams,
        usedStems: state.usedStems,
        // The course-level artifacts are written once, with the final section.
        apply: last,
      },
      { ask, load, emit },
    );
    state = {
      ...state,
      sections: [...state.sections, written.section],
      usedStems: written.usedStems,
      written: state.written + 1,
      ...(written.apply ? { apply: written.apply } : {}),
    };
    await checkpoint();
  }

  state = { ...state, stage: 'assemble' };
  await checkpoint();

  return assembleCourse(
    { title: resolvedTitle, sections: state.sections, ...(state.apply || {}) },
    { grounded, notCovered, thinCoverage, resolvedObjectives, resolvedTitle, diagrams, pages },
    // assembleCourse only needs a model for the page pass, and the page pass is
    // run separately against the saved record (see draftCourseRecord), so
    // `pages` is false on this path and this is never called.
    { modelAsk: ask, emit },
  );
}

function safeEmitLocal(emit, event) {
  if (typeof emit !== 'function') return;
  try {
    emit(event);
  } catch {
    // A progress listener must never be able to fail a generation.
  }
}
