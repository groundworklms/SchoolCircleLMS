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
  const sampleCourses = {
    TC32209: {
      id: 'TC32209',
      name: 'Rifle Marksmanship — TC 3-22.9',
    },
    M092721: {
      id: 'M092721',
      name: 'Basic Electronics Course',
    },
  };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    require(request) {
      if (request === 'react') return React;
      if (request === './student.css') return {};
      if (request === './shell') return shell;
      if (request === './data') return { COURSES: sampleCourses };
      if (request === './InstructorCoursesMenu') {
        return function MockInstructorCoursesMenu({ label = 'Courses', courses = [], onOpenLibrary }) {
          return React.createElement(
            'div',
            null,
            label,
            React.createElement('button', { onClick: onOpenLibrary }, 'Course library'),
            courses.map((course) => React.createElement('div', { key: course.id }, course.name)),
          );
        };
      }
      if (request === './instructorCourseTreeState.mjs') {
        return {
          initialExpandedCourseIds: (id) => (id ? { [id]: true } : {}),
          toggleExpandedCourse: (expanded, id) => ({ ...expanded, [id]: !expanded[id] }),
          expandCourse: (expanded, id) => ({ ...expanded, [id]: true }),
          expandOnCourseSelection: (expanded, previous, selected) => (
            selected && selected !== previous ? { ...expanded, [selected]: true } : expanded
          ),
        };
      }
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
  const fallback = courseListWithSelectedFallback([], created, { pendingRefresh: true });
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

test('a deferred refresh bounds the optimistic row and preserves an authoritative response', () => {
  const { courseListWithSelectedFallback } = loadInstructorShell();
  const created = {
    id: 'course-2',
    title: 'Eventually persisted',
    status: 'PENDING',
  };

  const duringRefresh = courseListWithSelectedFallback([], created, { pendingRefresh: true });
  assert.equal(duringRefresh.length, 1);

  // A successful list response that omits the selected record is authoritative
  // deletion/not-found, not permission to keep rendering stale controls.
  const afterDeletedRefresh = courseListWithSelectedFallback([], created, { pendingRefresh: false });
  assert.deepEqual(afterDeletedRefresh, []);

  const authoritative = {
    id: created.id,
    name: created.title,
    status: 'APPROVED',
    record: { id: created.id, status: 'APPROVED' },
  };
  const afterPersistedRefresh = courseListWithSelectedFallback([], created, {
    pendingRefresh: false,
    authoritativeCourse: authoritative,
  });
  assert.equal(afterPersistedRefresh.length, 1);
  assert.equal(afterPersistedRefresh[0].id, authoritative.id);
  assert.equal(afterPersistedRefresh[0].status, 'APPROVED');
  assert.equal(afterPersistedRefresh[0].record.status, 'APPROVED');
});

test('the instructor rail nests sample courses under Courses and keeps the library route', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: {
      area: 'library',
      view: 'courses',
      courseId: null,
    },
  }));
  assert.doesNotMatch(markup, /Sample courses/);
  assert.match(markup, /Courses/);
  assert.match(markup, /Course library/);
  assert.match(markup, /Rifle Marksmanship/);
  assert.match(markup, /Basic Electronics Course/);
  assert.match(markup, />Sources</);
  assert.match(markup, />Rubrics</);
  assert.match(markup, />Settings</);
  // The rail footer is product only: /plan is our own hackathon board.
  assert.doesNotMatch(markup, />Planning board</);
});

test('an unknown instructor course id is an explicit not-found', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: 'not-a-course', view: 'builder' },
  }));
  assert.match(markup, /Course not found/);
});

test('sample courses use instructor destinations without authoring records', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: 'TC32209', view: 'builder' },
  }));
  assert.match(markup, /Rifle Marksmanship/);
  assert.match(markup, /sample course is view-only/i);
  assert.doesNotMatch(markup, /Course not found/);
});

test('sample analytics destination stays unavailable instead of calling the live tool', () => {
  const { default: InstructorShell } = loadInstructorShell();
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: 'TC32209', view: 'mastery' },
  }));
  assert.match(markup, /Sample course tool unavailable/);
  assert.match(markup, /does not connect to live analytics or authoring services/);
  assert.doesNotMatch(markup, /<div>mastery<\/div>/);
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

test('the course sub-rail groups its tools by what they are for', () => {
  const course = {
    id: 'real-course',
    name: 'Generated course',
    status: 'APPROVED',
    record: { id: 'real-course', type: 'COURSE_DRAFT', status: 'APPROVED' },
  };
  const { default: InstructorShell } = loadInstructorShell({ courses: [course] });
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: course.id, view: 'builder' },
  }));

  // "Advanced tools" described how hard the four were, not what any of them was
  // for, and buried a pre-publish check next to an after-action review.
  assert.doesNotMatch(markup, /Advanced tools/);
  assert.match(markup, />Quality checks</);
  assert.match(markup, />How the class did</);

  // Every tool still has a rail entry; none was lost to the regrouping.
  for (const label of [
    'Review &amp; publish',
    'Roster',
    'Course settings',
    'Fidelity check',
    'Objective rubrics',
    'Class mastery',
    'Course AAR',
  ]) {
    assert.match(markup, new RegExp(`>${label}</button>`), `missing rail entry ${label}`);
  }

  // The group headings sit above the tools they name.
  assert.ok(
    markup.indexOf('Quality checks') < markup.indexOf('Fidelity check'),
    'Quality checks must precede the checks it groups',
  );
  assert.ok(
    markup.indexOf('How the class did') < markup.indexOf('Class mastery'),
    'the results heading must precede the results',
  );
});

test('a legacy manual course prints no empty group headings', () => {
  const course = { id: 'legacy-1', name: 'Manual course', manual: true, record: { id: 'legacy-1' } };
  const { default: InstructorShell } = loadInstructorShell({ courses: [course] });
  const markup = renderToStaticMarkup(React.createElement(InstructorShell, {
    nav: { area: 'course', courseId: course.id, view: 'roster' },
  }));
  assert.match(markup, />Roster</);
  assert.doesNotMatch(markup, /Quality checks|How the class did/);
});

test('a course row cannot trap its own actions menu under the next card', () => {
  // The row answered hover with a transform, which made it a stacking context:
  // the menu, and the taller confirm step after it, were painted with the row
  // and under the card below. Only the last row in a list escaped, so a
  // ten-course library had nine undeletable courses.
  const css = fs.readFileSync(path.join(workspace, 'app/prototype/row-actions.css'), 'utf8');
  const managedHover = css.match(/\.s-courserow\.s-courserow-managed:hover \{[^}]+\}/);
  assert.ok(managedHover, 'a managed row must override the lifting hover');
  assert.match(managedHover[0], /transform:\s*none/);
  // The affordance is kept, just with a property that costs no stacking context.
  assert.match(managedHover[0], /box-shadow:/);
  // Both classes are named so the override outranks .s-courserow:hover.
  assert.match(css, /\.s-courserow\.s-courserow-managed:has\(\.row-actions-menu\)/);
});

test('the readiness panel keeps its admissions and names the tools it points at', () => {
  const source = fs.readFileSync(path.join(workspace, 'app/prototype/CourseReadiness.js'), 'utf8');
  // The sentences that say what this panel does NOT promise. Word for word.
  assert.ok(
    source.includes('These checks run again when you approve. This panel does not certify that they have passed.'),
    'the panel must keep admitting that it certifies nothing',
  );
  assert.ok(
    source.includes('None is a course publishing requirement.'),
    'the optional tools must keep saying they are optional',
  );
  // The pointer has to name controls an instructor can click. Pointing at
  // "secondary controls" is how four real features ended up undiscoverable.
  assert.match(source, /under Quality checks/);
  assert.match(source, /at the foot of this page/);
});
