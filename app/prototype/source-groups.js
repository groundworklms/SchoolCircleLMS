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

/* Uploaded documents keep their raw filename as a title: underscores for
   spaces, a stray space before a suffix, an extension already stripped by the
   uploader. The stored title stays the real, addressable value -- rename and
   delete act on it -- so this is a DISPLAY-ONLY tidy that lets a shelf of a
   hundred lesson PDFs read as words instead of paths. It only collapses
   separators; casing is left alone, because "BE0108" and other codes are not
   ours to re-case. */
export function cleanSourceLabel(title) {
  const text = String(title || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || 'Untitled source';
}

/* Does a source match a free-text filter? Matched against the cleaned label the
   instructor actually sees and the citation id they may know it by, both folded
   to lower case. An empty query matches everything so the caller can filter
   unconditionally. */
export function sourceMatchesQuery(source, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    cleanSourceLabel(source?.title),
    source?.sourceId || '',
    source?.collection || '',
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}
