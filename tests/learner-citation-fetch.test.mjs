import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* Pins Finding A: naming the publication a lesson cites must cost one label,
 * not the whole source library. `usePublicationName` (now `publicationFor`,
 * see app/prototype/LearnerFeatures.js) used to fetch the entire /sources list
 * -- 109 records on the live app, and growing with every upload -- just to
 * read one row off it. getCourse now resolves the label server-side, into
 * `course.sourcePublications` (lib/learning/core.js `coursePublicationLabels`),
 * so a reader never has to ask for anything beyond the course fetch it was
 * already making.
 *
 * The harness below mirrors tests/ui-rendering.test.mjs's `loadComponent`: the
 * component is evaluated in its own vm sandbox with `useApiQuery` shimmed, so
 * this can assert on both the rendered citation AND the exact set of paths
 * the component asked for -- '/sources' must never be one of them.
 */

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadComponent(relativePath, { queryData = {}, requestedPaths = [] } = {}) {
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
  const useLearning = {
    useApiQuery(requestPath) {
      requestedPaths.push(requestPath);
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
      if (request === 'react') return React;
      if (request === '../_learning/useLearning') return useLearning;
      if (request === '../_auth/AuthProvider') {
        return { useAuth: () => ({ user: { uid: 'tester' }, ready: true, loading: false }) };
      }
      if (request === '../../lib/firebase') {
        return { authFetch: async () => { throw new Error('Static rendering must not make authenticated requests'); } };
      }
      if (request.endsWith('.css')) return {};
      if (request.startsWith('../../lib/')) {
        return require(path.join(workspace, request.replace('../../', '')));
      }
      if (request.startsWith('../_course/')) {
        const sharedPath = path.join(path.dirname(relativePath), `${request}.js`);
        return loadComponent(sharedPath, { queryData, requestedPaths });
      }
      if (request.startsWith('./')) {
        const sibling = path.join(path.dirname(relativePath), `${request}.js`);
        return loadComponent(sibling, { queryData, requestedPaths });
      }
      return require(request);
    },
  };
  vm.runInNewContext(transformed.code, sandbox, { filename });
  return module.exports;
}

/* The same course envelope shape getCourse now returns: sourceIds alongside
 * the label map resolved for them. No '/sources' key anywhere in this fixture
 * -- that is the point. */
function courseFixture(overrides = {}) {
  return {
    '/courses/course-1': {
      status: 'APPROVED',
      version: 1,
      course: {
        sourceIds: ['source-record-1'],
        sourcePublications: { 'source-record-1': 'TC 3-22.9' },
        sections: [{
          id: 'section-1',
          title: 'Movement fundamentals',
          cite: 'source-record-1 p.135',
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
        // No `pubId` on the row: this is exactly the case that used to force
        // the whole-list fallback lookup.
        citation: { citation: 'source-record-1 p.135', pubId: null, page: '135' },
      }],
      items: [],
      answers: {},
    },
    ...overrides,
  };
}

test('a lesson citation resolves from the course envelope alone -- no /sources fetch', () => {
  const requestedPaths = [];
  const { CourseReader } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: courseFixture(),
    requestedPaths,
  });
  const markup = renderToStaticMarkup(React.createElement(CourseReader, {
    course: { id: 'course-1' },
  }));

  assert.match(markup, /TC 3-22\.9 p\.135/);
  // The record id is still on the title attribute (the addressable locator),
  // just never as text a learner reads.
  assert.match(markup, /title="source-record-1 p\.135"/);
  assert.doesNotMatch(markup, />[^<]*source-record-1/);
  assert.ok(
    !requestedPaths.includes('/sources'),
    `citation rendering must not fetch the whole source list, but asked for: ${JSON.stringify(requestedPaths)}`,
  );
});

test('a mastery citation also resolves without the source list, and withholds the name until the course resolves it', () => {
  const requestedPaths = [];
  const { MasterySession } = loadComponent('app/prototype/LearnerFeatures.js', {
    queryData: {
      ...courseFixture({
        '/courses/course-1': {
          status: 'APPROVED',
          version: 1,
          course: {
            sourceIds: ['source-record-1'],
            sourcePublications: { 'source-record-1': 'TC 3-22.9' },
            masteryPlan: { status: 'APPROVED', sourceId: 'source-record-1', revision: 'rev-1' },
            sections: [],
          },
        },
      }),
      '/mastery/sessions?courseId=course-1': [],
    },
    requestedPaths,
  });
  const markup = renderToStaticMarkup(React.createElement(MasterySession, {
    course: { id: 'course-1' },
  }));

  assert.match(markup, /Grounded on TC 3-22\.9/);
  assert.ok(
    !requestedPaths.includes('/sources'),
    `mastery citation must not fetch the whole source list, but asked for: ${JSON.stringify(requestedPaths)}`,
  );
});

test('the reader never asks for the whole source list, structurally', () => {
  // Belt and suspenders: the two behavioural tests above prove the resolved
  // shape works; this pins the shape of the fix so a future edit cannot
  // reintroduce a whole-list read by some other path than usePublicationName.
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/LearnerFeatures.js'), 'utf8');
  assert.doesNotMatch(source, /useApiQuery\(\s*['"]\/sources['"]/);
});
