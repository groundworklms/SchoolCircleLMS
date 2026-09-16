import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const workspace = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

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
      return require(request);
    },
  };
  vm.runInNewContext(transformed.code, sandbox, { filename });
  return module.exports;
}

test('learner progress renders a non-empty mastery record', () => {
  const { LearnerProgress } = loadComponent('app/learn/LearnerFeatures.js', {
    queryData: {
      '/analytics': {
        scope: 'learner',
        gain: { overall: 0.5 },
        gaps: [],
        mastery: [{ verdict: 'PASS', score: 0.9, courseId: 'course-1' }],
      },
    },
  });
  const markup = renderToStaticMarkup(React.createElement(LearnerProgress));
  assert.match(markup, /PASS/);
  assert.match(markup, /course-1/);
});

test('tutor renders citation and chunk content from non-empty source data', () => {
  const { LearnerTutor, SourceViewer } = loadComponent('app/learn/LearnerTutor.js', {
    queryData: {
      '/sources/source-1': {
        title: 'Field manual',
        chunks: [{ text: 'Chunk evidence' }],
      },
    },
    stateValues: [
      [[{
        role: 'assistant',
        text: 'Grounded answer',
        citations: [{ source: 'Field manual', page: 4 }],
      }], () => {}],
      ['', () => {}],
      [true, () => {}],
    ],
  });
  const tutorMarkup = renderToStaticMarkup(React.createElement(LearnerTutor, { sourceId: 'source-1' }));
  const sourceMarkup = renderToStaticMarkup(React.createElement(SourceViewer, { sourceId: 'source-1' }));
  assert.match(tutorMarkup, /Field manual p\. 4/);
  assert.match(sourceMarkup, /Chunk evidence/);
});

test('instructor fidelity renders a non-empty run report', () => {
  const { InstructorFidelity } = loadComponent('app/teach/InstructorFeatures.js', {
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