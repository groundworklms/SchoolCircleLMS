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

function loadComponent(relativePath, { queryData = {}, queryStates = {}, stateValues = [] } = {}) {
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
    useApiMutation() {
      return { loading: false, mutate: async () => ({}) };
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
  vm.runInNewContext(transformed.code, sandbox, { filename });
  return module.exports;
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

test('course library exposes source failures and disables course drafting', () => {
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
  assert.match(markup, /disabled[^>]*>Draft course/);
  assert.doesNotMatch(markup, /No approved sources yet/);
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
