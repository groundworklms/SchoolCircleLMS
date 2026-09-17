/**
 * Citation matching -- turning a saved section's citation label back into the
 * passage it names.
 *
 * A label is written by a model and read back weeks later, so it arrives in
 * whatever shape the generation left it: "AY27 Coursebook p.67", "AY27
 * Coursebook p. 67", "AY27 Coursebook page 67". Those are the same citation
 * and an exact string compare says they are not.
 *
 * The important property is what happens when a label does NOT resolve. The
 * answer is nothing: no passage, and the caller refuses the section. Widening
 * to a larger body of text is the one thing this must never do, because the
 * grounding check downstream asks whether the generated prose overlaps "the
 * passage" -- hand it the whole corpus and it is asking whether the prose
 * overlaps anything the instructor ever approved, which everything does.
 *
 * Ambiguity refuses for the same reason. If two sources could be meant, the
 * honest answer is that the citation does not identify one.
 *
 * Pure and dependency-free.
 */

/**
 * A citation reduced to comparable tokens. Page abbreviations are unified, so
 * "p.67", "p. 67", "pg 67" and "page 67" all come out as "p 67", and
 * everything that is not a letter or digit becomes a separator.
 */
export function citationKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\b(?:pages?|pgs?|pp)\b/g, 'p')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Is `needle` a run of whole tokens inside `haystack`? */
function containsTokens(haystack, needle) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * The entries a citation names, in corpus order.
 *
 * Exact key match first. Failing that, an entry whose key contains the
 * citation's tokens (or the reverse -- a label may be recorded shorter or
 * longer than the source it came from). Containment is only accepted when
 * exactly one entry matches: two candidates means the citation does not
 * identify one, and guessing is how a lesson ends up written from a page it
 * does not cite.
 */
export function entriesForCitation(entries, cite) {
  const list = Array.isArray(entries) ? entries : [];
  const wanted = (Array.isArray(cite) ? cite : [cite])
    .map((value) => citationKey(value))
    .filter(Boolean);
  if (!list.length || !wanted.length) return [];

  const keyed = list.map((entry) => ({ entry, key: citationKey(entry?.source) }));
  const hits = [];
  for (const want of wanted) {
    const exact = keyed.filter((candidate) => candidate.key === want);
    if (exact.length) {
      hits.push(...exact.map((candidate) => candidate.entry));
      continue;
    }
    const near = keyed.filter(
      (candidate) => containsTokens(candidate.key, want) || containsTokens(want, candidate.key),
    );
    if (near.length === 1) hits.push(near[0].entry);
  }
  // Keep corpus order and drop repeats, so a section citing the same page
  // twice reads it once.
  return list.filter((entry) => hits.includes(entry));
}
