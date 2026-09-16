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

test('shared instructor shell omits breadcrumbs while retaining course status and navigation', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/InstructorShell.js'), 'utf8');
  assert.doesNotMatch(source, /s-crumb|crumbTail/);
  assert.match(source, /aria-label="Instructor navigation"/);
  // The status the breadcrumb used to carry must survive its removal, and it
  // must use courseHeaderStatus so a pending revision still reads as needing
  // review rather than flattening to Approved/Draft.
  assert.match(source, /<main className="s-main">[\s\S]*courseHeaderStatus\(course\)/);
  // A legacy manual course keeps the school label the breadcrumb showed.
  assert.match(source, /isManual && course\.school/);
});

function loadComponent(relativePath, {
  queryData = {},
  queryStates = {},
  stateValues = [],
  mutationStates = {},
  expose = [],
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
    useEffect() {},
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
      if (request.startsWith('../_course/') || request.startsWith('../../_course/')) {
        const requestedPath = request.endsWith('.js') ? request : `${request}.js`;
        const sharedPath = path.join(path.dirname(relativePath), requestedPath);
        return loadComponent(sharedPath, { queryData, queryStates, stateValues });
      }
      // Sibling components (e.g. LearnerFeatures -> ./SourceViewer) load through
      // the same sandbox so their API hooks are shimmed too.
      if (request.startsWith('./')) {
        const sibling = path.join(path.dirname(relativePath), `${request}.js`);
        return loadComponent(sibling, { queryData, queryStates });
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

test('learning course reader reuses shared lesson blocks without exposing answer keys', () => {
  const { CourseReader } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: {
      '/courses/course-1': {
        status: 'APPROVED',
        version: 1,
        course: {
          sections: [{
            id: 'section-1',
            title: 'Movement fundamentals',
            cite: 'source-1 p. 4',
            lesson: 'Read the approved movement guidance.',
            pre: [{
              id: 'question-1',
              stem: 'Which principle applies?',
              options: ['Use cover', 'Ignore terrain'],
              answer: 0,
              rationale: 'The answer key must stay server-side.',
            }],
          }],
        },
      },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(CourseReader, {
    course: { id: 'course-1' },
  }));
  assert.match(markup, /Movement fundamentals/);
  assert.match(markup, /Read the approved movement guidance/);
  assert.match(markup, /Which principle applies/);
  assert.match(markup, /course-option/);
  assert.match(markup, /source-1 p\. 4/);
  assert.doesNotMatch(markup, /answer key must stay server-side/);
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
    // SignedInCourseChat state order: open, status, msgs, text, busy.
    stateValues: [
      [true, () => {}],
      [{ ready: true }, () => {}],
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
  assert.match(markup, /Grounded · course sources/);
  assert.match(markup, /Field manual · p\.4/);
  assert.match(markup, /TC 3-22\.9 · p\.88/);
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
    // SignedInCourseChat state order: open, status, msgs, text, busy,
    // providerError, selectedCitation.
    stateValues: [
      [true, () => {}],
      [{ ready: true }, () => {}],
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
  assert.match(markup, /Source Document: Second source/);
  assert.doesNotMatch(markup, /Source Document: source-1/);
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

test('library rows carry a three-dots menu, and legacy courses cannot be renamed', () => {
  const { CoursesLibrary } = loadComponent('app/prototype/Library.js', {
    queryData: { '/sources': [] },
  });

  const markup = renderToStaticMarkup(React.createElement(CoursesLibrary, {
    courses: [
      { id: 'gen-1', name: 'Generated course', sections: 3, status: 'APPROVED' },
      { id: 'man-1', name: 'Old manual course', manual: true, status: 'PUBLISHED' },
    ],
    loading: false,
    error: null,
    onOpen: () => {},
    onDrafted: () => {},
  }));

  // The control the instructor was missing entirely.
  assert.match(markup, /row-actions-trigger/, 'no three-dots trigger rendered');
  assert.match(markup, /Actions for course/);

  // A legacy remnant is visible in the library so it can be cleared -- it used
  // to be filtered out here and reachable only from the rail.
  assert.match(markup, /Old manual course/);
  assert.match(markup, /s-legacy-tag/);
  assert.match(markup, /retired manual workflow/);

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
      '/sources': [{ id: 'src-1', title: 'MCRP 3-01A', status: 'APPROVED' }],
      '/sources/src-1': { id: 'src-1', title: 'MCRP 3-01A', pages: [], chunks: [] },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(SourcesView));
  assert.match(markup, /row-actions-trigger/);
  assert.match(markup, /Actions for source/);
});

test('the course hook refreshes the legacy list too, not just generated courses', async () => {
  // Removing a legacy course succeeded on the server while its row stayed on
  // screen, because the manual list was fetched once with no reload path and
  // the shared refetch only covered /courses. That is indistinguishable from
  // the delete not working.
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/learning.js'), 'utf8');

  // The manual list must expose a way to reload.
  assert.match(source, /refetch:\s*\(\)\s*=>\s*setReload/, 'useManualCourses exposes no refetch');
  assert.match(source, /\[enabled,\s*reload\]/, 'the manual effect does not depend on a reload trigger');

  // And the hook's shared refetch must drive it.
  const returned = source.slice(source.indexOf('    manualEnabled,'));
  assert.match(returned, /manual\.refetch/, 'the shared refetch does not refresh the manual list');
});
