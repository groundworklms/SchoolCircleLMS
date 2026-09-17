function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload
    : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The typed Course id currently serving an approved generated course. Initial
 * approvals retain the root id; later approvals point at an immutable release.
 */
export function approvedDeliveryId(record) {
  return nonEmptyString(payloadOf(record).deliveryCourseId) || nonEmptyString(record?.id);
}

function releaseIds(record) {
  const payload = payloadOf(record);
  const ids = new Set();
  const current = approvedDeliveryId(record);
  if (current) ids.add(current);
  // The root id remains a valid explicit pin for the first release even after
  // a later immutable replacement becomes current.
  if (record?.id) ids.add(record.id);
  if (Array.isArray(payload.revisionHistory)) {
    for (const entry of payload.revisionHistory) {
      const id = nonEmptyString(entry?.deliveryCourseId);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Resolve an optional UI release pin against the approved root record. A
 * caller cannot turn an arbitrary typed Course id into a release selection.
 */
export function selectedDeliveryId(record, requestedReleaseId) {
  const current = approvedDeliveryId(record);
  const requested = nonEmptyString(requestedReleaseId);
  if (!requested) return current;
  return releaseIds(record).has(requested) ? requested : null;
}

/**
 * Keep legacy typed courses that are not backed by a generated root, while
 * replacing a generated root with its latest immutable delivery snapshot.
 */
export function selectCurrentDeliveryCourses(courses, approvedRecords) {
  const rows = Array.isArray(courses) ? courses : [];
  const records = (Array.isArray(approvedRecords) ? approvedRecords : [])
    .filter((record) => record?.type === 'COURSE_DRAFT' && record?.status === 'APPROVED');
  if (!records.length) return rows;

  const generatedReleaseIds = new Set(records.flatMap((record) => [...releaseIds(record)]));
  const currentIds = new Set(records.map(approvedDeliveryId).filter(Boolean));
  return rows.filter((course) =>
    currentIds.has(course?.id) || !generatedReleaseIds.has(course?.id));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Learners receive the approved release's teaching and assessment choices,
 * never the answer key, rationale, or support score. Instructors can inspect
 * the complete typed delivery projection.
 */
export function projectDeliveryCourse(course, { learner = false } = {}) {
  const projected = clone(course);
  if (!projected || !learner) return projected;
  for (const section of Array.isArray(projected.sections) ? projected.sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items : []) {
      delete item.answer;
      delete item.rationale;
      delete item.support;
    }
  }
  return projected;
}

export function approvedReleaseIds(record) {
  return [...releaseIds(record)];
}
/**
 * The PROSE half of the learner delivery projection.
 *
 * Why this exists. The reader used to take a section's lesson text from the
 * authoring draft (`/api/learning/courses/:id` -> `sections[].lesson`) while
 * taking its checks from the materialised rows. Two reads for one screen, and
 * only one of them passed through ratification: a `LESSON` row sitting PENDING
 * changed nothing on a learner's screen, because the text they were reading had
 * never come from that row. The draft and the row can also genuinely differ --
 * an instructor who fixes a lesson with REVISE writes the new wording onto the
 * ROW (lib/learning/item-review.js `itemRevisionData`) and never touches the
 * draft payload, so the learner was being shown the wording the instructor had
 * just replaced. Prose now comes from the same row the ratification decision is
 * recorded on, so there is one decision and one text.
 *
 * One entry per section that HAS a materialised `LESSON` row. A section whose
 * draft carried no lesson never materialises one (see ./project-course.js), so
 * it gets no entry and the reader says nothing about prose that was never
 * written -- as opposed to prose that exists and has not been released.
 *
 * `released` is the only thing said about an unratified lesson, and PENDING and
 * REJECTED are deliberately the same word. The reader has to be able to tell a
 * learner why the page is not full, but which way an instructor is leaning on a
 * passage is the instructor's business, not a learner's.
 *
 * An unreleased entry carries `text: ''` and `citation: null` as a matter of
 * construction rather than of the caller remembering to check `released`: the
 * withheld wording is never put on the wire in the first place.
 *
 * @param {Array} sections  sections as lib/db.js `listDeliveryCourseItems` returns them
 * @returns {Array<{sectionIndex:number,sectionTitle:string,id:string,released:boolean,text:string,citation:object|null}>}
 */
export function projectLearnerLessons(sections) {
  const lessons = [];
  (Array.isArray(sections) ? sections : []).forEach((section, index) => {
    const sectionIndex = Number.isInteger(section?.order) ? section.order : index;
    const row = (Array.isArray(section?.items) ? section.items : [])
      .find((item) => item?.kind === 'LESSON');
    if (!row || typeof row.id !== 'string' || !row.id) return;
    const released = row.status === 'APPROVED';
    lessons.push({
      sectionIndex,
      sectionTitle: typeof section?.title === 'string' ? section.title : '',
      id: row.id,
      released,
      // The row's own text, and the citation resolved for that same row
      // (`sourcePassageIndex` picks the passage the lesson itself best matches,
      // which is strictly more accurate than the section's primary label). The
      // provenance line and the words it vouches for now come from one place,
      // so neither can be true of a version of the lesson the other is not.
      text: released && typeof row.stem === 'string' ? row.stem : '',
      citation: released && row.citation && typeof row.citation === 'object'
        ? { ...row.citation }
        : null,
      // The structured teaching content on the same row (see
      // project-course.js `lessonContent`): released with the prose, withheld
      // with it. A lesson materialised without any is simply `null`.
      content: released && row.options && typeof row.options === 'object' && !Array.isArray(row.options)
        ? { ...row.options }
        : null,
    });
  });
  return lessons;
}
