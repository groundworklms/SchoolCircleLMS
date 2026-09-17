/* Mock student agenda shared by the dashboard, the course home, and the calendar.
   Hand-written, like the rest of the student-side numbers. The banner says so. */

// `view` is which course screen the item opens.
const TODO = [
  { title: 'Practice set — Fault Isolation', due: 'Today 1900', kind: 'Practice', courseId: 'M092721', view: 'materials', minutes: 30 },
  { title: 'SWR calculation drill', due: 'Wed 1900', kind: 'Practice', courseId: 'M092721', view: 'materials', minutes: 30 },
  { title: 'FY safety standdown', due: 'Overdue', kind: 'Requirement', courseId: null, late: true, minutes: 45 },
  { title: 'CY range qualification', due: 'In 22 days', kind: 'Requirement', courseId: null },
  { title: 'Net entry procedure — reading', due: 'Sun 1000', kind: 'Reading', courseId: 'M09CVS1', view: 'lessons', minutes: 40 },
];

const UPCOMING = [
  { title: 'Live session — Transmission Lines', when: 'Mon 0800', courseId: 'M092721', view: 'live' },
  { title: 'Block exam — Annex C', when: 'Fri 0730', courseId: 'M092721', exam: true },
  { title: 'Radio net practical', when: 'Next Tue', courseId: 'M09CVS1' },
];

const REQUIREMENTS = [
  { name: 'Annual cyber awareness', state: 'Complete', color: 'var(--f-good)' },
  { name: 'Rank EPME — enrolled', state: 'In progress', color: 'var(--f-warning)' },
  { name: 'CY range qualification', state: 'Due in 22 days', color: 'var(--f-warning)' },
  { name: 'Course prerequisite packet', state: 'Complete', color: 'var(--f-good)' },
  { name: 'FY safety standdown', state: 'Overdue', color: 'var(--f-critical)' },
];

export { TODO, UPCOMING, REQUIREMENTS };
