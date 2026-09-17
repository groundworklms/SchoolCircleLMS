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

function loadInstructorShell({ courses = [] } = {}) {
  const relativePath = 'app/prototype/InstructorShell.js';
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
  const component = (name) => function MockComponent() {
    return React.createElement('div', null, name);
  };
  const demoCourses = [{
    id: 'TC32209',
    name: 'Rifle Marksmanship — TC 3-22.9',
    school: '03xx — Infantry',
  }];
  const learning = {
    courseFromRecord(entry) {
      return { ...entry, name: entry.title || entry.name, record: entry };
    },
    useLearningCourses() {
      return {
        courses,
        demoCourses,
        loading: false,
        error: null,
        enabled: true,
        refetch: async () => {},
      };
    },
  };
  const shell = {
    I: {
      courses: React.createElement('span', null, 'courses-icon'),
      dashboard: React.createElement('span', null, 'dashboard-icon'),
      swap: React.createElement('span', null, 'swap-icon'),
      back: React.createElement('span', null, 'back-icon'),
    },
    RailButton: ({ label, onClick }) => React.createElement('button', { onClick }, label),
    UserMenu: () => React.createElement('div', null, 'user-menu'),
  };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    require(request) {
      if (request === 'react') return React;
      if (request === './student.css') return {};
      if (request === './shell') return shell;
      if (request === './learning') return learning;
      if (request === './Settings') return { InstructorSettings: component('settings') };
      if (request === './LiveControl') return component('live-control');
      if (request === './Mastery') return component('mastery');
      if (request === './AAR') return component('aar');
      if (request === './Roster') return component('roster');
      if (request === './Library') {
        return {
          SourcesView: component('sources'),
          CoursesLibrary: component('courses-library'),
          CourseDraft: component('course-draft'),
        };
      }
      if (request === './InstructorFeatures') {
        return {
          CourseRubrics: component('course-rubrics'),
          InstructorFidelity: component('fidelity'),
          RubricsView: component('rubrics'),
        };
      }
      if (request === '../_auth/AuthProvider') {
        return {
          useAuth: () => ({
            ready: true,
            profile: null,
            signOut: async () => {},
            signOutError: null,
          }),
        };
      }
      if (request === '../_auth/account-display') {
        return {
          accountDisplay: () => ({
            authenticated: true,
            name: 'Instructor',
            rank: null,
            initials: 'IN',
          }),
        };
      }
      throw new Error(`Unexpected InstructorShell dependency: ${request}`);
    },
  };
  vm.runInNewContext(transformed.code, sandbox, { filename });
  return module.exports;
}

test('authoritative course refresh replaces the selected creation fallback', () => {
  const {
    courseListWithSelectedFallback,
    courseHeaderStatus,
  } = loadInstructorShell();
  const created = {
    id: 'course-1',
    title: 'Grounded course',
    status: 'PENDING',
    sourceIds: ['source-1'],
  };
  const fallback = courseListWithSelectedFallback([], created);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].status, 'PENDING');
  assert.equal(courseHeaderStatus(fallback[0]), 'Needs review');

  const refreshed = {
    id: 'course-1',
    name: 'Grounded course',
    status: 'APPROVED',
    hasPendingRevision: false,
    sections: 4,
    record: { id: 'course-1', status: 'APPROVED' },
  };
  const preferred = courseListWithSelectedFallback([refreshed], created);
  assert.deepEqual(preferred, [refreshed]);
  assert.equal(courseHeaderStatus(preferred[0]), 'Published');
  assert.equal(
    courseHeaderStatus({ ...refreshed, hasPendingRevision: true }),
    'Published · revision needs review',
  );
  assert.equal(courseHeaderStatus({ status: 'DRAFT' }), 'Needs review');
});

/* The stubbed bridge deliberately still offers a demoCourses collection. The
   instructor rail must ignore it: an instructor sees only the real courses they
   own, and the grouped library rail is what replaces the old sample rail. */
test('the instructor rail exposes no sample or demo courses', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: {
      area: 'library',
      view: 'courses',
      courseId: null,
    },
  }));
  assert.doesNotMatch(markup, />Demo</);
  assert.doesNotMatch(markup, />Demo courses</);
  assert.doesNotMatch(markup, /Sample courses/);
  assert.doesNotMatch(markup, /Rifle Marksmanship/);
  assert.match(markup, />Courses</);
  assert.match(markup, />Sources</);
  assert.match(markup, />Rubrics</);
  assert.match(markup, />Settings</);
  // The rail footer is product only: /plan is our own hackathon board.
  assert.doesNotMatch(markup, />Planning board</);
});

test('an unresolved instructor course id is an explicit not-found', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: 'TC32209', view: 'builder' },
  }));
  assert.match(markup, /Course not found/);
  assert.doesNotMatch(markup, /Rifle Marksmanship/);
});

test('service-backed courses retain the roster rail entry and roster deep link', () => {
  for (const status of ['PENDING', 'APPROVED']) {
    const course = {
      id: 'real-course',
      name: 'Generated course',
      status,
      courseType: 'COURSE_DRAFT',
      record: { id: 'real-course', type: 'COURSE_DRAFT', status },
    };
    const { default: InstructorShell } = loadInstructorShell({ courses: [course] });
    const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
      nav: { area: 'course', courseId: course.id, view: 'roster' },
    }));
    assert.match(markup, />Roster<\/button>/);
    assert.match(markup, /<div>roster<\/div>/);
    assert.doesNotMatch(markup, /Course tool unavailable|Course not found/);
  }
});
