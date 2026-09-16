/* Pure mapping for instructor and learner course list responses. Keeping this
   separate lets navigation tests exercise legacy-course discovery without
   importing React hooks or the auth provider. */

export function courseFromRecord(entry, source = 'learning') {
  const manual = source === 'manual' || entry?.type === 'MANUAL_COURSE';
  const draft = entry?.draft && typeof entry.draft === 'object' ? entry.draft : null;
  const title = entry?.title || draft?.title || 'Untitled course';
  const hasPendingRevision = Boolean(entry?.hasPendingRevision);
  const sections = Number.isInteger(entry?.sections)
    ? entry.sections
    : (Array.isArray(draft?.lessons) ? draft.lessons.length : 0);
  return {
    id: entry.id,
    name: title,
    school: manual
      ? `Legacy manual course · ${entry.status === 'PUBLISHED' ? 'Published' : 'Draft'}`
      : hasPendingRevision
        ? `${entry.status === 'APPROVED' ? 'Published' : 'Draft'} · revision needs review`
        : entry.status === 'APPROVED' ? 'Published · cited course' : 'Draft · needs review',
    status: entry.status,
    hasPendingRevision,
    sections,
    sourceIds: entry.sourceIds || [],
    manual,
    courseType: manual ? 'MANUAL_COURSE' : 'COURSE_DRAFT',
    record: { ...entry, type: entry.type || (manual ? 'MANUAL_COURSE' : 'COURSE_DRAFT') },
  };
}
