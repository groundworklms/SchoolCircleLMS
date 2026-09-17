/*
 * One way to say where a claim came from.
 *
 * A citation is stored as a LOCATOR — "<source record id> p.23", built in
 * lib/learning/core.js `sourcePassages` so a citation can open an authenticated
 * page — and a source record id is a cuid. That locator is the addressing
 * contract the SCORM export and the source viewer read, so nothing here
 * rewrites it. It is simply never the thing a human is shown: a primary key is
 * not a citation, to an instructor ratifying a claim or to the learner the
 * citation exists for.
 *
 * These helpers turn a stored citation into the line a person reads, and hand
 * the exact locator back so a caller can keep it one hover away.
 *
 * Pure string work, deliberately in lib/ rather than beside the components that
 * started it: the SCORM export has to print the same line the screens print,
 * and a server/export path cannot import from the App Router client tree.
 * app/_course/provenance.js re-exports these for the client modules that
 * already name it.
 */

/* "<locator> p.23" -> "<locator>". The page travels in its own field as well
   as on the end of the locator, so a line built from both prints it twice. */
export function withoutPage(label) {
  return label.replace(/\s*\bp\.\s*[0-9A-Za-z-]+\s*$/, '').trim();
}

/* A source uploaded as a file is often recorded under its filename, so the
   provenance line came out as "MCWP_2-10.pdf" -- an instructor vouching for a
   passage under a path. The extension comes off and the underscores that stood
   in for spaces become spaces.
 *
 * Presentation only, and deliberately narrow: the extension has to be one of a
 * known set, so an identifier that merely ends in a dotted segment ("TC 3-22.9")
 * is left exactly as recorded, and so is anything with no extension at all
 * ("source-1"). Nothing is written back — `citation.pubId` and the locator on
 * `Item.citation` are what the source viewer and the SCORM export address. */
const DOCUMENT_EXTENSION = /\.(pdf|docx?|txt|md|rtf|html?|epub)$/i;

export function publicationName(name) {
  if (typeof name !== 'string') return '';
  if (!DOCUMENT_EXTENSION.test(name)) return name;
  return name.replace(DOCUMENT_EXTENSION, '').replace(/_+/g, ' ').trim() || name;
}

/**
 * The provenance line, in words rather than keys.
 *
 * `citation.pubId` is the publication name stamped beside the locator at
 * materialisation ("TC 3-22.9") — the same name the Sources screen shows — and
 * `citation.page` is the page already parsed out of the locator. The line is
 * built from those two; the locator comes back as `locator` so a caller can
 * keep the exact string on record one hover away.
 *
 * A bare string is accepted because the generated-course reader and the
 * instructor preview both hand a section's raw `cite` label straight through.
 * With no name to use, the locator is the only thing left and is returned
 * unchanged — that is the pre-existing behaviour, and the surfaces that must
 * never show a key resolve the name before calling (see CourseReader).
 */
export function provenanceOf(citation) {
  const value = typeof citation === 'string' ? { citation } : citation;
  const raw = typeof value?.citation === 'string' ? value.citation : value?.label;
  const locator = typeof raw === 'string' ? raw.trim() : '';
  const pubId = typeof value?.pubId === 'string' ? value.pubId.trim() : '';
  const page = value?.page === null || value?.page === undefined ? '' : String(value.page).trim();
  // Take the page off the locator only when this line is about to print it;
  // a row with no page field keeps whatever its label already says.
  const name = publicationName(pubId || (page ? withoutPage(locator) : locator) || locator);
  if (!name) return null;
  return { text: page ? `${name} p.${page}` : name, locator: locator || null };
}

/* A section `cite` carries its page on the end of the locator and nowhere else
   (lib/learning/project-course.js parses it the same way). Reading it back out
   is what lets a reader print "p.85" beside a publication name. */
export function pageOf(locator) {
  const match = /\bp\.\s*([0-9A-Za-z-]+)/.exec(typeof locator === 'string' ? locator : '');
  return match ? match[1] : null;
}
