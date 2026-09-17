/* Sources grouped by the collection they were uploaded under. Shared by the
   Sources screen, the draft dialog and the course planner. */

const NO_COLLECTION = 'Other documents';

/* Sources grouped by the collection they were uploaded under -- "Lesson plans",
   "Student material" -- with the ungrouped ones last. Order inside a group puts
   what still needs a decision first. */
export function groupSourcesByCollection(sources) {
  const groups = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    const key = source.collection || NO_COLLECTION;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  const named = [...groups.keys()].filter((key) => key !== NO_COLLECTION).sort((a, b) => a.localeCompare(b));
  const keys = groups.has(NO_COLLECTION) ? [...named, NO_COLLECTION] : named;
  return keys.map((name) => {
    const items = groups.get(name);
    const pending = items.filter((source) => source.status !== 'APPROVED');
    const approved = items.filter((source) => source.status === 'APPROVED');
    return { name, sources: [...pending, ...approved], pending, approved };
  });
}
