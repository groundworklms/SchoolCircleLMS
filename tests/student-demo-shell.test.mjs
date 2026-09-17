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
const shellSource = fs.readFileSync(path.join(workspace, 'app/prototype/StudentShell.js'), 'utf8');

const state = {
  courses: [],
  loading: false,
  error: null,
  profile: null,
  nav: { area: 'dashboard', courseId: null, view: null, lessonId: null, page: null, threadId: null },
};
const inboxState = {
  messages: [],
  loading: false,
  error: '',
  live: true,
  ready: true,
  markRead: async () => false,
  removeMessage: async () => false,
};
let renderedInboxProps = null;

function leaf(name) {
  return function MockLeaf(props) {
    return React.createElement('div', { 'data-screen': name }, props?.course?.name || name);
  };
}

const shell = {
  I: {
    dashboard: React.createElement('span', null, 'dashboard'),
    courses: React.createElement('span', null, 'courses'),
    calendar: React.createElement('span', null, 'calendar'),
    inbox: React.createElement('span', null, 'inbox'),
    swap: React.createElement('span', null, 'swap'),
  },
  RailButton: ({ label, onClick, badge }) => React.createElement('button', { onClick, 'data-badge': badge || undefined }, label),
  UserMenu: ({ items }) => React.createElement(
    'div',
    { 'data-screen': 'user-menu' },
    items.filter((item) => item !== 'divider').map((item) => item.label).join(' · '),
  ),
};

function loadStudentShell() {
  const filename = path.join(workspace, 'app/prototype/StudentShell.js');
  const transformed = transformSync(fs.readFileSync(filename, 'utf8'), {
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2019',
      transform: { react: { runtime: 'classic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    React,
    require(request) {
      if (request === 'react') return React;
      if (request === './student.css') return {};
      if (request === './shell') return shell;
      if (request === './learning') {
        return {
          useLearningCourses: () => ({
            courses: state.courses,
            loading: state.loading,
            error: state.error,
          }),
          resolveCourse: (id, courses) => courses.find((course) => course.id === id) || null,
        };
      }
      if (request === './prefs') return { usePrefs: () => ({ textScale: 1, showCalendar: true }) };
      if (request === './StudentCalendar') return leaf('calendar');
      if (request === './StudentInbox') {
        const Inbox = (props) => {
          renderedInboxProps = props;
          return React.createElement(
            'div',
            { 'data-screen': 'inbox' },
            props.inbox.messages.map((message) => `${message.id}:${message.unread ? 'unread' : 'read'}`).join(','),
          );
        };
        return { __esModule: true, default: Inbox, useRosterInbox: () => inboxState };
      }
      if (request === './CourseChat') return leaf('course-chat');
      if (request === './Settings') return { StudentSettings: leaf('settings') };
      if (request === './FocusedDashboard') {
        return function FocusedDashboard({ courses = [], loading, error }) {
          const body = loading
            ? 'Loading courses…'
            : error
              ? `Unable to load courses: ${error.error || error.message}`
              : courses.length
                ? courses.map((course) => course.name).join(' ')
                : 'No courses are available to you yet. Nothing published to you yet.';
          const props = loading || error ? { role: loading ? 'status' : 'alert' } : {};
          return React.createElement('div', { ...props, 'data-screen': 'focused-dashboard' }, body);
        };
      }
      if (request === './CoursesMenu') return leaf('courses-menu');
      if (request === './courseTreeState.mjs') {
        return {
          expandCourse: (expanded, id) => ({ ...expanded, [id]: true }),
          expandOnCourseSelection: (expanded) => expanded,
          initialExpandedCourseIds: () => ({}),
          pruneExpandedCourseIds: (expanded) => expanded,
          toggleExpandedCourse: (expanded, id) => ({ ...expanded, [id]: !expanded[id] }),
        };
      }
      if (request === './LearnerFeatures') {
        return {
          RealCourseHome: leaf('real-course-home'),
          CourseReader: leaf('reader'),
          MasterySession: leaf('mastery'),
          StudyPlan: leaf('path'),
          LearnerProgress: leaf('progress'),
        };
      }
      if (request === '../_auth/AuthProvider') {
        return {
          useAuth: () => ({
            ready: true,
            profile: state.profile,
            signOut: async () => {},
            signOutError: null,
          }),
        };
      }
      if (request === '../_auth/account-display') {
        return {
          accountDisplay: ({ profile }) => ({
            authenticated: Boolean(profile),
            name: profile?.name || 'Student',
            rank: profile?.rank || null,
            initials: profile?.initials || 'ST',
          }),
        };
      }
      throw new Error(`Unexpected StudentShell dependency: ${request}`);
    },
  };
  vm.runInNewContext(transformed.code, sandbox, { filename });
  return module.exports.default;
}

const StudentShell = loadStudentShell();

function render(nav = state.nav) {
  return renderToStaticMarkup(React.createElement(StudentShell, {
    nav: { ...nav, go: () => {} },
  }));
}

function generatedCourse() {
  return {
    id: 'generated-course-1',
    name: 'Generated Safety Course',
    school: 'Generated curriculum',
    sections: 3,
    status: 'APPROVED',
    record: { id: 'generated-course-1', type: 'COURSE_DRAFT' },
  };
}

test('empty generated course data renders an honest dashboard', () => {
  Object.assign(state, {
    courses: [], loading: false, error: null, profile: null,
    nav: { area: 'dashboard', courseId: null, view: null },
  });
  const markup = render();
  assert.match(markup, /No courses are available to you yet/);
  assert.match(markup, /Nothing published to you yet/);
  assert.doesNotMatch(markup, /M092721|Cpl Rivera|Demo samples|Up next/);
});

test('populated generated data renders real course cards and course home', () => {
  const course = generatedCourse();
  Object.assign(state, {
    courses: [course], loading: false, error: null,
    nav: { area: 'dashboard', courseId: null, view: null },
  });
  assert.match(render(), /Generated Safety Course/);
  assert.doesNotMatch(render(), /Demo|M092721/);

  state.nav = { area: 'course', courseId: course.id, view: 'home' };
  assert.match(render(), /data-screen="real-course-home"/);
});

test('loading and error states remain visible without course fixtures', () => {
  Object.assign(state, {
    courses: [], loading: true, error: null,
    nav: { area: 'dashboard', courseId: null, view: null },
  });
  assert.match(render(), /role="status"[^>]*>Loading courses…/);

  Object.assign(state, {
    courses: [], loading: false, error: { error: 'Service unavailable' },
  });
  assert.match(render(), /role="alert"[^>]*>Unable to load courses: Service unavailable/);
});

test('a former fixture deep link is unavailable and never resolves to a fake course', () => {
  Object.assign(state, {
    courses: [], loading: false, error: null,
    nav: { area: 'course', courseId: 'M092721', view: 'home' },
  });
  const markup = render();
  assert.match(markup, /Course unavailable/);
  assert.match(markup, /No accessible course matches/);
  assert.doesNotMatch(markup, /Basic Electronics|Transmission Lines|Cpl Rivera/);
});

test('the shell and inbox view consume one shared inbox state for badge, read, and delete', async () => {
  assert.doesNotMatch(shellSource, /useInboxMessages/);
  assert.match(shellSource, /<StudentInbox[^>]+inbox=\{inbox\}/);
  const message = { id: 'roster-1', unread: true };
  inboxState.messages = [message];
  inboxState.markRead = async (selected) => {
    selected.unread = false;
    return true;
  };
  inboxState.removeMessage = async (selected) => {
    inboxState.messages = inboxState.messages.filter((item) => item.id !== selected.id);
    return true;
  };
  state.nav = { area: 'inbox', courseId: null, view: null };

  let markup = render();
  assert.match(markup, /data-badge="1"/);
  assert.equal(renderedInboxProps.inbox, inboxState);
  assert.match(markup, /roster-1:unread/);

  await renderedInboxProps.inbox.markRead(message);
  markup = render();
  assert.doesNotMatch(markup, /data-badge=/);
  assert.match(markup, /roster-1:read/);

  await renderedInboxProps.inbox.removeMessage(message);
  markup = render();
  assert.doesNotMatch(markup, /roster-1/);
});
