/* The demo walkthrough, as data.
 *
 * This is the script we present from, so it is kept separate from the overlay
 * that draws it: the copy and the timing are reviewable on their own, and
 * test/walkthrough-steps.test.mjs can assert two things that matter more than
 * any of the prose -- that every step points at an address the router actually
 * serves, and that the whole run fits inside the seven minutes we are given.
 *
 * Every step shows real screens over real records. Nothing here stages a
 * fake result; where the product cannot do something yet, the script does not
 * claim it.
 */

/* Substituted for the demo course's real id at runtime. Course ids are
   LearningRecord ids, so they cannot be written down here. */
export const COURSE_TOKEN = ':course';

/* The hard ceiling we were given. Steps must sum to less than this. */
export const BUDGET_SECONDS = 7 * 60;

export const ACTS = [
  {
    id: 'author',
    label: 'Authoring',
    role: 'instructor',
    blurb: 'An instructor turns publications they already own into a course.',
  },
  {
    id: 'learn',
    label: 'Learning',
    role: 'student',
    blurb: 'A Marine works the course and is judged against the objectives.',
  },
  {
    id: 'tutor',
    label: 'Grounded tutor',
    role: 'student',
    blurb: 'Answers carry citations, and it refuses rather than guessing.',
  },
  {
    id: 'evidence',
    label: 'Evidence',
    role: 'instructor',
    blurb: 'The instructor sees what was learned and what was not.',
  },
];

export const STEPS = [
  /* ---------------------------- Act 1: authoring --------------------------- */
  {
    id: 'library',
    act: 'author',
    location: { role: 'instructor', area: 'library', view: 'courses' },
    target: '[data-tour="instructor-library"]',
    title: 'Everything an instructor teaches, in one place',
    body:
      'Courses carry their own state — published, or still needing review. '
      + 'Nothing is shared until the instructor says so.',
    seconds: 25,
  },
  {
    id: 'sources',
    act: 'author',
    location: { role: 'instructor', area: 'library', view: 'sources' },
    target: '[data-tour="nav-sources"]',
    title: 'It teaches from your publications, not the open internet',
    body:
      'These are real documents this account uploaded — orders, T&R manuals, '
      + 'lesson plans, a POI report. Page counts are read from the files themselves.',
    seconds: 35,
  },
  {
    id: 'rubric',
    act: 'author',
    location: { role: 'instructor', area: 'library', view: 'rubrics' },
    target: '[data-tour="rubric-generator"]',
    title: 'A rubric written from a named publication',
    body:
      'Pick an approved source and the task fields fill from it. The rubric it '
      + 'produces keeps the task code, so it can be checked against the manual it came from.',
    seconds: 45,
  },
  {
    id: 'builder',
    act: 'author',
    location: { role: 'instructor', area: 'course', courseId: COURSE_TOKEN, view: 'builder' },
    target: '[data-tour="course-builder"]',
    title: 'The course, section by section',
    body:
      'Objectives, lessons and checks for understanding, each tied to the '
      + 'section it belongs to. The instructor edits anything before it ships.',
    seconds: 40,
  },
  {
    id: 'fidelity',
    act: 'author',
    location: { role: 'instructor', area: 'course', courseId: COURSE_TOKEN, view: 'fidelity' },
    target: '[data-tour="course-fidelity"]',
    title: 'Every generated page is traceable, and ratified by a human',
    body:
      'This is the part that matters for doctrine: a page shows the passage it '
      + 'was built from, and an instructor ratifies it. Nothing reaches a Marine unreviewed.',
    seconds: 30,
  },

  /* ----------------------------- Act 2: learning --------------------------- */
  {
    id: 'dashboard',
    act: 'learn',
    location: { role: 'student', area: 'dashboard' },
    target: '[data-tour="student-dashboard"]',
    title: 'The learner side of the same account',
    body:
      'Course visibility here is learner-scoped — a draft the instructor has '
      + 'not published is genuinely hidden, not just styled differently.',
    seconds: 20,
  },
  {
    id: 'lessons',
    act: 'learn',
    location: { role: 'student', area: 'course', courseId: COURSE_TOKEN, view: 'lessons' },
    target: '[data-tour="lesson-reader"]',
    title: 'The lesson a Marine actually reads',
    body:
      'Written from the publication, paged for reading on a phone, and carrying '
      + 'the citation with it so a reader can go to the source.',
    seconds: 40,
  },
  {
    id: 'mastery',
    act: 'learn',
    location: { role: 'student', area: 'course', courseId: COURSE_TOKEN, view: 'mastery' },
    target: '[data-tour="mastery-session"]',
    title: 'Judged against the objective, not a multiple-choice key',
    body:
      'The learner answers in their own words and is scored against the rubric '
      + 'dimensions the instructor approved.',
    seconds: 45,
  },

  /* ------------------------------ Act 3: tutor ----------------------------- */
  {
    id: 'ask',
    act: 'tutor',
    location: { role: 'student', area: 'course', courseId: COURSE_TOKEN, view: 'lessons' },
    target: '[data-tour="ask-tutor"]',
    title: 'Ask it something the corpus can answer',
    body:
      'The answer arrives with the publication and paragraph it came from. '
      + 'On the Orin this runs with the network unplugged.',
    seconds: 40,
  },
  {
    id: 'refusal',
    act: 'tutor',
    location: { role: 'student', area: 'course', courseId: COURSE_TOKEN, view: 'lessons' },
    target: '[data-tour="ask-tutor"]',
    title: 'Now ask it something the corpus cannot answer',
    body:
      'It refuses and says why, rather than inventing doctrine. For professional '
      + 'military education a confident wrong answer is the expensive failure.',
    seconds: 30,
  },

  /* ----------------------------- Act 4: evidence --------------------------- */
  {
    id: 'roster',
    act: 'evidence',
    location: { role: 'instructor', area: 'course', courseId: COURSE_TOKEN, view: 'roster' },
    target: '[data-tour="course-roster"]',
    title: 'Who has worked it, and how far they got',
    body: 'Attempts and schedules are evidence, so they survive edits to the course.',
    seconds: 25,
  },
  {
    id: 'aar',
    act: 'evidence',
    location: { role: 'instructor', area: 'course', courseId: COURSE_TOKEN, view: 'aar' },
    target: '[data-tour="course-aar"]',
    title: 'What the section actually failed to learn',
    body:
      'Weak dimensions roll up per objective, so the next period of instruction '
      + 'is aimed at the gap instead of repeating the whole block.',
    seconds: 30,
  },
];

/* ------------------------------- derivations ------------------------------ */

/** Total scripted run time. */
export function budgetSeconds(steps = STEPS) {
  return steps.reduce((total, step) => total + step.seconds, 0);
}

/* Every navigation names every field.
 *
 * `useNav().go` patches over the *current* location, so a partial patch
 * inherits whatever was there before -- jump from a lesson to the library and
 * a stale lessonId rides along, which `href` then resolves to /not-found. The
 * walkthrough always travels between unrelated screens, so it states the whole
 * address every time. */
const EMPTY_LOCATION = {
  role: 'student',
  area: 'dashboard',
  courseId: null,
  view: null,
  lessonId: null,
  page: null,
  threadId: null,
  tab: null,
};

export function fullLocation(partial) {
  return { ...EMPTY_LOCATION, ...partial };
}

/** A step's complete location with the course token replaced. Returns null if a
    step needs a course and none was resolved, so the overlay can say so rather
    than navigating somewhere meaningless. */
export function resolveLocation(step, courseId) {
  const location = fullLocation(step?.location);
  if (location.courseId === COURSE_TOKEN) {
    if (!courseId) return null;
    location.courseId = courseId;
  }
  return location;
}

export function needsCourse(step) {
  return step?.location?.courseId === COURSE_TOKEN;
}

export function actOf(step) {
  return ACTS.find((act) => act.id === step?.act) || null;
}

export function actIndexOf(step) {
  return ACTS.findIndex((act) => act.id === step?.act);
}

/** Seconds elapsed when a step begins, for pacing against the clock. */
export function startOffsetSeconds(index, steps = STEPS) {
  return steps.slice(0, Math.max(0, index)).reduce((total, s) => total + s.seconds, 0);
}

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
