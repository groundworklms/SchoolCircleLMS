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

function loadComponent(relativePath, { queryData = {}, stateValues = [] } = {}) {
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
      return { data: queryData[requestPath] ?? null, loading: false, error: null, refetch: () => {} };
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
      if (request === '../../lib/auth-fetch') return { authenticatedFetch: async () => ({ ok: false, json: async () => ({}) }) };
      // Sibling components (e.g. LearnerFeatures -> ./SourceViewer) load through
      // the same sandbox so their API hooks are shimmed too.
      if (request.startsWith('./')) {
        const sibling = path.join(path.dirname(relativePath), `${request}.js`);
        return loadComponent(sibling, { queryData });
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
