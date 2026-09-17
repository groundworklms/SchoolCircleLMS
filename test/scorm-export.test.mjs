/**
 * The ratification guarantee at the EXPORT door.
 *
 * "AI drafts; an instructor approves, edits, or rejects. Nothing unreviewed
 * reaches a student" has to hold for a SCORM package as well, and harder: the
 * package leaves SchoolCircle for another LMS, where nobody re-reads it. These
 * tests pin the four things that were not true of it:
 *
 *   - a PENDING lesson or question is not in the bytes;
 *   - an APPROVED one is;
 *   - a part-ratified export is refused unless it is asked for deliberately,
 *     and the package that results says what it is;
 *   - a citation in the package names a publication, never a record id.
 *
 * Deliberately zip-level. Asserting on the projection object would pass while
 * the withheld text still travelled in the payload Cartridge embeds, so the
 * withheld strings are searched for in the package itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { buildApprovedScorm, ratifiedCourseForCartridge } from '../lib/arsenal-evidence.js';
import { createEvidenceHandlers } from '../lib/learning/evidence.js';
import { errorStatus } from '../lib/learning/http.js';

const PUBLICATION = 'TC 3-22.9';
const SOURCE_RECORD_ID = 'clk3x9fixturesourcerecordid';

/** A citation exactly as lib/learning/project-course.js stamps one on an Item. */
function citation(page) {
  return { citation: `${SOURCE_RECORD_ID} p.${page}`, pubId: PUBLICATION, page: String(page) };
}

function lessonRow(id, status, text, page = 85) {
  return { id, kind: 'LESSON', stem: text, options: null, answer: null, rationale: null, citation: citation(page), support: null, status };
}

function questionRow(id, status, stem, page = 85) {
  return {
    id,
    kind: 'QUESTION',
    stem,
    options: ['The ratified option', 'A distractor'],
    answer: 0,
    rationale: null,
    citation: citation(page),
    support: null,
    status,
  };
}

/** Rows shaped as lib/db.js `listDeliveryCourseItems` returns them. */
function release({ lessonStatus = 'APPROVED', questionStatus = 'APPROVED', second } = {}) {
  const sections = [{
    id: 'section-1',
    title: 'Functional Elements of the Shot Process',
    order: 0,
    items: [
      lessonRow('item-lesson-1', lessonStatus, 'Aim, control and movement are the functional elements.'),
      questionRow('item-question-1', questionStatus, 'What do the functional elements describe?'),
    ],
  }];
  if (second) {
    sections.push({
      id: 'section-2',
      title: 'Stability',
      order: 1,
      items: [
        lessonRow('item-lesson-2', second.lessonStatus ?? 'APPROVED', 'Natural point of aim holds the rifle steady.', 90),
        questionRow('item-question-2', second.questionStatus ?? 'APPROVED', 'What holds the rifle steady?', 90),
      ],
    });
  }
  return sections;
}

const COURSE = { id: 'course-release-1', title: 'Rifle Marksmanship' };

/** Everything a person or a receiving LMS can actually read out of a package. */
async function readPackage(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const manifest = await zip.file('imsmanifest.xml').async('string');
  const page = await zip.file('index.html').async('string');
  const embedded = /var DATA=(\{[\s\S]*\});\(function/.exec(page);
  const data = JSON.parse(embedded[1].replace(/\\u003c/g, '<').replace(/\\u2028/g, ' ').replace(/\\u2029/g, ' '));
  return { manifest, page, data, text: `${manifest}\n${page}` };
}

async function exportPackage(options) {
  const built = await buildApprovedScorm({ course: COURSE, version: '1.2', ...options });
  return { built, ...(await readPackage(built.zip)) };
}

async function refusal(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return { status: errorStatus(error), code: error.code, message: error.message };
  }
}

test('an unratified lesson or question is not in the exported bytes, and a ratified one is', async () => {
  const { built, data, text } = await exportPackage({
    sections: release({
      lessonStatus: 'PENDING',
      questionStatus: 'PENDING',
      second: { lessonStatus: 'APPROVED', questionStatus: 'APPROVED' },
    }),
    allowPartial: true,
  });

  assert.equal(built.validation.valid, true);
  // The ratified section is there in full.
  assert.deepEqual(data.lessons.map((lesson) => lesson.text), ['Natural point of aim holds the rifle steady.']);
  assert.deepEqual(data.quiz.map((question) => question.stem), ['What holds the rifle steady?']);
  // The unratified one is nowhere in the package -- not in the courseware, not
  // in the embedded payload, not in the manifest.
  for (const withheld of [
    'Aim, control and movement are the functional elements.',
    'What do the functional elements describe?',
  ]) {
    assert.equal(text.includes(withheld), false, `unratified content reached the package: ${withheld}`);
  }
  assert.equal(built.census.ratified.total, 2);
  assert.equal(built.census.awaiting.total, 2);
});

test('a REJECTED item is a decision, so it is withheld without blocking the export', async () => {
  const sections = release({ second: { lessonStatus: 'REJECTED', questionStatus: 'REJECTED' } });
  // No allowPartial: nothing is awaiting a decision, so the export is not partial.
  const { built, data, text } = await exportPackage({ sections });
  assert.equal(built.census.partial, false);
  assert.equal(data.lessons.length, 1);
  assert.equal(text.includes('Natural point of aim holds the rifle steady.'), false);
  assert.equal(built.course.title, 'Rifle Marksmanship');
});

test('a part-ratified export is refused by default, and the refusal names what is unratified', async () => {
  const refused = await refusal(buildApprovedScorm({
    course: COURSE,
    sections: release({ second: { lessonStatus: 'PENDING', questionStatus: 'PENDING' } }),
  }));
  assert.equal(refused.status, 409);
  assert.equal(refused.code, 'COURSE_NOT_RATIFIED');
  assert.match(refused.message, /1 lesson and 1 question of the 4 in this course are still awaiting instructor review/);

  const nothing = await refusal(buildApprovedScorm({
    course: COURSE,
    sections: release({ lessonStatus: 'PENDING', questionStatus: 'PENDING' }),
    // Even asked for deliberately: a package with a course title and no content
    // is the most misleading artifact of all.
    allowPartial: true,
  }));
  assert.equal(nothing.status, 409);
  assert.match(nothing.message, /none of the 2 items in this course has been approved yet/);
});

test('a partial package says so in the manifest title and in its overview', async () => {
  const { built, manifest, data } = await exportPackage({
    sections: release({ second: { lessonStatus: 'PENDING', questionStatus: 'PENDING' } }),
    allowPartial: true,
  });

  assert.equal(built.census.partial, true);
  // The <organization> title is the string a receiving LMS lists the course
  // under, and the one nobody opens the package to check.
  assert.match(manifest, /<title>Rifle Marksmanship — PARTIAL RELEASE<\/title>/);
  assert.equal(data.title, 'Rifle Marksmanship — PARTIAL RELEASE');
  assert.match(
    data.summary,
    /Partial release\. An instructor has ratified 2 of 4 items in this course; the remaining 1 lesson and 1 question are still awaiting review/,
  );
});

test('a fully ratified export is labelled as the course, with no partial claim', async () => {
  const { built, manifest, data } = await exportPackage({ sections: release({ second: {} }) });
  assert.equal(built.census.partial, false);
  assert.match(manifest, /<title>Rifle Marksmanship<\/title>/);
  assert.equal(data.title, 'Rifle Marksmanship');
  assert.equal(/partial/i.test(data.summary), false);
  assert.equal(data.lessons.length, 2);
  assert.equal(data.quiz.length, 2);
});

test('an exported citation names the publication and keeps the locator out of sight', async () => {
  const { data, text } = await exportPackage({ sections: release() });
  assert.deepEqual(data.lessons.map((lesson) => lesson.cite), [`${PUBLICATION} p.85`]);
  // The stored locator is the addressing contract the source viewer resolves,
  // so it travels with the lesson -- it is simply never the citation.
  assert.deepEqual(data.lessons.map((lesson) => lesson.locator), [`${SOURCE_RECORD_ID} p.85`]);
  // Nothing renders it: the visible provenance line is the publication name.
  assert.equal(text.includes(`<div class="cite">${SOURCE_RECORD_ID}`), false);
});

test('a document filename in a citation reads as a publication, as it does on every screen', () => {
  const sections = release();
  sections[0].items[0].citation = { citation: 'MCWP_2-10.pdf p.12', pubId: 'MCWP_2-10.pdf', page: '12' };
  const { course } = ratifiedCourseForCartridge({ course: COURSE, sections });
  assert.equal(course.lessons[0].cite, 'MCWP 2-10 p.12');
  assert.equal(course.lessons[0].locator, 'MCWP_2-10.pdf p.12');
});

test('a ratified lesson with no citation is refused rather than exported uncited', async () => {
  const sections = release();
  sections[0].items[0].citation = null;
  const refused = await refusal(buildApprovedScorm({ course: COURSE, sections }));
  assert.equal(refused.code, 'COURSE_CONTENT_MISSING');
  assert.match(refused.message, /valid source citation/);
});

test('the twelve-question cap a SCORM package imposes is disclosed, not silently applied', async () => {
  const sections = [{
    id: 'section-1',
    title: 'Everything',
    order: 0,
    items: [
      lessonRow('item-lesson-1', 'APPROVED', 'One ratified lesson.'),
      ...Array.from({ length: 13 }, (_, index) =>
        questionRow(`item-question-${index}`, 'APPROVED', `Ratified question ${index}?`)),
    ],
  }];
  const { built, data } = await exportPackage({ sections });
  // Cartridge keeps the first twelve. The thirteenth is ratified content that
  // is not in the package, so the package has to admit it.
  assert.equal(built.census.ratified.QUESTION, 13);
  assert.equal(data.quiz.length, 12);
  assert.equal(built.census.packagedQuestions, 12);
  assert.match(data.summary, /carries the first 12 of 13 ratified questions/);
  assert.equal(built.census.partial, false);
});

test('a ratified item of a kind the package cannot carry is declared rather than dropped', async () => {
  const sections = release();
  sections[0].items.push({
    id: 'item-scenario-1',
    kind: 'SCENARIO',
    stem: 'Your squad is pinned on an exposed slope.',
    options: null,
    answer: null,
    rationale: null,
    citation: citation(85),
    support: null,
    status: 'APPROVED',
  });
  const { built, data } = await exportPackage({ sections });
  assert.equal(built.census.ratified.OTHER, 1);
  assert.match(data.summary, /1 ratified item of a kind this package format does not carry/);
});

/* ---------------- the route handler, over a store seam ---------------- */

function evidenceFor({ course, sections, recorded = [] }) {
  return createEvidenceHandlers({
    store: {
      async getApprovedCourse() { return course; },
      async listReleaseSections() { return sections; },
      async recordExport(entry) { recorded.push(entry); },
    },
  });
}

const INSTRUCTOR = { id: 'instructor-1', role: 'INSTRUCTOR' };

test('the export handler packages the delivery rows, never the approved draft payload', async () => {
  // What `getApprovedCourse` falls back to for a release with no typed rows:
  // the approved authoring draft, lesson/pre/post, with no item status in it.
  // Packaging it was the bypass. With no ratified rows there is nothing to
  // export, and the draft is not consulted.
  const draftPayload = {
    id: 'course-release-1',
    title: 'Rifle Marksmanship',
    approved: true,
    sections: [{
      title: 'Functional Elements',
      cite: `${SOURCE_RECORD_ID} p.85`,
      lesson: 'Unratified draft prose that was never reviewed.',
      pre: [{ stem: 'Unratified draft question?', options: ['A', 'B'], answer: 0 }],
      post: [{ stem: 'Another unratified draft question?', options: ['A', 'B'], answer: 0 }],
    }],
  };
  const evidence = evidenceFor({ course: draftPayload, sections: [] });
  const refused = await refusal(evidence.exportScorm(INSTRUCTOR, { query: { courseId: 'course-1' } }));
  assert.equal(refused.status, 409);
  assert.equal(refused.code, 'COURSE_NOT_RATIFIED');
  assert.match(refused.message, /no ratified items on record/);
});

test('the export handler refuses a learner before it reads any content', async () => {
  const evidence = evidenceFor({ course: COURSE, sections: release() });
  const refused = await refusal(
    evidence.exportScorm({ id: 'learner-1', role: 'LEARNER' }, { query: { courseId: 'course-1' } }),
  );
  assert.equal(refused.status, 403);
});

test('the export handler records what left the system, partial or whole', async () => {
  const recorded = [];
  const partly = evidenceFor({
    course: COURSE,
    sections: release({ second: { lessonStatus: 'PENDING', questionStatus: 'PENDING' } }),
    recorded,
  });
  const query = { courseId: 'course-1', version: '2004' };

  const refused = await refusal(partly.exportScorm(INSTRUCTOR, { query }));
  assert.equal(refused.code, 'COURSE_NOT_RATIFIED');
  assert.deepEqual(recorded, [], 'a refused export is not recorded as one');

  const response = await partly.exportScorm(INSTRUCTOR, { query: { ...query, partial: 'true' } });
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.equal(response.headers['x-scorm-version'], '2004 4th Edition');
  // The file an instructor ends up with on disk carries the same warning.
  assert.match(response.headers['content-disposition'], /Rifle-Marksmanship-PARTIAL-RELEASE\.zip/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].partial, true);
  assert.equal(recorded[0].ratified.ratified.total, 2);
  assert.equal(recorded[0].ratified.awaiting.total, 2);

  const whole = evidenceFor({ course: COURSE, sections: release({ second: {} }), recorded });
  const complete = await whole.exportScorm(INSTRUCTOR, { query });
  assert.match(complete.headers['content-disposition'], /Rifle-Marksmanship\.zip/);
  assert.equal(recorded[1].partial, false);
});
