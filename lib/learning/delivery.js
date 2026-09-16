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