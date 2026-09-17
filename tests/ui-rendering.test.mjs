import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Courses omits the agenda and retired manual library while keeping current course sections', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/StudentShell.js'), 'utf8');
  const courses = source.slice(source.indexOf('function Courses('), source.indexOf('/* ---------- course view'));
  assert.doesNotMatch(courses, /<Agenda|Demo schedule|className="s-two"/);
  for (const section of ['Available courses', 'Demo courses and training (not enrolled)', 'Required training', 'Completed']) {
    assert.ok(courses.includes(section), `preserves ${section}`);
  }
  assert.doesNotMatch(courses, /Published courses|LibraryList/);
  assert.match(courses, /onOpen\(c\.id, 'home'\)/);
  // One, not two: the focused dashboard replaced the old Dashboard, and it
  // reads the same TODO/UPCOMING agenda data through focusedAgendaItems rather
  // than rendering the <Agenda> component. Course home still renders it.
  assert.equal((source.match(/<Agenda /g) || []).length, 1, 'the course-home agenda remains');
});

test('shared instructor shell omits breadcrumbs while retaining course status and navigation', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/InstructorShell.js'), 'utf8');
  assert.doesNotMatch(source, /s-crumb|crumbTail/);
  assert.match(source, /aria-label="Instructor navigation"/);
  // The status the breadcrumb used to carry must survive its removal, and it
  // must use courseHeaderStatus so a pending revision still reads as needing
  // review rather than flattening to Approved/Draft.
  assert.match(source, /<main className="s-main">[\s\S]*courseHeaderStatus\(course\)/);
  assert.doesNotMatch(source, /Legacy|authoring\/courses/i);
  assert.match(source, /id: 'roster'/);
});

test('the student shell drops the breadcrumb but keeps a way up where the rail collapses', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/StudentShell.js'), 'utf8');
  // The rail already carries the course and marks the section, so the row that
  // repeated both is gone -- along with the invented "Last login" it carried.
  assert.doesNotMatch(source, /s-crumbs"|s-crumb-sep|s-crumb-cur|s-lastlogin|Last login/);
  // It is not redundant below 900px: student.css hides the course name and
  // every sub button there, so a course keeps a named way back up.
  assert.match(source, /s-railcontext/);
  const css = fs.readFileSync(path.join(workspace, 'app/prototype/student.css'), 'utf8');
  assert.match(css, /\.s-railcontext \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.s-railcontext \{ display: flex;/);
});

test('the student shell no longer renders the retired published-course library', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/StudentShell.js'), 'utf8');
  assert.doesNotMatch(source, /Published courses|PublishedCourseReader|LibraryList|onOpenPublished|area === 'published'/);
});

test('a fixed side column cannot be widened into a horizontal scrollbar', () => {
  const css = fs.readFileSync(path.join(workspace, 'app/prototype/student.css'), 'utf8');
  // A grid item defaults to min-width: auto, so one unbreakable filename in the
  // 20rem agenda column used to widen the track and scroll the page sideways.
  assert.match(css, /\.s-two > \* \{ min-width: 0; \}/);
  assert.match(css, /\.s-reader > \* \{ min-width: 0; \}/);
  const core = fs.readFileSync(path.join(workspace, 'app/prototype/prototype.css'), 'utf8');
  assert.match(core, /\.p-srcname \{[^}]*overflow-wrap: anywhere/);
});

function loadComponent(relativePath, {
  queryData = {},
  queryStates = {},
  stateValues = [],
  mutationStates = {},
  expose = [],
  effects = null,
} = {}) {
  const filename = path.join(workspace, relativePath);
  const transformed = transformSync(fs.readFileSync(filename, 'utf8'), {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2019',
      transform: { react: { runtime: 'classic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  let stateIndex = 0;
  const reactForModule = {
    ...React,
    useState(initialValue) {
      return stateIndex < stateValues.length
        ? stateValues[stateIndex++]
        : [initialValue, () => {}];
    },
    useRef(initialValue) {
      return { current: initialValue ?? null };
    },
    useEffect(effect) { effects?.push(effect); },
  };
  const useLearning = {
    useApiQuery(requestPath) {
      const configured = queryStates[requestPath] || {};
      const data = Object.prototype.hasOwnProperty.call(configured, 'data')
        ? configured.data
        : queryData[requestPath] ?? null;
      return {
        data,
        loading: configured.loading ?? false,
        error: configured.error ?? null,
        refetch: () => {},
      };
    },
    useApiMutation(requestPath) {
      const configured = mutationStates[requestPath] || {};
      return {
        loading: configured.loading ?? false,
        mutate: configured.mutate || (async () => configured.result ?? {}),
      };
    },
    // Streaming endpoints are keyed the same way; `start` replays the events the
    // fixture supplies and returns the last one, as the real hook does.
    useApiStream(requestPath) {
      const configured = mutationStates[requestPath] || {};
      return {
        loading: configured.loading ?? false,
        start: configured.start || (async (payload, onEvent) => {
          const events = configured.events || [{ phase: 'saved', record: configured.result ?? {} }];
          for (const event of events) onEvent(event);
          return events[events.length - 1];
        }),
      };
    },
  };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    require(request) {
      if (request === 'react') return reactForModule;
      if (request === '../_learning/useLearning') return useLearning;
      if (request === '../_auth/AuthProvider') {
        return { useAuth: () => ({ user: { uid: 'tester' }, ready: true, loading: false }) };
      }
      // Stubbed rather than loaded: the account form owns its own auth and
      // network behaviour, and these tests are about which panels a tab shows.
      if (request === '../_auth/AccountProfile') {
        return {
          __esModule: true,
          default: () => React.createElement('div', null, 'Account profile fields'),
        };
      }
      if (request === '../../lib/auth-fetch') return { authenticatedFetch: async () => ({ ok: false, json: async () => ({}) }) };
      if (request === '../../lib/firebase') {
        return { authFetch: async () => { throw new Error('Static rendering must not make authenticated requests'); } };
      }
      if (request.endsWith('.css')) return {};
      // A shared, framework-free helper that lives in lib/ because a server or
      // export path needs it too -- the provenance line, which the SCORM export
      // prints from the same module these components do. Loaded for real, not
      // stubbed: what it returns is what these tests are asserting about.
      // Resolved against the workspace, since the sandbox's own `require` would
      // resolve '../../lib/...' relative to this test file instead.
      if (request.startsWith('../../lib/')) {
        return require(path.join(workspace, request.replace('../../', '')));
      }
      if (request.startsWith('../_course/') || request.startsWith('../../_course/')) {
        const requestedPath = request.endsWith('.js') ? request : `${request}.js`;
        const sharedPath = path.join(path.dirname(relativePath), requestedPath);
        return loadComponent(sharedPath, { queryData, queryStates, stateValues });
      }
      // Sibling components (e.g. LearnerFeatures -> ./SourceViewer) load through
      // the same sandbox so their API hooks are shimmed too.
      if (request.startsWith('./')) {
        const sibling = path.join(path.dirname(relativePath), `${request}.js`);
        return loadComponent(sibling, { queryData, queryStates, mutationStates });
      }
      return require(request);
    },
  };
  const exposed = expose.map((name) => (
    `module.exports[${JSON.stringify(name)}] = ${name};`
  )).join('\n');
  vm.runInNewContext(`${transformed.code}\n${exposed}`, sandbox, { filename });
  return module.exports;
}

function collectReactElements(node, elements = []) {
  if (node == null || typeof node === 'boolean') return elements;
  if (Array.isArray(node)) {
    node.forEach((child) => collectReactElements(child, elements));
    return elements;
  }
  if (!React.isValidElement(node)) return elements;

  elements.push(node);
  if (typeof node.type === 'function') {
    collectReactElements(node.type(node.props), elements);
  } else {
    collectReactElements(node.props?.children, elements);
  }
  return elements;
}

test('source library groups documents by collection without technical IDs or repeated approval badges', () => {
  const { SourcesView } = loadComponent('app/prototype/Library.js', {
    queryData: { '/sources': [
      { id: 'private-record-id-approved', title: 'Approved field manual', status: 'APPROVED', pages: 4, hasPdf: true, canRemove: true },
      { id: 'private-record-id-pending', title: 'New reference', status: 'PENDING', pages: 2, hasPdf: false, canRemove: true },
      { id: 'private-record-id-lp1', title: 'Lesson 1', status: 'PENDING', pages: 2, hasPdf: true, canRemove: true, collection: 'Lesson plans' },
      { id: 'private-record-id-lp2', title: 'Lesson 2', status: 'APPROVED', pages: 2, hasPdf: true, canRemove: true, collection: 'Lesson plans' },
    ] },
  });
  const markup = renderToStaticMarkup(React.createElement(SourcesView));
  // Named collections come first, the ungrouped shelf last, and each shelf
  // states how many still need a decision.
  assert.match(markup, /aria-label="Lesson plans"[\s\S]*aria-label="Other documents"/);
  assert.match(markup, /Lesson plans<\/h2><span>2 documents · 1 needs approval/);
  assert.match(markup, /Other documents<\/h2><span>2 documents · 1 needs approval/);
  // Approve-all is offered per collection, and only where something is pending.
  assert.equal((markup.match(/Approve all pending \(1\)/g) || []).length, 2);
  assert.match(markup, /Approved field manual/);
  assert.match(markup, /New reference/);
  assert.doesNotMatch(markup, /private-record-id|>APPROVED</);
  // Rename/remove is the shared RowActions menu (#113/#119), not a second
  // per-card affordance, so the row exposes its trigger rather than a
  // free-standing Remove button.
  assert.match(markup, /row-actions-trigger/);
  assert.match(markup, />Preview</);
  assert.match(markup, />Approve</);
});

test('closing a source preview ignores stale PDF metadata without fetching or crashing', () => {
  const effects = [];
  const { SourcePreviewDialog } = loadComponent('app/prototype/SourceLibraryPreview.js', {
    effects,
    queryData: { '/sources/__none__': { id: 'previous-source', title: 'Previous source', hasPdf: true } },
  });
  const markup = renderToStaticMarkup(React.createElement(SourcePreviewDialog, {
    source: null, onClose: () => {}, onRefresh: () => {},
  }));
  assert.equal(markup, '');
  assert.ok(effects.length > 0);
  assert.doesNotThrow(() => effects.forEach((effect) => effect()));
});

test('shared source cards do not offer removal to non-owners', () => {
  const { SourceLibraryCard } = loadComponent('app/prototype/SourceLibraryPreview.js');
  const markup = renderToStaticMarkup(React.createElement(SourceLibraryCard, {
    source: { id: 'shared-source', title: 'Shared manual', status: 'APPROVED', canRemove: false },
    onPreview: () => {}, onRefresh: () => {},
  }));
  assert.match(markup, />Preview</);
  assert.doesNotMatch(markup, /row-actions-trigger|>Approve</);
});

test('learner progress renders a non-empty mastery record', () => {
  // Sextant's real shapes: masteryRollup rows and classGaps rows.
  const { LearnerProgress } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: {
      '/analytics?courseId=course-1': {
        scope: 'learner',
        gain: { overall: { prePct: 0, postPct: 1, gain: 1, normalizedGain: 1 }, objectives: [] },
        gaps: [{ objective: 'trigger control', attempts: 4, cohort: 1, missRate: 0.75 }],
        mastery: [{ competency: 'sight alignment', developing: 0, competent: 1, mastered: 2, n: 3, masteredRate: 0.67 }],
      },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(LearnerProgress, { courseId: 'course-1' }));
  assert.match(markup, /sight alignment/);
  assert.match(markup, /67%/);
  assert.match(markup, /trigger control/);
  assert.match(markup, /75% missed/);
});

/* The learner's reader. A section's `cite` is "<source record id> p.N", and the
   record id is a cuid: the authenticated page-opening key, never a citation a
   person reads. These fixtures use the real shapes -- the course envelope's
   sourceIds and the light approved-source list that names the publication.

   The checks come from a SECOND response, /courses/:id/attempts, which lists
   only the items an instructor has ratified. The draft below deliberately
   carries a second question the ratified set omits, because "a learner never
   sees unreviewed content" is the claim the reader has to keep. */
/* The draft half of this fixture deliberately still carries `lesson`, `pre`
   and `post`. The server no longer sends them to a learner (lib/learning/core.js
   `learnerCourseProjection`, pinned in test/learning-core.test.mjs), and the
   point of leaving them here is that the reader must not render them even if it
   is handed them. The draft prose and the ratified prose are DIFFERENT strings
   for the same reason: an instructor who fixes a lesson with REVISE writes the
   new wording onto the Item row and never touches the draft, so a reader that
   still reads the draft shows the wording that was replaced. */
function learnerReaderFixture(overrides = {}) {
  return {
    '/courses/course-1': {
      status: 'APPROVED',
      version: 1,
      course: {
        sourceIds: ['cmu4xdph30016s6014fn9n9y8'],
        sections: [{
          id: 'section-1',
          title: 'Movement fundamentals',
          cite: 'cmu4xdph30016s6014fn9n9y8 p.135',
          lesson: 'Draft prose no instructor has ratified.',
          pre: [{
            id: 'question-1',
            stem: 'Which principle applies?',
            options: ['Use cover', 'Ignore terrain'],
            answer: 0,
            rationale: 'The answer key must stay server-side.',
          }],
          post: [{
            id: 'question-2',
            stem: 'This question is still awaiting review.',
            options: ['Yes', 'No'],
            answer: 1,
          }],
        }],
      },
    },
    '/courses/course-1/attempts': {
      id: 'course-1',
      releaseId: 'course-1',
      lessons: [{
        sectionIndex: 0,
        sectionTitle: 'Movement fundamentals',
        id: 'course-1:s1:lesson',
        released: true,
        text: 'Read the approved movement guidance.',
        // `pubId` null here on purpose: this release was materialised before
        // the publication label was stamped onto a citation, so the reader has
        // to fall back to the approved-source list to name it. The row that
        // DOES carry one is exercised below.
        citation: { citation: 'cmu4xdph30016s6014fn9n9y8 p.135', pubId: null, page: '135' },
      }],
      items: [{
        id: 'course-1:s1:pre1',
        sectionIndex: 0,
        sectionTitle: 'Movement fundamentals',
        phase: 'pre',
        ordinal: 1,
        stem: 'Which principle applies?',
        options: ['Use cover', 'Ignore terrain'],
      }],
      answers: {},
    },
    '/sources': [{
      id: 'cmu4xdph30016s6014fn9n9y8',
      status: 'APPROVED',
      title: 'AY27_8670_Prerequisite_Coursebook_Instructor-Led_Moodle.pdf',
      sourceId: null,
      pages: 220,
    }],
    ...overrides,
  };
}

/* The learner reader is the authored-lesson player (LessonPlayer) fed by the
   ratified set. The open lesson and page come from the URL, so a test renders
   one screen by passing `lessonId` (the section id) and `page` (1 = overview,
   2 = the first item). */
function renderReader(fixtureOverrides, { lessonId = 'section-1', page = 1 } = {}) {
  const { CourseReader } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: learnerReaderFixture(fixtureOverrides),
  });
  return renderToStaticMarkup(React.createElement(CourseReader, {
    course: { id: 'course-1', name: 'Movement' },
    lessonId,
    page,
    onOpenLesson: () => {},
  }));
}

test('learning course reader reuses shared lesson blocks without exposing answer keys', () => {
  // Page 2 is the ratified pre-check; page 3 is the ratified prose.
  const check = renderReader({}, { page: 2 });
  assert.match(check, /Which principle applies/);
  assert.match(check, /class="p-ans"/);
  assert.doesNotMatch(check, /answer key must stay server-side/);
  const prose = renderReader({}, { page: 3 });
  assert.match(prose, /Movement fundamentals/);
  assert.match(prose, /Read the approved movement guidance/);
  // The prose on screen is the ratified ROW's, not the draft's. These two
  // strings differ, so this fails the moment the reader reads the draft again.
  assert.doesNotMatch(prose, /Draft prose no instructor has ratified/);
  assert.doesNotMatch(check, /Draft prose no instructor has ratified/);
});

test('a learner can actually answer a check in a generated course', () => {
  // Every choice is a live button: the player grades through the attempts
  // route, so nothing is disabled for want of somewhere to send the answer.
  const markup = renderReader({}, { page: 2 });
  assert.doesNotMatch(markup, /class="p-ans"[^>]*disabled/);
  // The check carries the materialised Item id, so the answer is attributable
  // to the exact row an instructor ratified.
  assert.match(markup, /data-item-id="course-1:s1:pre1"/);
});

test('a check a human has not ratified is not rendered at all', () => {
  const markup = renderReader({}, { page: 1 });
  assert.doesNotMatch(markup, /still awaiting review/);
  // The lesson map lists exactly one check: the ratified pre-check.
  assert.equal(markup.match(/s-map-kind">Check/g).length, 1);
});

test('nothing is shown until the ratified set is known', () => {
  // A failed or still-loading ratified set must not fall back to the draft's
  // own content: that is precisely the unreviewed material the gate exists to
  // withhold. The section list (released by course approval) is all there is.
  const markup = renderReader({ '/courses/course-1/attempts': null }, { page: 3 });
  assert.doesNotMatch(markup, /Draft prose no instructor has ratified/);
  assert.doesNotMatch(markup, /s-chk/);
  assert.doesNotMatch(markup, /Which principle applies/);
  assert.match(markup, /Movement fundamentals/);
  assert.match(markup, /Loading what your instructor has released/);
});

test('an answer recorded earlier comes back with its grade and its reason', () => {
  const markup = renderReader({
    '/courses/course-1/attempts': {
      ...learnerReaderFixture()['/courses/course-1/attempts'],
      answers: {
        'course-1:s1:pre1': {
          optionId: '0',
          correct: true,
          feedback: 'Cover is what the source names first.',
        },
      },
    },
  }, { page: 2 });
  assert.match(markup, /Correct — here is why/);
  assert.match(markup, /Cover is what the source names first/);
  // The choice they made is still the marked one after a reload.
  assert.match(markup, /class="p-ans correct"/);
});

test('a learner is cited to a publication and a page, never to a record id', () => {
  const markup = renderReader({}, { page: 1 });
  // The publication, named the way the Sources screen names it: the upload's
  // extension off and its underscores back to spaces.
  assert.match(markup, /Written from and checked against/);
  assert.match(markup, /AY27 8670 Prerequisite Coursebook Instructor-Led Moodle p\.135/);
  assert.doesNotMatch(markup, /cmu4xdph30016s6014fn9n9y8/);
});

test('a section with no nameable publication says nothing rather than showing the key', () => {
  const markup = renderReader({ '/sources': [] }, { page: 1 });
  assert.doesNotMatch(markup, /Written from and checked against/);
  assert.doesNotMatch(markup, /cmu4xdph30016s6014fn9n9y8/);
});

function withheldLesson(overrides = {}) {
  const base = learnerReaderFixture();
  return {
    '/courses/course-1/attempts': {
      ...base['/courses/course-1/attempts'],
      lessons: [{
        sectionIndex: 0,
        sectionTitle: 'Movement fundamentals',
        id: 'course-1:s1:lesson',
        released: false,
        text: '',
        citation: null,
        content: null,
      }],
      ...overrides,
    },
  };
}

test('a lesson a human has not ratified never reaches the page', () => {
  // `released: false` is the whole of what the projection says about a
  // withheld lesson -- it carries no text, no citation and no pages -- and the
  // draft's copy must not stand in.
  const markup = renderReader(withheldLesson(), { page: 3 });
  assert.doesNotMatch(markup, /Read the approved movement guidance/);
  assert.doesNotMatch(markup, /Draft prose no instructor has ratified/);
  // No prose means no provenance line either: a citation with nothing under it
  // vouches for text the learner cannot see.
  assert.doesNotMatch(markup, /Written from and checked against/);
  assert.doesNotMatch(markup, /p\.135/);
});

test('a withheld lesson leaves an explanation, not an unreadable gap', () => {
  // A learner who is shown nothing cannot tell a withheld lesson from a broken
  // page, so the notice names what SchoolCircle did (drafted this from the
  // source) and what it has not (had it approved), and points at the approved
  // checks that are still theirs to answer.
  const markup = renderReader(withheldLesson(), { page: 3 });
  assert.match(markup, /Lesson text not released/);
  assert.match(markup, /instructor has not approved the text/);
  assert.match(markup, /Nothing unreviewed reaches a student/);
  assert.match(markup, /AY27 8670 Prerequisite Coursebook Instructor-Led Moodle/);
  assert.match(markup, /The checks in this lesson were approved separately/);
  // The section keeps its place in the course and its approved check, which
  // is still on the lesson map and answerable on its own screen.
  assert.match(markup, /Lesson 1 of 1/);
  assert.match(markup, /s-map-kind">Check/);
  assert.match(renderReader(withheldLesson(), { page: 2 }), /Which principle applies/);
});

test('a withheld lesson with nothing else approved says so instead of showing an empty lesson', () => {
  const markup = renderReader(withheldLesson({ items: [], answers: {} }), { page: 2 });
  assert.match(markup, /Nothing else in this section has been approved yet/);
});

test('the structured teaching content a learner reads through comes from the ratified row', () => {
  // Pages, diagram and cards ride on the LESSON row (`content`); a release
  // materialised without them reads as the paragraph alone, and the draft's
  // own pages are never consulted.
  const base = learnerReaderFixture();
  const withPages = {
    '/courses/course-1/attempts': {
      ...base['/courses/course-1/attempts'],
      lessons: [{
        ...base['/courses/course-1/attempts'].lessons[0],
        content: {
          intro: 'Why movement matters.',
          pages: [{ title: 'Use of cover', blocks: [{ type: 'callout', kind: 'warn', title: 'Stay low', text: 'Cover before concealment.' }] }],
          flashcards: [{ front: 'Cover', back: 'Stops rounds.' }],
        },
      }],
    },
  };
  const overview = renderReader(withPages, { page: 1 });
  assert.match(overview, /Why movement matters/);
  assert.match(overview, /Use of cover/);
  assert.match(overview, /Flashcards: terms to know cold/);
  const page = renderReader(withPages, { page: 3 });
  assert.match(page, /Stay low/);
  assert.match(page, /Cover before concealment/);
  // Without content the row reads as its paragraph, and the draft's pages
  // (which do not exist in this fixture) cannot appear.
  const bare = renderReader({}, { page: 1 });
  assert.doesNotMatch(bare, /Flashcards/);
  assert.match(bare, /Movement fundamentals/);
});

test('the citation a learner reads comes from the same row as the prose', () => {
  // Materialisation resolves a citation PER ITEM, so the lesson row names the
  // passage the lesson was actually written from. Reading the prose from the
  // row and the citation from the section would put one passage's page number
  // under another passage's words.
  const base = learnerReaderFixture();
  const markup = renderReader({
    '/courses/course-1/attempts': {
      ...base['/courses/course-1/attempts'],
      lessons: [{
        ...base['/courses/course-1/attempts'].lessons[0],
        citation: {
          citation: 'cmu4xdph30016s6014fn9n9y8 p.208',
          pubId: 'TC 3-22.9',
          page: '208',
        },
      }],
    },
  }, { page: 1 });
  // The row's publication and the row's page, not the section `cite`'s p.135
  // and not the publication named by the approved-source list.
  assert.match(markup, /TC 3-22\.9 p\.208/);
  assert.doesNotMatch(markup, /p\.135/);
  assert.doesNotMatch(markup, /AY27 8670 Prerequisite Coursebook Instructor-Led Moodle p\./);
  assert.doesNotMatch(markup, /cmu4xdph30016s6014fn9n9y8/);
});

test('source viewer renders chunk content from non-empty source data', () => {
  const { SourceViewer } = loadComponent('app/prototype/SourceViewer.js', {
    queryData: {
      '/sources/source-1': {
        title: 'Field manual',
        chunks: [{ text: 'Chunk evidence' }],
      },
    },
    stateValues: [[true, () => {}]],
  });
  const sourceMarkup = renderToStaticMarkup(React.createElement(SourceViewer, { sourceId: 'source-1' }));
  assert.match(sourceMarkup, /Chunk evidence/);
});

test('course library exposes source failures while keeping Create course available', () => {
  const { CoursesLibrary } = loadComponent('app/prototype/Library.js', {
    queryStates: {
      '/sources': { error: { error: 'Source service unavailable' } },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(CoursesLibrary, {
    courses: [],
    loading: false,
    error: null,
    onOpen: () => {},
    onDrafted: () => {},
  }));
  assert.match(markup, /Source service unavailable/);
  assert.match(markup, /Retry loading sources/);
  assert.match(markup, /Create course/);
  assert.doesNotMatch(markup, /disabled[^>]*>Create course/);
  assert.doesNotMatch(markup, /No approved sources yet/);
});

test('course creation modal keeps ingestion, explicit approval, and approved-only selection deterministic', async () => {
  const sourceRecords = [
    { id: 'source-pending', title: 'Pending field manual', status: 'PENDING', pages: 3 },
    { id: 'source-approved', title: 'Approved field manual', status: 'APPROVED', pages: 4 },
  ];

  const ingestionCalls = [];
  const ingestionRefreshes = [];
  const {
    IngestSourceModal,
  } = loadComponent('app/prototype/Library.js', {
    expose: ['IngestSourceModal'],
    mutationStates: {
      '/sources': {
        mutate: async (payload) => {
          ingestionCalls.push(payload);
          return { id: 'source-created' };
        },
      },
    },
    stateValues: [
      [true, () => {}],
      ['New source', () => {}],
      ['Source evidence', () => {}],
      ['', () => {}],
      [null, () => {}],
      [null, () => {}],
    ],
  });
  const ingestionElements = collectReactElements(IngestSourceModal({
    onIngested: () => ingestionRefreshes.push(true),
  }));
  const saveTextButton = ingestionElements.find(
    (element) => element.type === 'button' && element.props.children === 'Save text source',
  );
  assert.ok(saveTextButton, 'text ingestion action should be rendered');
  await saveTextButton.props.onClick();
  assert.equal(JSON.stringify(ingestionCalls), JSON.stringify([{ title: 'New source', text: 'Source evidence' }]));
  assert.equal(ingestionRefreshes.length, 1);

  const approvalCalls = [];
  const approvalRefreshes = [];
  const { SourceCard } = loadComponent('app/prototype/Library.js', {
    expose: ['SourceCard'],
    queryData: {
      '/sources/source-pending': {
        title: 'Pending field manual',
        pages: [{ page: 1, text: 'Pending evidence' }],
      },
    },
    mutationStates: {
      '/sources/source-pending/approve': {
        mutate: async () => {
          approvalCalls.push(true);
          return { id: 'source-pending', status: 'APPROVED' };
        },
      },
    },
    stateValues: [[null, () => {}]],
  });
  const approvalElements = collectReactElements(SourceCard({
    source: sourceRecords[0],
    onApproved: () => approvalRefreshes.push(true),
  }));
  const approveSourceButton = approvalElements.find(
    (element) => element.type === 'button' && element.props.children === 'Approve source',
  );
  assert.ok(approveSourceButton, 'pending sources must require an explicit approval action');
  await approveSourceButton.props.onClick();
  assert.equal(approvalCalls.length, 1);
  assert.equal(approvalRefreshes.length, 1);

  const generationCalls = [];
  const drafted = [];
  const { DraftCourseModal } = loadComponent('app/prototype/Library.js', {
    expose: ['DraftCourseModal'],
    mutationStates: {
      // Generation streams its progress; the modal reads the stream and takes
      // the course from the terminal `saved` event.
      '/courses/draft/stream': {
        start: async (payload, onEvent) => {
          generationCalls.push(payload);
          const saved = { phase: 'saved', record: { id: 'course-created', status: 'PENDING' } };
          onEvent({ phase: 'accepted' });
          onEvent(saved);
          return saved;
        },
      },
    },
    stateValues: [
      [true, () => {}],
      ['Generated course', () => {}],
      ['Objective one\nObjective two', () => {}],
      [['source-pending', 'source-approved'], () => {}],
      [null, () => {}],
      [null, () => {}],
      [null, () => {}],
    ],
  });
  const courseElements = collectReactElements(DraftCourseModal({
    sources: sourceRecords,
    sourcesLoading: false,
    sourcesError: null,
    onRetrySources: () => {},
    onDrafted: (course) => drafted.push(course),
  }));
  const sourceCheckboxes = courseElements.filter(
    (element) => element.type === 'input' && element.props.type === 'checkbox',
  );
  assert.equal(sourceCheckboxes.length, 1, 'pending sources must not be selectable');
  assert.equal(sourceCheckboxes[0].props.value, 'source-approved');
  assert.equal(sourceCheckboxes[0].props.checked, true);

  const generateButton = courseElements.find(
    (element) => element.type === 'button' && element.props.children === 'Generate course',
  );
  assert.ok(generateButton, 'course generation action should be rendered');
  await generateButton.props.onClick();
  assert.equal(JSON.stringify(generationCalls), JSON.stringify([{
    title: 'Generated course',
    objectives: ['Objective one', 'Objective two'],
    sourceIds: ['source-approved'],
    diagrams: false,
  }]));
  assert.equal(drafted[0].id, 'course-created');
});

test('course creation modal renders pending review and only approved source controls', () => {
  const { CoursesLibrary } = loadComponent('app/prototype/Library.js', {
    queryData: {
      '/sources': [
        { id: 'source-pending', title: 'Pending field manual', status: 'PENDING', pages: 3 },
        { id: 'source-approved', title: 'Approved field manual', status: 'APPROVED', pages: 4 },
      ],
      '/sources/source-pending': {
        title: 'Pending field manual',
        pages: [{ page: 1, text: 'Pending evidence' }],
      },
    },
    stateValues: [
      [true, () => {}],
      ['Course title', () => {}],
      ['', () => {}],
      [['source-approved'], () => {}],
      [null, () => {}],
      [true, () => {}],
      ['New source', () => {}],
      ['Source evidence', () => {}],
      ['', () => {}],
      [null, () => {}],
      [null, () => {}],
    ],
  });
  const markup = renderToStaticMarkup(React.createElement(CoursesLibrary, {
    courses: [],
    loading: false,
    error: null,
    onOpen: () => {},
    onDrafted: () => {},
  }));
  assert.match(markup, /aria-label="Create course"/);
  assert.match(markup, /Upload a PDF/);
  assert.match(markup, /Save text source/);
  assert.match(markup, /Pending field manual · Review and approve source/);
  assert.match(markup, /Approve source/);
  assert.match(markup, /value="source-approved"/);
  assert.doesNotMatch(markup, /value="source-pending"/);
  assert.match(markup, /Generate course/);
});

function readinessMarkup({
  version = 3,
  candidate = { sourceIds: ['source-approved'], sections: [{ id: 'section-1' }] },
  pending = true,
  published = false,
  busy = false,
  unavailable = false,
  stateValues = [],
} = {}) {
  const { CourseReadiness } = loadComponent('app/prototype/CourseReadiness.js', { stateValues });
  return renderToStaticMarkup(React.createElement(CourseReadiness, {
    courseId: 'course-1',
    version,
    candidate,
    pending,
    published,
    busy,
    unavailable,
    onApprove: () => {},
  }));
}

test('course readiness separates server publishing checks from optional QA tools', () => {
  const markup = readinessMarkup();
  assert.match(markup, /Required by the server/);
  assert.match(markup, /exact reviewed version must still be current/);
  assert.match(markup, /Persisted source relationships must exist/);
  assert.match(markup, /content, answer-key, citation and grounding validation/);
  assert.match(markup, /Optional QA and learning tools:/);
  assert.match(markup, /None is a course publishing requirement/);
  assert.match(markup, /<input[^>]*type="checkbox"/);
  assert.doesNotMatch(markup, /<input[^>]*type="checkbox"[^>]*disabled/);
  assert.match(markup, /<button[^>]*disabled[^>]*>Approve and publish/);
});

test('course readiness disables acknowledgement and approval for missing content, busy, and unavailable states', () => {
  const candidate = { sourceIds: ['source-approved'], sections: [{ id: 'section-1' }] };
  const cases = [
    {
      name: 'missing generated content',
      candidate: { sourceIds: ['source-approved'], sections: [] },
    },
    { name: 'approval busy', busy: true, candidate },
    { name: 'draft unavailable after an error', unavailable: true, candidate },
  ];

  for (const scenario of cases) {
    const markup = readinessMarkup(scenario);
    if (scenario.busy || scenario.unavailable || !scenario.candidate.sections.length) {
      assert.match(markup, /<input[^>]*type="checkbox"[^>]*disabled/, scenario.name);
    }
    assert.match(markup, /<button[^>]*disabled[^>]*>(Approve and publish|Saving…)/, scenario.name);
  }
});

test('course readiness acknowledgement is tied to the exact course version and candidate', () => {
  const candidate = { sourceIds: ['source-approved'], sections: [{ id: 'section-1' }] };
  const currentReviewKey = JSON.stringify(['course-1', 3, candidate]);
  const priorVersionKey = JSON.stringify(['course-1', 2, candidate]);

  const reviewedMarkup = readinessMarkup({
    candidate,
    stateValues: [[currentReviewKey, () => {}]],
  });
  assert.match(reviewedMarkup, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.match(reviewedMarkup, /<button[^>]*>Approve and publish/);
  assert.doesNotMatch(reviewedMarkup, /<button[^>]*disabled[^>]*>Approve and publish/);

  const staleMarkup = readinessMarkup({
    candidate,
    stateValues: [[priorVersionKey, () => {}]],
  });
  assert.doesNotMatch(staleMarkup, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.match(staleMarkup, /<button[^>]*disabled[^>]*>Approve and publish/);
});

test('shared generated course presentation keeps manual question typography and preview feedback', () => {
  const { default: CourseLesson } = loadComponent('app/_course/CoursePresentation.js');
  const markup = renderToStaticMarkup(React.createElement(CourseLesson, {
    preview: true,
    content: {
      id: 'lesson-1',
      title: 'Generated lesson',
      summary: 'A cited summary.',
      blocks: [{
        id: 'question-1',
        type: 'check',
        prompt: 'Which answer is grounded?',
        options: [
          { id: 'option-a', text: 'The approved answer' },
          { id: 'option-b', text: 'An unsupported claim' },
        ],
        correctOptionId: 'option-a',
        explanation: 'The first answer is supported by the source.',
      }],
    },
  }));
  assert.match(markup, /Generated lesson/);
  assert.match(markup, /Which answer is grounded/);
  assert.match(markup, /The approved answer/);
  assert.match(markup, /course-option/);
  assert.doesNotMatch(markup, /correctOptionId/);
});

test('AI course draft previews every generated section with targeted revision controls', () => {
  const { CourseDraft } = loadComponent('app/prototype/Library.js', {
    queryData: {
      '/courses/course-1': {
        id: 'course-1',
        status: 'PENDING',
        version: 2,
        hasPendingRevision: false,
        course: {
          title: 'Field movement',
          sourceIds: ['source-1'],
          sections: [{
            id: 'section-1',
            title: 'Movement fundamentals',
            lesson: 'Use the approved movement principles.',
            pre: [{
              id: 'question-pre-1',
              stem: 'Which principle is grounded?',
              options: ['Use cover', 'Ignore terrain'],
              answer: 0,
              explanation: 'Cover is named by the source.',
            }],
            post: [{
              id: 'question-post-1',
              stem: 'What should the learner choose?',
              options: ['Use cover', 'Ignore terrain'],
              answer: 0,
            }],
          }],
        },
        revisionHistory: [],
      },
      '/sources': [],
    },
  });
  const markup = renderToStaticMarkup(React.createElement(CourseDraft, {
    course: { id: 'course-1', name: 'Field movement', status: 'PENDING', sourceIds: ['source-1'] },
    onChanged: () => {},
  }));
  assert.match(markup, /Generated course preview/);
  assert.match(markup, /Movement fundamentals/);
  assert.match(markup, /Which principle is grounded/);
  assert.match(markup, /Revise whole lesson/);
  assert.match(markup, /Question review/);
  // CourseReadiness heads the acknowledgement gate and still carries main's
  // approve action, so both strings have to be present.
  assert.match(markup, /Review and publish/);
  assert.match(markup, /Approve and publish/);
});

test('rubric generation distinguishes source failures from a successful empty source list', () => {
  const { RubricsView } = loadComponent('app/prototype/InstructorFeatures.js', {
    queryStates: {
      '/sources': { error: { message: 'Source service unavailable' } },
    },
  });
  const failedMarkup = renderToStaticMarkup(React.createElement(RubricsView));
  assert.match(failedMarkup, /Source service unavailable/);
  assert.match(failedMarkup, /Retry loading sources/);
  assert.match(failedMarkup, /disabled[^>]*>Generate rubric/);

  const { RubricsView: EmptyRubricsView } = loadComponent('app/prototype/InstructorFeatures.js', {
    queryStates: {
      '/sources': { data: [] },
    },
  });
  const emptyMarkup = renderToStaticMarkup(React.createElement(EmptyRubricsView));
  assert.match(emptyMarkup, /No approved sources/);
  assert.doesNotMatch(emptyMarkup, /Retry loading sources/);
});

// RubricsView state order: sourceId, taskCode, taskTitle, taskCondition,
// taskStandard, taskSteps, err, approved, generatedRubricId.
function reviewedRubricMarkup(rubric, { status = 'PENDING', traceability, validation } = {}) {
  const { RubricsView } = loadComponent('app/prototype/InstructorFeatures.js', {
    queryData: {
      '/sources': [{ id: 'source-1', title: 'MCWP 2-10', status: 'APPROVED' }],
      '/rubrics': [],
      '/rubrics/rubric-1': {
        id: 'rubric-1',
        status,
        validation: validation ?? { valid: true, issues: [] },
        traceability: traceability ?? { grounded: true, coverage: 1, ungrounded: [] },
        rubric,
      },
    },
    stateValues: [
      ['source-1', () => {}],
      ['SC-CONDUCT-MARINE-AIR-01', () => {}],
      ['Conduct MAGTF Intelligence Operations', () => {}],
      ['', () => {}],
      ['', () => {}],
      ['', () => {}],
      [null, () => {}],
      [false, () => {}],
      ['rubric-1', () => {}],
    ],
  });
  return renderToStaticMarkup(React.createElement(RubricsView));
}

test('a flagged rubric reads as the SME referral it is, never as its payload', () => {
  const markup = reviewedRubricMarkup({
    flagged: true,
    reason: 'The standard does not define how an evaluator judges intelligence as timely.',
    needsSME: 'Define observable evidence for acceptable accuracy and mission relevance.',
    task: { code: 'SC-CONDUCT-MARINE-AIR-01', title: 'Conduct MAGTF Intelligence Operations' },
  });
  assert.match(markup, /Flagged for a subject-matter expert/);
  assert.match(markup, /The standard does not define how an evaluator judges intelligence as timely/);
  assert.match(markup, /What an SME must define/);
  assert.match(markup, /Define observable evidence for acceptable accuracy and mission relevance/);
  assert.match(markup, /SC-CONDUCT-MARINE-AIR-01/);
  // The payload's own key names are the tell that a JSON dump leaked through.
  assert.doesNotMatch(markup, /needsSME|flagged&quot;|<pre/);

  // approveRubric refuses `flagged` server-side and the payload has no
  // dimensions, so the button is gone entirely rather than disabled: a
  // disabled Approve implies something here could unlock it.
  assert.doesNotMatch(markup, /Approve rubric/);
  // What replaces it has to be an action that exists — the Standard field of
  // the form on this same page.
  assert.match(markup, /rewrite the standard so it says/);
  assert.match(markup, /<button[^>]*>Rewrite the standard<\/button>/);
  // verifyTraceability saw no dimensions, so its 100% is the empty case.
  assert.match(markup, /Nothing to trace yet/);
  assert.doesNotMatch(markup, /100% coverage/);
});

test('a generated BARS rubric renders its dimensions and three anchors', () => {
  const markup = reviewedRubricMarkup({
    flagged: false,
    dimensions: [{
      name: 'Collection tasking',
      source: 'issues collection requirements to subordinate units',
      anchors: {
        unsatisfactory: 'Issues no requirement to any subordinate unit.',
        satisfactory: 'Issues a written requirement to every named unit.',
        proficient: 'Issues and reprioritises requirements as the situation changes.',
      },
    }],
    notes: ['Two of the six phases carry no measurable wording.'],
    task: { code: 'SC-CONDUCT-MARINE-AIR-01', title: 'Conduct MAGTF Intelligence Operations' },
  });
  assert.match(markup, /Collection tasking/);
  assert.match(markup, /<th>Unsatisfactory<\/th>/);
  assert.match(markup, /<th>Satisfactory<\/th>/);
  assert.match(markup, /<th>Proficient<\/th>/);
  assert.match(markup, /Issues no requirement to any subordinate unit/);
  assert.match(markup, /Issues a written requirement to every named unit/);
  assert.match(markup, /Issues and reprioritises requirements as the situation changes/);
  // The verbatim phrase verifyTraceability checked has to sit beside the anchors.
  assert.match(markup, /issues collection requirements to subordinate units/);
  assert.match(markup, /Two of the six phases carry no measurable wording/);
  assert.doesNotMatch(markup, /<pre|anchors&quot;/);
  // Nothing about a rubric that was written should read as flagged.
  assert.doesNotMatch(markup, /Flagged for a subject-matter expert|Rewrite the standard/);
  assert.match(markup, /100% coverage/);
  // A rubric with dimensions is approvable, so Approve must survive here —
  // removing it from the flagged path must not remove it from both.
  assert.match(markup, /<button[^>]*>Approve rubric<\/button>/);
  assert.doesNotMatch(markup, /disabled[^>]*>Approve rubric/);
});

test('a filled form field hands the wheel back to the page once its own scroll is spent', () => {
  const { wheelFallthrough } = loadComponent('app/prototype/InstructorFeatures.js', {
    expose: ['wheelFallthrough'],
  });
  const scroller = { scrollTop: 0 };
  // A textarea showing 4 of 12 lines, scrolled to its own bottom.
  const field = { scrollTop: 160, clientHeight: 80, scrollHeight: 240 };
  const wheelEvent = (delta, extra = {}) => {
    const event = { deltaY: delta, deltaMode: 0, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    return event;
  };

  const spent = wheelEvent(120);
  wheelFallthrough(field, () => scroller)(spent);
  assert.equal(spent.prevented, true, 'the page must take the gesture the field cannot use');
  assert.equal(scroller.scrollTop, 120);

  // Scrolling back up is still the field's own -- its scrolling is untouched.
  const ownScroll = wheelEvent(-120);
  wheelFallthrough(field, () => scroller)(ownScroll);
  assert.equal(ownScroll.prevented, false);
  assert.equal(scroller.scrollTop, 120);

  // Line-mode deltas (Firefox) reach the page as pixels, not as 3.
  const lines = wheelEvent(3, { deltaMode: 1 });
  wheelFallthrough(field, () => scroller)(lines);
  assert.equal(scroller.scrollTop, 168);

  // Ctrl+wheel is zoom, and a field with nowhere to hand the gesture is inert.
  const zoom = wheelEvent(120, { ctrlKey: true });
  wheelFallthrough(field, () => scroller)(zoom);
  assert.equal(zoom.prevented, false);
  const orphan = wheelEvent(120);
  wheelFallthrough(field, () => null)(orphan);
  assert.equal(orphan.prevented, false);
});

test('course chat renders Sourcerer and Anchor citations in one shape', () => {
  const { normaliseCitation } = loadComponent('app/prototype/CourseChat.js');
  const sourcerer = normaliseCitation({ label: 'Aiming', source: 'Field manual', page: 4 }, 0);
  const anchor = normaliseCitation({ n: 2, citation: 'TC 3-22.9 §7', pub_id: 'TC 3-22.9', page_printed: 88 }, 1);
  // JSON compare: the sandbox has its own Object prototype.
  assert.equal(JSON.stringify(sourcerer), JSON.stringify({ n: 1, citation: 'Aiming', pub_id: 'Field manual', page: 4 }));
  assert.equal(JSON.stringify(anchor), JSON.stringify({ n: 2, citation: 'TC 3-22.9 §7', pub_id: 'TC 3-22.9', page: 88 }));

  const { default: CourseChat } = loadComponent('app/prototype/CourseChat.js', {
    queryData: {
      '/courses/course-1': { id: 'course-1', course: { sourceIds: ['source-1'] } },
    },
    // SignedInCourseChat state order: open, msgs, text, busy.
    stateValues: [
      [true, () => {}],
      [[
        { role: 'user', text: 'What is sight alignment?' },
        { role: 'assistant', answer: 'Grounded answer [1] [2]', citations: [sourcerer, anchor] },
      ], () => {}],
      ['', () => {}],
      [false, () => {}],
    ],
  });
  const course = { id: 'course-1', name: 'Rifle Marksmanship', record: { id: 'course-1' } };
  const markup = renderToStaticMarkup(React.createElement(CourseChat, { course }));
  assert.match(markup, /Course sources selected/);
  // One provenance line for every surface: publication, then page (provenanceOf).
  assert.match(markup, /Field manual p\.4/);
  assert.match(markup, /TC 3-22\.9 p\.88/);
});

/* The grounded tutor's own citation shape.
 *
 * The server stamps `n` -- the inline marker the answer carries -- and `pubId`,
 * the publication it resolved from the approved source record; the passage
 * `source` is the locator "<source record id> p.N", and that record id is a
 * cuid: the authenticated page-opening key, never a citation a learner reads.
 * The two defects this pins are a marker in the prose with no chip of that
 * number to follow, and a chip that printed the key. */
test('course chat labels each citation with its own marker and names the publication', () => {
  const PUBLICATION = 'AY27 8670 Prerequisite Coursebook Instructor-Led Moodle';
  const RECORD = 'cmu4xdph30016s6014fn9n9y8';
  const { normaliseCitation } = loadComponent('app/prototype/CourseChat.js');
  // As lib/learning/core.js `courseCitations` delivers them: the answer marked
  // [1] and [4], so those are the numbers, not 1 and 2.
  const cited = [
    { n: 1, id: `${RECORD}:chunk:18`, text: 'Military goals serve the political outcome.', source: `${RECORD} p.19`, sourceId: RECORD, pubId: PUBLICATION },
    { n: 4, id: `${RECORD}:chunk:16`, text: 'Strategy translates that outcome into military aims.', source: `${RECORD} p.17`, sourceId: RECORD, pubId: PUBLICATION },
  ].map(normaliseCitation);
  // A passage cited in three sentences is still one citation, cited twice here.
  const answer = 'Military goals serve the political outcome. [1][4] Strategy translates that outcome. [1]';

  const { default: CourseChat } = loadComponent('app/prototype/CourseChat.js', {
    queryData: { '/courses/course-1': { id: 'course-1', course: { sourceIds: [RECORD] } } },
    // SignedInCourseChat state order: open, msgs, text, busy.
    stateValues: [
      [true, () => {}],
      [[{ role: 'assistant', answer, citations: cited }], () => {}],
      ['', () => {}],
      [false, () => {}],
    ],
  });
  const markup = renderToStaticMarkup(React.createElement(CourseChat, {
    course: { id: 'course-1', name: 'Joint Operations', record: { id: 'course-1' } },
  }));

  // Every marker the prose carries is a chip, and every chip is a marker.
  const markers = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const chips = [...markup.matchAll(/<b>\[(\d+)\]<\/b>/g)].map((match) => Number(match[1]));
  assert.deepEqual(chips, [1, 4]);
  assert.deepEqual(new Set(chips), new Set(markers));

  // The chip reads like the lesson line above it, and the page comes off the
  // locator rather than being dropped.
  assert.ok(markup.includes(`<b>[1]</b> ${PUBLICATION} p.19`), markup);
  assert.ok(markup.includes(`<b>[4]</b> ${PUBLICATION} p.17`), markup);
  // The locator is still there, exactly, one hover away -- and nowhere else.
  assert.ok(markup.includes(`title="${RECORD} p.19"`), markup);
  assert.equal(markup.replace(/title="[^"]*"/g, '').includes(RECORD), false);
});

test('course chat citation locators select the matching approved source record', () => {
  const {
    normaliseCitation,
    resolveCitationSourceId,
  } = loadComponent('app/prototype/CourseChat.js');
  const first = normaliseCitation({ source: 'source-1 p.1', page: 1 }, 0);
  const second = normaliseCitation({ source: 'source-2 p.2', page: 2 }, 1);
  const { default: CourseChat } = loadComponent('app/prototype/CourseChat.js', {
    queryData: {
      '/courses/course-1': { id: 'course-1', course: { sourceIds: ['source-1', 'source-2'] } },
      '/sources/source-2': {
        title: 'Second source',
        pages: [{ page: 2, text: 'Second source passage' }],
      },
    },
    // SignedInCourseChat state order: open, msgs, text, busy,
    // providerError, selectedCitation.
    stateValues: [
      [true, () => {}],
      [[
        { role: 'assistant', answer: 'See [1] and [2].', citations: [
          first,
          second,
        ] },
      ], () => {}],
      ['', () => {}],
      [false, () => {}],
      [null, () => {}],
      [second, () => {}],
    ],
  });
  assert.equal(resolveCitationSourceId(second, ['source-1', 'source-2']), 'source-2');
  assert.equal(resolveCitationSourceId({ source: 'source-10 p.2' }, ['source-1', 'source-10']), 'source-10');
  assert.equal(resolveCitationSourceId({ source: 'source-10 p.2' }, ['source-1', 'source-10-extra']), null);

  const markup = renderToStaticMarkup(React.createElement(CourseChat, {
    course: { id: 'course-1', name: 'Two-source course', record: { id: 'course-1' } },
  }));
  // The source panel names the document it resolved to. Its heading is the
  // section label and the publication title is the line under it, so the pair
  // is what identifies the record on screen.
  assert.match(markup, /<h3>Source document<\/h3><p[^>]*>Second source</);
  assert.doesNotMatch(markup, /<h3>Source document<\/h3><p[^>]*>source-1</);
});

test('instructor fidelity renders a non-empty run report', () => {
  const { InstructorFidelity } = loadComponent('app/prototype/InstructorFeatures.js', {
    queryData: {
      '/fidelity?courseId=course-1': {
        status: 'complete',
        report: { fidelity: 1, strict: true },
        runs: [{ verdict: 'pass', grounding: 'grounded', score: 1 }],
      },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(InstructorFidelity, { courseId: 'course-1' }));
  assert.match(markup, /pass/);
  assert.match(markup, /grounded/);
});

test('citation selection opens the persisted page and passage in the source viewer', () => {
  const { SourceViewer } = loadComponent('app/prototype/SourceViewer.js', {
    queryData: {
      '/sources/source-1': {
        title: 'Field manual',
        pages: [
          { page: 1, text: 'Introduction' },
          { page: 2, text: 'Exact passage for the citation.' },
        ],
      },
    },
    stateValues: [[true, () => {}]],
  });
  const markup = renderToStaticMarkup(React.createElement(SourceViewer, {
    sourceId: 'source-1',
    citation: { source: 'source-1 p.2', passage: 'Exact passage' },
  }));
  assert.match(markup, /Page 2/);
  assert.match(markup, /Exact passage/);
  assert.match(markup, /data-citation-target="true"/);
});

test('shared mastery plan displays object indicators and its approved locked state', () => {
  const { InstructorMasteryPlan } = loadComponent('app/prototype/InstructorFeatures.js');
  const markup = renderToStaticMarkup(React.createElement(InstructorMasteryPlan, {
    courseId: 'course-1',
    course: {
      sourceIds: ['source-1'],
      masteryPlan: {
        status: 'APPROVED',
        sourceId: 'source-1',
        revision: 'revision-2',
        criteria: [{
          elo: 'Explain timing',
          indicators: {
            developing: 'Names a possible interval',
            competent: 'Names the correct interval',
            mastered: 'Explains the correct interval in context',
          },
        }],
      },
    },
  }));
  assert.match(markup, /APPROVED/);
  assert.match(markup, /Explain timing/);
  assert.match(markup, /Competent:/);
  assert.match(markup, /Names the correct interval/);
  assert.match(markup, /approved and locked/);
  assert.doesNotMatch(markup, /Approve plan/);
  assert.doesNotMatch(markup, /Generate plan/);
});

test('shared mastery plan shows pending object indicators with an approval action', () => {
  const { InstructorMasteryPlan } = loadComponent('app/prototype/InstructorFeatures.js');
  const markup = renderToStaticMarkup(React.createElement(InstructorMasteryPlan, {
    courseId: 'course-1',
    course: {
      sourceIds: ['source-1'],
      masteryPlan: {
        status: 'PENDING',
        sourceId: 'source-1',
        revision: 'revision-1',
        criteria: [{
          elo: 'Inspect the area',
          indicators: {
            developing: 'Checks some hazards',
            competent: 'Checks all hazards',
            mastered: 'Checks and records hazards consistently',
          },
        }],
      },
    },
  }));
  assert.match(markup, /PENDING/);
  assert.match(markup, /Inspect the area/);
  assert.match(markup, /Competent:/);
  assert.match(markup, /Checks all hazards/);
  assert.match(markup, /Approve plan/);
  assert.doesNotMatch(markup, /Generate plan/);
  // A criterion with no provenance is one no rubric ratified -- every plan
  // written before provenance existed is that -- and it must say so rather
  // than render as an unlabelled criterion an instructor reads as approved.
  assert.match(markup, /data-provenance="DERIVED"/);
  assert.match(markup, /Written by the model\. Not taken from a rubric you approved\./);
});

/* Provenance is the point of the rubric-to-plan connection: a human's approval
 * is being honoured downstream, and it buys nothing if the screen that asks for
 * the next approval cannot say whose words these are. */
function masteryPlanMarkup(criteria, status = 'PENDING') {
  const { InstructorMasteryPlan } = loadComponent('app/prototype/InstructorFeatures.js');
  return renderToStaticMarkup(React.createElement(InstructorMasteryPlan, {
    courseId: 'course-1',
    course: {
      sourceIds: ['source-1'],
      masteryPlan: { status, sourceId: 'source-1', revision: 'revision-3', criteria },
    },
  }));
}

const RATIFIED_CRITERION = {
  elo: 'Confirms the weapon is clear before handling',
  indicators: {
    developing: 'Handles the weapon before it is confirmed clear',
    competent: 'Confirms the weapon is clear before handling it',
    mastered: 'Confirms the weapon is clear and announces it',
  },
  provenance: {
    origin: 'RATIFIED',
    rubricId: 'rubric-clearing',
    objective: 'Clear and handle the weapon safely',
    dimension: 'Confirms the weapon is clear before handling',
    sourcePhrase: 'confirms the weapon is clear before handling it',
  },
};

const DERIVED_CRITERION = {
  elo: 'Keeps the belt flat while feeding',
  indicators: {
    developing: 'Feeds with a twisted belt',
    competent: 'Keeps the belt flat',
    mastered: 'Keeps the belt flat and free of twists',
  },
  provenance: { origin: 'DERIVED' },
};

test('a ratified criterion names the approval it came from, and the trail back to it', () => {
  const markup = masteryPlanMarkup([RATIFIED_CRITERION, { ...RATIFIED_CRITERION, elo: 'Announces a misfire' }]);
  assert.match(markup, /data-provenance="RATIFIED"/);
  // Traceable without a second lookup: the rubric record, the objective it
  // judges, the dimension, and the phrase traceability matched in the standard.
  assert.match(markup, /Taken from the rubric you approved \(rubric-clearing\)/);
  assert.match(markup, /Clear and handle the weapon safely/);
  assert.match(markup, /dimension .Confirms the weapon is clear before handling./);
  assert.match(markup, /Traced to the standard at .confirms the weapon is clear before handling it./);
  assert.match(markup, /Approved rubrics used: rubric-clearing/);
  // Fully ratified, and allowed to say so plainly.
  assert.match(markup, /data-provenance="RATIFIED"[\s\S]*All 2 criteria came from rubrics you approved\./);
  assert.match(markup, /the model wrote none of them/);
  assert.doesNotMatch(markup, /Written by the model/);
});

test('a mixed plan leads with what is not ratified and never reads as fully approved', () => {
  const markup = masteryPlanMarkup([RATIFIED_CRITERION, DERIVED_CRITERION]);
  assert.match(markup, /data-testid="mastery-plan-provenance" data-provenance="MIXED"/);
  assert.match(
    markup,
    /Of the 2 criteria here, 1 was written by the model and did not come from an approved rubric\. The other 1 came from a rubric you approved\./,
  );
  // The consequence of the button below it, said before it is pressed.
  assert.match(markup, /Approving this plan makes all 2 the grading contract for this course\./);
  // The claim a MIXED plan must never make.
  assert.doesNotMatch(markup, /All 2 criteria came from rubrics you approved/);
  assert.match(markup, /data-provenance="RATIFIED"/);
  assert.match(markup, /data-provenance="DERIVED"/);
  assert.match(markup, /Written by the model\. Not taken from a rubric you approved\./);
});

test('a wholly derived plan says so, and claims no approved rubric it does not have', () => {
  const markup = masteryPlanMarkup([DERIVED_CRITERION, { ...DERIVED_CRITERION, elo: 'Clears a stoppage' }]);
  assert.match(markup, /data-provenance="DERIVED"/);
  assert.match(markup, /No criterion here came from an approved rubric\. The model wrote all 2 from the approved source\./);
  assert.doesNotMatch(markup, /Approved rubrics used/);
  assert.doesNotMatch(markup, /Taken from the rubric you approved/);
});

test('an approved plan states its provenance without offering an approval it already has', () => {
  const markup = masteryPlanMarkup([RATIFIED_CRITERION, DERIVED_CRITERION], 'APPROVED');
  // The summary survives approval -- it is what the locked contract is made of.
  assert.match(markup, /Of the 2 criteria here, 1 was written by the model/);
  // But the sentence about what approving would do is gone; it already did.
  assert.doesNotMatch(markup, /Approving this plan makes/);
  assert.match(markup, /approved and locked/);
});

test('cohort mastery distinguishes total learners from competency contributors', () => {
  const { default: Mastery } = loadComponent('app/prototype/Mastery.js', {
    queryData: {
      '/analytics/cohort?courseId=course-1': {
        mastery: {
          status: 'insufficient_evidence',
          reason: 'Each mastery competency requires at least 5 distinct contributors.',
          minimumContributors: 5,
          observedContributors: 2,
        },
        privacy: { cohortSuppressedBelow: 5, observedLearners: 5, learnerIdsReturned: false },
      },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(Mastery, {
    course: { id: 'course-1', record: { id: 'course-1' } },
  }));
  assert.match(markup, /Learners observed[\s\S]*p-tileval">5</);
  assert.match(markup, /Contributors: 2 of 5\./);
  assert.doesNotMatch(markup, /Cohort evidence: 2/);
});

test('learner mastery session renders a saved completed result after reload', () => {
  const { MasterySession } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: {
      '/courses/course-1': { course: { sourceIds: ['source-1'] } },
      '/mastery/sessions?courseId=course-1': [{
        id: 'session-1',
        status: 'COMPLETE',
        report: { complete: true, score: 1 },
        criteria: [
          { elo: 'Name the check', verdict: 'mastered' },
          { elo: 'Explain timing', verdict: 'competent' },
        ],
        transcript: [
          { role: 'assistant', text: 'How do you perform the check?' },
          { role: 'user', text: 'I inspect the area first.' },
        ],
      }],
    },
  });
  const markup = renderToStaticMarkup(React.createElement(MasterySession, {
    course: { id: 'course-1' },
  }));
  assert.match(markup, /Completed sessions/);
  assert.match(markup, /100%/);
  assert.match(markup, /Name the check: mastered/);
  assert.match(markup, /Explain timing: competent/);
});

test('prototype mastery selection keeps a refreshed requested session ahead of legacy evidence', () => {
  const { selectMasterySession } = loadComponent('app/prototype/LearnerFeatures.js');
  const legacyActive = { id: 'legacy', status: 'ACTIVE' };
  const currentComplete = {
    id: 'current',
    status: 'COMPLETE',
    masteryPlanRevision: 'revision-4',
  };
  assert.equal(
    selectMasterySession([legacyActive, currentComplete], {
      status: 'APPROVED',
      revision: 'revision-4',
    }).id,
    'current',
  );
  assert.equal(
    selectMasterySession([legacyActive], {
      status: 'APPROVED',
      revision: 'revision-4',
    }).id,
    'legacy',
  );
  // A just-created id is absent from the stale list, so the production
  // selector must not silently substitute the old ACTIVE record. Once the
  // awaited refresh contains it, the same selector selects the requested
  // record.
  assert.equal(
    selectMasterySession([legacyActive], {
      status: 'APPROVED',
      revision: 'revision-4',
    }, 'current'),
    null,
  );
  assert.equal(
    selectMasterySession([legacyActive, currentComplete], {
      status: 'APPROVED',
      revision: 'revision-4',
    }, 'current').id,
    'current',
  );

  // Guard the component-level ordering that prevents the stale-list race:
  // the returned session id is applied only after the API list is refreshed.
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/LearnerFeatures.js'), 'utf8');
  const start = source.indexOf('const handleStart = async () =>');
  const finish = source.indexOf('const handleTurn = async () =>', start);
  const startBlock = source.slice(start, finish);
  assert.ok(startBlock.indexOf('await refetch();') < startBlock.indexOf('setSelectedId(result.id);'));
  assert.match(startBlock, /setPendingSessionId\(result\.id\)/);
});

test('settings renders one destination whose tabs show only their own section', () => {
  const { InstructorSettings } = loadComponent('app/prototype/Settings.js');

  const render = (props) => renderToStaticMarkup(
    React.createElement(InstructorSettings, {
      account: { name: 'SSgt Tester', email: 'tester@example.mil' },
      authenticated: true,
      onTab: () => {},
      ...props,
    }),
  );

  // All three tabs are offered from one place, which is the point of the merge.
  const account = render({ tab: 'account', course: null });
  for (const label of ['Account', 'App', 'Course']) {
    assert.match(account, new RegExp(`>${label}<`), `missing tab ${label}`);
  }

  // Each tab shows its own panels and not the others'.
  assert.match(account, /Account profile/);
  assert.doesNotMatch(account, /What students see/);
  assert.doesNotMatch(account, /Generation model/);

  const app = render({ tab: 'app', course: null });
  assert.match(app, /Generation/);
  assert.doesNotMatch(app, /What students see/);

  // Course settings with no course selected must say so rather than invent one.
  // This page previously received a fabricated "Instructor account" course and
  // titled itself "Course settings" for something that was not a course.
  const noCourse = render({ tab: 'course', course: null });
  assert.match(noCourse, /Open a course from the library/);
  assert.doesNotMatch(noCourse, /Instructor account\s*·/);
  assert.doesNotMatch(noCourse, /Show class standing/);

  // With a real course, the course-only panels appear and name it.
  const withCourse = render({ tab: 'course', course: { id: 'c-1', name: 'Marksmanship' } });
  assert.match(withCourse, /Marksmanship/);
  assert.match(withCourse, /Show class standing/);
  assert.match(withCourse, /apply to/);

  // A course-scoped visit pins the Course tab regardless of the requested tab.
  const scoped = render({ tab: 'account', course: { id: 'c-1', name: 'Marksmanship' }, courseScoped: true });
  assert.match(scoped, /Show class standing/);
  assert.doesNotMatch(scoped, /Account profile/);
});

test('student settings splits account from app without losing a panel', () => {
  const { StudentSettings } = loadComponent('app/prototype/Settings.js');
  const render = (tab) => renderToStaticMarkup(
    React.createElement(StudentSettings, {
      account: { name: 'Cpl Tester', email: 'cpl@example.mil' },
      authenticated: false,
      onSignOut: () => {},
      onTab: () => {},
      tab,
    }),
  );

  const account = render('account');
  assert.match(account, />Account</);
  assert.match(account, />App</);
  assert.doesNotMatch(account, /Reminders/);

  const app = render('app');
  // Every panel that existed before the split still has a home.
  for (const heading of ['learning style', 'Reminders', 'Display']) {
    assert.match(app, new RegExp(heading), `App tab lost ${heading}`);
  }
});

test('library rows carry generated-course actions without legacy rows or endpoints', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/Library.js'), 'utf8');
  const { CoursesLibrary } = loadComponent('app/prototype/Library.js', {
    queryData: { '/sources': [] },
  });

  const markup = renderToStaticMarkup(React.createElement(CoursesLibrary, {
    courses: [
      { id: 'gen-1', name: 'Generated course', sections: 3, status: 'APPROVED' },
    ],
    loading: false,
    error: null,
    onOpen: () => {},
    onDrafted: () => {},
  }));

  // The control the instructor was missing entirely.
  assert.match(markup, /row-actions-trigger/, 'no three-dots trigger rendered');
  assert.match(markup, /Actions for course/);

  assert.match(markup, /Generated course/);
  assert.match(source, /endpoint=\{`\/api\/learning\/courses\/\$\{c\.id\}`\}/);
  assert.doesNotMatch(markup, /manual|legacy|authoring\/courses/i);

  // The row's open affordance must be a SIBLING of the menu, not its parent:
  // a button inside a button is invalid HTML and the inner click would bubble
  // into opening the course. Walk the tags rather than pattern-matching, since
  // a regex cannot tell nesting from sequence.
  //
  // Lookahead rather than \b: a literal backspace byte replaced that escape
  // once already, which made match() return null and this check pass while
  // testing nothing. The count assertion below makes that failure loud.
  const buttonTags = markup.match(/<\/?button(?=[\s>])/g) || [];
  assert.ok(buttonTags.length >= 4, `expected button tags, found ${buttonTags.length}`);
  let depth = 0;
  for (const tag of buttonTags) {
    depth += tag === '<button' ? 1 : -1;
    assert.ok(depth <= 1, 'a button is nested inside another button');
  }
  assert.equal(depth, 0, 'unbalanced button tags');
});

test('a source card exposes rename and remove', () => {
  const { SourcesView } = loadComponent('app/prototype/Library.js', {
    queryData: {
      // canRemove is what /sources reports for a source this instructor owns.
      // An approved source owned by someone else comes back with canRemove
      // false and gets no menu, because every write behind it is owner-only.
      '/sources': [{ id: 'src-1', title: 'MCRP 3-01A', status: 'APPROVED', canRemove: true }],
      '/sources/src-1': { id: 'src-1', title: 'MCRP 3-01A', pages: [], chunks: [], canRemove: true },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(SourcesView));
  assert.match(markup, /row-actions-trigger/);
  assert.match(markup, /Actions for source/);
});

test('the course hook is generated-only and keeps list refresh and roster navigation', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/learning.js'), 'utf8');
  const shell = fs.readFileSync(path.join(workspace, 'app/prototype/InstructorShell.js'), 'utf8');

  assert.match(source, /useApiQuery\('\/courses', \{ enabled \}\)/);
  assert.match(source, /refetch,/);
  assert.match(source, /refetchGenerated: refetch/);
  assert.doesNotMatch(source, /authoring\/courses|includeManual|manualCourses|manualLoading|manualError/i);
  assert.match(shell, /id: 'roster', label: 'Roster'/);
  assert.match(shell, /SCREENS\[view\]/);
  assert.doesNotMatch(shell, /authoring\/courses|includeManual|manualCourses|manualLoading|manualError|isManual/i);
});

test('a section the server dropped leaves the progress list and joins what is not covered', () => {
  // The refusal's reason is the most useful thing on this screen: it is the
  // difference between "pick a source that covers this" and "the source covers
  // it, the generator would not teach it from that page". Losing it -- or
  // leaving the dropped section in the list beside sections that were saved --
  // is how an instructor ends up not knowing the course is incomplete.
  const { generationView, GenerationProgress } = loadComponent('app/prototype/GenerationProgress.js');
  const reason = 'the passage identifies CI/HUMINT reporting categories but its counterintelligence discussion is incomplete';
  const restated = 'restates "Identify the six intelligence functions", which this course already teaches';
  const events = [
    { phase: 'sections', total: 3, passages: 4 },
    // A fourth way an objective leaves a course: it said what an earlier one
    // already said. It used to fail the entire generation; now it joins the
    // same list as everything else the course does not cover.
    { phase: 'outline', step: 'restated', section: 'List the six intelligence functions', reason: restated },
    { phase: 'coursewright', step: 'skipped', section: 'Explain collection management', reason: 'no approved passage covers this objective' },
    { phase: 'coursewright', step: 'section', section: 'Identify the six intelligence functions' },
    { phase: 'coursewright', kind: 'lesson', ok: true, section: 'Identify the six intelligence functions' },
    { phase: 'coursewright', step: 'section', section: 'Explain how counterintelligence supports the MAGTF commander' },
    { phase: 'coursewright', kind: 'lesson', ok: false, section: 'Explain how counterintelligence supports the MAGTF commander', reason },
    { phase: 'coursewright', step: 'dropped', section: 'Explain how counterintelligence supports the MAGTF commander', reason },
    { phase: 'coursewright', step: 'done' },
    { phase: 'saved', record: { id: 'course-1', sections: 1 } },
  ];

  // The view is built inside the component's vm realm, so compare its shape
  // rather than its prototypes.
  const view = JSON.parse(JSON.stringify(generationView(events)));
  assert.deepEqual(view.sections.map((section) => section.title), ['Identify the six intelligence functions']);
  assert.deepEqual(view.skipped, [
    { objective: 'List the six intelligence functions', reason: restated },
    { objective: 'Explain collection management', reason: 'no approved passage covers this objective' },
    { objective: 'Explain how counterintelligence supports the MAGTF commander', reason },
  ]);
  assert.equal(view.failure, null);

  const markup = renderToStaticMarkup(React.createElement(GenerationProgress, { events }));
  assert.match(markup, /Not covered by this course/);
  assert.match(markup, /counterintelligence discussion is incomplete/);
  assert.match(markup, /no approved passage covers this objective/);
  // Written, so the instructor is not told a saved course failed.
  assert.doesNotMatch(markup, /s-shell-error/);
});

test('a pending draft still says what it does not cover, after the modal is gone', () => {
  const { CourseDraft } = loadComponent('app/prototype/Library.js', {
    queryData: {
      '/courses/course-1': {
        status: 'PENDING',
        version: 0,
        course: {
          title: 'MAGTF intelligence',
          sourceIds: ['source-1'],
          sections: [{ id: 'section-1', title: 'Identify the six intelligence functions', cite: 'source-1 p.3', lesson: 'The six intelligence functions are planning and direction, collection, processing, production, dissemination, and utilization.' }],
          skippedObjectives: [{
            objective: 'Explain how counterintelligence supports the MAGTF commander',
            reason: 'its counterintelligence discussion is incomplete',
          }],
        },
      },
      '/sources': [],
    },
  });
  const markup = renderToStaticMarkup(React.createElement(CourseDraft, { course: { id: 'course-1' } }));
  assert.match(markup, /Not covered by this course/);
  assert.match(markup, /counterintelligence supports the MAGTF commander/);
  assert.match(markup, /its counterintelligence discussion is incomplete/);
});

test('a topic the outline scoped out reads differently from one the sources could not ground', () => {
  // Three stages feed one list, and the whole point of merging them is that the
  // instructor can still tell them apart: "the source covers this, the course
  // does not" is answered by narrowing the request, "no passage covers this" by
  // choosing a different source, and a generator refusal by neither.
  const { generationView, GenerationProgress } = loadComponent('app/prototype/GenerationProgress.js');
  const refusal = 'its counterintelligence discussion is incomplete';
  const events = [
    { phase: 'sources', documents: 108, characters: 260000 },
    {
      phase: 'outline',
      status: 'done',
      objectives: ['Identify the six intelligence functions'],
      notCovered: [{ objective: 'Signals intelligence support', reason: "in the sources, but outside this course's scope" }],
      thinCoverage: true,
    },
    { phase: 'sections', total: 2, passages: 2 },
    { phase: 'coursewright', step: 'skipped', section: 'Explain collection management', reason: 'no approved passage covers this objective' },
    { phase: 'coursewright', step: 'dropped', section: 'Explain how counterintelligence supports the MAGTF commander', reason: refusal },
  ];

  const view = JSON.parse(JSON.stringify(generationView(events)));
  // The outline's gaps come first, because that is the stage they happened at.
  assert.deepEqual(view.skipped, [
    { objective: 'Signals intelligence support', reason: "in the sources, but outside this course's scope" },
    { objective: 'Explain collection management', reason: 'no approved passage covers this objective' },
    { objective: 'Explain how counterintelligence supports the MAGTF commander', reason: refusal },
  ]);
  assert.equal(view.thinCoverage, true);

  const markup = renderToStaticMarkup(React.createElement(GenerationProgress, { events }));
  assert.match(markup, /Not covered by this course/);
  assert.match(markup, /outside this course&#x27;s scope/);
  assert.match(markup, /no approved passage covers this objective/);
  assert.match(markup, /counterintelligence discussion is incomplete/);
  // The heading must not blame the sources for a topic they carry.
  assert.doesNotMatch(markup, /Not covered by the selected sources/);
});

test('the narrow-it prompt names the objectives box, and only when coverage is thin', () => {
  const { GenerationProgress } = loadComponent('app/prototype/GenerationProgress.js');
  const thin = [
    { phase: 'sources', documents: 108, characters: 260000 },
    {
      phase: 'outline',
      status: 'done',
      objectives: ['Identify the six intelligence functions'],
      notCovered: [{ objective: 'Signals intelligence support', reason: "in the sources, but outside this course's scope" }],
      thinCoverage: true,
    },
  ];
  const thinMarkup = renderToStaticMarkup(React.createElement(GenerationProgress, { events: thin }));
  assert.match(thinMarkup, /covers part of the selected sources/);
  // It has to point at a control that exists, or it is only bad news.
  assert.match(thinMarkup, /objectives box above/);

  // A normal course reaches its whole source. Nothing to suggest, and a prompt
  // that fires here would be the kind of warning instructors learn to ignore.
  const whole = [
    { phase: 'sources', documents: 4, characters: 9000 },
    { phase: 'outline', status: 'done', objectives: ['Identify the six intelligence functions'] },
    { phase: 'sections', total: 1, passages: 1 },
  ];
  const wholeMarkup = renderToStaticMarkup(React.createElement(GenerationProgress, { events: whole }));
  assert.doesNotMatch(wholeMarkup, /covers part of the selected sources/);

  // Nor does a course that lost an objective to retrieval: that is a source
  // problem, and typing objectives would not fix it.
  const skipped = [
    ...whole,
    { phase: 'coursewright', step: 'skipped', section: 'Explain collection management', reason: 'no approved passage covers this objective' },
  ];
  const skippedMarkup = renderToStaticMarkup(React.createElement(GenerationProgress, { events: skipped }));
  assert.match(skippedMarkup, /Not covered by this course/);
  assert.doesNotMatch(skippedMarkup, /covers part of the selected sources/);
});

test('a thin draft still points at the objectives box after the modal is gone', () => {
  const draftPayload = (extra) => ({
    '/courses/course-1': {
      status: 'PENDING',
      version: 0,
      course: {
        title: 'MAGTF intelligence',
        sourceIds: ['source-1'],
        sections: [{ id: 'section-1', title: 'Identify the six intelligence functions', cite: 'source-1 p.3', lesson: 'The six intelligence functions are planning and direction, collection, processing, production, dissemination, and utilization.' }],
        skippedObjectives: [{
          objective: 'Signals intelligence support',
          reason: "in the sources, but outside this course's scope",
        }],
        ...extra,
      },
    },
    '/sources': [],
  });

  const { CourseDraft: ThinDraft } = loadComponent('app/prototype/Library.js', {
    queryData: draftPayload({ thinCoverage: true }),
  });
  const thinMarkup = renderToStaticMarkup(React.createElement(ThinDraft, { course: { id: 'course-1' } }));
  assert.match(thinMarkup, /covers part of the selected sources/);
  // The modal is closed by now, so the box is named rather than pointed at.
  assert.match(thinMarkup, /Create course modal/);

  // The same draft without the flag names its gap and says nothing else.
  const { CourseDraft: WholeDraft } = loadComponent('app/prototype/Library.js', {
    queryData: draftPayload({}),
  });
  const wholeMarkup = renderToStaticMarkup(React.createElement(WholeDraft, { course: { id: 'course-1' } }));
  assert.match(wholeMarkup, /Signals intelligence support/);
  assert.doesNotMatch(wholeMarkup, /covers part of the selected sources/);
});

test('the item review provenance line names the publication, not the row it is stored under', () => {
  // The citation is stored as the locator the rest of the system addresses
  // passages by -- "<source record id> p.23" -- and that record id is a cuid.
  // Printing it here showed the one human being asked to vouch for an item's
  // provenance a primary key, and printed the page twice on the way: once off
  // the end of the locator and once out of the page field beside it.
  const { Evidence } = loadComponent('app/prototype/ItemReview.js', { expose: ['Evidence'] });
  const citation = {
    citation: 'cmu4nugk2000qs601lnoxtuj7 p.23',
    pubId: 'MCWP 2-10',
    page: '23',
  };
  const markup = renderToStaticMarkup(
    React.createElement(Evidence, { item: { citation, support: null } }),
  );
  // The rendered text, not the title attribute the locator is kept on.
  const shown = markup.replace(/ title="[^"]*"/g, '');
  assert.match(shown, /Grounded in MCWP 2-10 p\.23/);
  assert.doesNotMatch(shown, /cmu4nugk2000qs601lnoxtuj7/);
  assert.doesNotMatch(shown, /p\.23[\s\S]*p\.23/);
  // The exact locator on record stays reachable; it is what the source viewer
  // and the SCORM export address the passage by.
  assert.match(markup, /title="cmu4nugk2000qs601lnoxtuj7 p\.23"/);

  // Nothing measures HHEM support on a generated item, so "not verified" is a
  // true statement about this row and must keep being made.
  assert.match(markup, /not verified/);
  const scored = renderToStaticMarkup(
    React.createElement(Evidence, { item: { citation, support: 0.94 } }),
  );
  assert.match(scored, /support 0\.94/);

  // A row with no publication name falls back to the locator -- still with the
  // page printed once -- rather than to nothing.
  const bare = renderToStaticMarkup(
    React.createElement(Evidence, { item: { citation: { citation: 'source-1 p.4', page: '4' } } }),
  );
  assert.match(bare, /Grounded in source-1 p\.4/);
  assert.doesNotMatch(bare.replace(/ title="[^"]*"/g, ''), /p\.4[\s\S]*p\.4/);
});

test('the generated-course preview states the answer key it asks an instructor to ratify', () => {
  // The preview renders the choices as buttons a learner picks from: nothing
  // marks the key, and clicking one grades that click rather than revealing it.
  // Under a banner promising "Answer keys are instructor-only", the instructor
  // was being asked to approve a key they could only find by guessing.
  const { CourseDraft } = loadComponent('app/prototype/Library.js', {
    queryData: {
      '/courses/course-1': {
        status: 'PENDING',
        version: 0,
        course: {
          title: 'MAGTF intelligence',
          sourceIds: ['source-1'],
          sections: [{
            id: 'section-1',
            title: 'Dissemination methods',
            cite: 'source-1 p.23',
            lesson: 'Supply-push sends intelligence to the units that need it without a request.',
            pre: [{
              stem: 'Which statement defines the supply-push method of intelligence dissemination?',
              options: ['The unit requests a product', 'Intelligence is sent without a request'],
              answer: 1,
              rationale: 'Supply-push anticipates the requirement rather than waiting for it.',
            }],
          }],
        },
      },
      '/sources': [],
    },
  });
  const markup = renderToStaticMarkup(React.createElement(CourseDraft, { course: { id: 'course-1' } }));
  assert.match(markup, /Keyed answer/);
  assert.match(markup, /2\. Intelligence is sent without a request/);
  // The rationale is the evidence for the key, so it travels with it.
  assert.match(markup, /Supply-push anticipates the requirement/);
});

test('a lost stream offers waiting as the primary action and regenerating as the quiet one', async () => {
  // The notice says, correctly, that generating again is what produces two
  // copies of the course. Next to it the crimson primary said "Try again".
  // Copy loses that argument every time: the button is the instruction.
  const generationCalls = [];
  const refreshes = [];
  const { DraftCourseModal } = loadComponent('app/prototype/Library.js', {
    expose: ['DraftCourseModal'],
    mutationStates: {
      '/courses/draft/stream': {
        start: async (payload) => {
          generationCalls.push(payload);
          return null;
        },
      },
    },
    stateValues: [
      [true, () => {}],            // open
      ['', () => {}],              // title
      ['', () => {}],              // objectives
      [['source-approved'], () => {}], // sourceIds
      [null, () => {}],            // err
      [[{ phase: 'accepted' }], () => {}], // events: the stream did report
      [true, () => {}],            // lostStream: and then ended without an outcome
    ],
  });
  const elements = collectReactElements(DraftCourseModal({
    sources: [{ id: 'source-approved', title: 'Approved source', status: 'APPROVED' }],
    sourcesLoading: false,
    sourcesError: null,
    onRetrySources: () => {},
    onDrafted: () => refreshes.push(true),
  }));
  const buttons = elements.filter((element) => element.type === 'button');
  const primary = buttons.filter((element) => element.props.className === 'p-btn');
  assert.equal(primary.length, 1, 'exactly one primary action in this state');
  // The primary is the action the paragraph asks for: wait, and go look.
  assert.match(String(primary[0].props.children), /course list/);

  // Regenerating is still available -- the instructor may have a reason -- but
  // at ghost weight and named for what it really does.
  const regenerate = buttons.find(
    (element) => element.props.className === 'p-btn ghost'
      && /second copy/.test(String(element.props.children)),
  );
  assert.ok(regenerate, 'regenerating stays reachable, as a secondary action');

  // And the honest copy the buttons now agree with is still on screen.
  const notice = elements.find(
    (element) => element.props?.role === 'alert'
      && /ended before generation reported an outcome/.test(
        JSON.stringify(element.props.children),
      ),
  );
  assert.ok(notice, 'the lost-stream explanation must not be replaced by the buttons');

  // Pressing the primary refreshes the library rather than generating again.
  await primary[0].props.onClick();
  assert.deepEqual(generationCalls, []);
  assert.equal(refreshes.length, 1);
});

test('a generation whose stream ended without an outcome says so instead of nothing', () => {
  // draftCourseStream ends with 'saved' or 'failed'. When the response body
  // ends before either -- a proxy idle timeout on a long course -- the server
  // keeps generating and saves minutes later. Saying nothing is what makes an
  // instructor conclude it failed and generate a second copy of the course.
  const { GenerationProgress } = loadComponent('app/prototype/GenerationProgress.js');
  const events = [
    { phase: 'accepted' },
    { phase: 'sections', total: 19, passages: 26 },
    { phase: 'coursewright', step: 'section', section: 'Dissemination methods' },
    { phase: 'coursewright', kind: 'lesson', ok: true, section: 'Dissemination methods' },
  ];
  const lost = renderToStaticMarkup(
    React.createElement(GenerationProgress, { events, interrupted: true }),
  );
  assert.match(lost, /role="alert"/);
  assert.match(lost, /ended before generation reported an outcome/);
  // It has to name the action that makes it worse, because that is the action
  // the silence was prompting.
  assert.match(lost, /two copies/);

  // A generation still in flight looks exactly the same in the events, so the
  // notice must never be inferred from a missing terminal phase.
  const running = renderToStaticMarkup(React.createElement(GenerationProgress, { events }));
  assert.doesNotMatch(running, /ended before generation reported an outcome/);

  // Nor after an outcome did arrive, in either direction.
  const saved = renderToStaticMarkup(React.createElement(GenerationProgress, {
    events: [...events, { phase: 'saved', record: { id: 'course-1' } }],
    interrupted: true,
  }));
  assert.doesNotMatch(saved, /ended before generation reported an outcome/);
  const failed = renderToStaticMarkup(React.createElement(GenerationProgress, {
    events: [...events, { phase: 'failed', error: 'Course generation failed' }],
    interrupted: true,
  }));
  assert.doesNotMatch(failed, /ended before generation reported an outcome/);
  assert.match(failed, /Course generation failed/);
});

/* The doctrine engine status light.

   This panel used to paint green from `active.ready`, which only ever meant
   "DOCTRINE_BASE_URL is set". The deployed endpoint was dead for two days and
   the panel stayed green throughout. It is the one control an operator checks
   before walking on stage, so these pin the colour to the PROBE and nothing
   else -- a probe that failed must render red, and must never render as
   connected however healthy the configuration looks.

   `stateValues` are consumed in hook order: settings, loading, loadError,
   health, checking, baseUrl, manual, detected, busy, err, saved. */
function doctrinePanel({ health, checking = false }) {
  const { DoctrineSettings } = loadComponent('app/prototype/DoctrineSettings.js', {
    stateValues: [
      [{
        configured: false,
        baseUrl: '',
        version: null,
        envBaseUrl: 'http://192.168.55.1:8000',
        active: { ready: true, source: 'env', baseUrl: 'http://192.168.55.1:8000' },
      }, () => {}],
      [false, () => {}],          // loading
      [null, () => {}],           // loadError
      [health, () => {}],
      [checking, () => {}],
    ],
  });
  return renderToStaticMarkup(React.createElement(DoctrineSettings));
}

test('a configured but dead doctrine engine renders red, never connected', () => {
  const markup = doctrinePanel({
    health: {
      state: 'unreachable',
      headline: 'Not answering',
      baseUrl: 'http://192.168.55.1:8000',
      problems: ['fetch failed: ECONNREFUSED'],
    },
  });
  assert.match(markup, /Not answering/);
  assert.match(markup, /ECONNREFUSED/);
  assert.match(markup, /class="doctrine-status bad"/);
  // The two ways this could regress: the old word, and the green class.
  assert.doesNotMatch(markup, /Connected/);
  assert.doesNotMatch(markup, /class="doctrine-status ok"/);
  // The address is still on screen -- a dead engine is not an unknown one.
  assert.match(markup, /http:\/\/192\.168\.55\.1:8000/);
});

test('green says what it means: answering, loaded, and serving the routes', () => {
  const markup = doctrinePanel({
    health: {
      state: 'healthy',
      headline: 'Answering',
      baseUrl: 'http://192.168.55.1:8000',
      problems: [],
      corpus: {
        publications: [{ pubId: 'MCDP 1', chunks: 241 }, { pubId: 'TC 3-22.9', chunks: 627 }],
        totalChunks: 4731,
      },
      endpoints: { ask: true, verify: true, ground: true },
      uptimeS: 29236.2,
    },
  });
  assert.match(markup, /class="doctrine-status ok"/);
  assert.match(markup, /Answering/);
  // Pointed at a loaded board rather than an empty one, and how to tell.
  assert.match(markup, /4,731 passages/);
  assert.match(markup, /2 publications/);
  assert.match(markup, /\/api\/ask/);
  assert.match(markup, /\/api\/verify/);
  assert.match(markup, /up 8h 7m/);
});

test('a degraded engine is amber with the reason, not green and not red', () => {
  const markup = doctrinePanel({
    health: {
      state: 'degraded',
      headline: 'Answering, but degraded',
      baseUrl: 'http://192.168.55.1:8000',
      problems: ['The reranker model is not loaded.', '/api/verify is missing — no measured support scores.'],
      endpoints: { ask: true, verify: false, ground: true },
    },
  });
  assert.match(markup, /class="doctrine-status warn"/);
  assert.match(markup, /reranker model is not loaded/);
  assert.match(markup, /missing \/api\/verify/);
  assert.doesNotMatch(markup, /class="doctrine-status ok"/);
});

test('a check still in flight is neutral — not yet known must not look like fine', () => {
  const markup = doctrinePanel({ health: null, checking: true });
  assert.match(markup, /Checking…/);
  assert.match(markup, /class="doctrine-status "/);
  assert.doesNotMatch(markup, /class="doctrine-status ok"/);
});

test('only a healthy probe can reach the green class at all', () => {
  const source = fs.readFileSync(
    path.join(workspace, 'app/prototype/DoctrineSettings.js'), 'utf8',
  );
  // The green class comes from one lookup table keyed by probe state, so there
  // is exactly one place this can go wrong -- and `healthy` is the only key
  // that maps to it.
  assert.match(source, /STATE_CLASS = \{\s*healthy: 'ok',/);
  assert.doesNotMatch(source, /(degraded|unreachable|unconfigured): 'ok'/);
  // The configuration read must never be what colours the dot again.
  assert.doesNotMatch(source, /doctrine-status\$\{active/);
});

test('an unreachable engine reads as routine and names the way back', () => {
  // The board moves between laptops and a restarted tunnel takes a new
  // hostname, so a stale address is the ORDINARY demo-day state. Red must
  // therefore explain and point at the recovery, not just condemn.
  const markup = doctrinePanel({
    health: {
      state: 'unreachable',
      headline: 'Not answering',
      baseUrl: 'http://192.168.55.1:8000',
      problems: ['fetch failed (ECONNREFUSED)'],
    },
  });
  assert.match(markup, /Find the Orin/);
  assert.match(markup, /Enter an address manually/);
  assert.match(markup, /new hostname every time it restarts/);
  // Calm, not a crash: it is a status line, never an alert.
  assert.doesNotMatch(markup, /role="alert"/);
});

test('a healthy engine does not nag about addresses it does not need', () => {
  const markup = doctrinePanel({
    health: {
      state: 'healthy',
      headline: 'Answering',
      baseUrl: 'http://192.168.55.1:8000',
      problems: [],
      corpus: { publications: [{ pubId: 'MCDP 1', chunks: 241 }], totalChunks: 241 },
      endpoints: { ask: true, verify: true, ground: true },
    },
  });
  assert.doesNotMatch(markup, /new hostname every time it restarts/);
});
