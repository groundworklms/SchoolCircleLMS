/**
 * Terms that drifted from the source.
 *
 * Section 5 of the reviewed course says "combat commanders" four times where
 * the passage says COMBATANT commanders. Those are different things: a
 * combatant commander is a specific office with a statutory basis, and "combat
 * commander" is not a term at all. Nothing in the pipeline caught it, and
 * nothing would have, because the sentence is grounded -- "combat" and
 * "commanders" both appear in the passage, so token overlap is satisfied by
 * the words that are there while the term they were supposed to form is not.
 *
 * That is the general shape, and it is why this is not a spelling check. The
 * defect is a near-miss of a term the source uses: near enough that a grounding
 * score cannot see the difference, far enough that a learner is taught a word
 * that does not exist and will use it in front of someone who notices.
 *
 * So the source is asked what its terms ARE, rather than a list being written
 * here. A fixed glossary would be a guess about which publication an instructor
 * uploaded, would be wrong the first time someone uploaded a manual from
 * another service, and would need maintaining forever. The passage already
 * contains the answer.
 *
 * Only multi-word terms are checked. A single word drifting is usually a
 * synonym and often an improvement; it is a phrase like "combatant commander"
 * that has a fixed form, and it is a phrase that a model rebuilds slightly
 * wrong when it is writing from memory of the passage rather than from the
 * passage.
 *
 * Pure and dependency-free.
 */

function words(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Words too common to anchor a term. A phrase built only from these is not a
// term, it is a sentence fragment.
const COMMON = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'from', 'as', 'at', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this', 'these', 'those', 'it', 'its', 'they',
  'their', 'which', 'who', 'what', 'when', 'where', 'how', 'all', 'each', 'any', 'one', 'two',
  'not', 'but', 'so', 'if', 'then', 'than', 'also', 'may', 'can', 'will', 'must', 'should',
]);

// Terms are compared as pairs of adjacent words. Two is enough to catch
// "combatant commander" becoming "combat commander" and short enough that a
// long phrase is covered by the pairs inside it.
function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    if (COMMON.has(list[i]) || COMMON.has(list[i + 1])) continue;
    out.push([list[i], list[i + 1]]);
  }
  return out;
}

const key = (pair) => pair.join(' ');

/**
 * How close two words are, as the share of one that the other contains in
 * order. Cheap prefix-based similarity rather than an edit distance: the drift
 * this catches is a word being truncated or lengthened at the end ("combatant"
 * to "combat", "operational" to "operation"), which a shared prefix measures
 * directly.
 */
function closeness(left, right) {
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let shared = 0;
  while (shared < shorter.length && shorter[shared] === longer[shared]) shared += 1;
  return shared / longer.length;
}

// A drifted word shares most of its spelling with the right one. Below this
// they are simply different words and the writer meant a different thing.
const NEAR = 0.6;

// The same word in a different number or tense. Checked as an explicit set of
// endings rather than by how similar the two are, because similarity cannot
// tell these apart from the drift itself: "commander"/"commanders" differ by
// one letter and are one term, while "operation"/"operational" also differ by
// a short ending and are two. Only plural and verb forms count; "-al", "-ant"
// and "-ion" change what a word means.
const INFLECTION = /^(?:s|es|d|ed|ing)$/;

function sameWord(left, right) {
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return longer.startsWith(shorter) && INFLECTION.test(longer.slice(shorter.length));
}

/**
 * Terms in `text` that look like a near-miss of a term in `source`.
 *
 * Returns `[{ used, source }]`, naming both, so a reviewer can see the
 * substitution rather than being told something is wrong.
 */
export function driftedTerms(text, source) {
  const used = pairs(words(text));
  if (!used.length) return [];
  const known = new Map();
  for (const pair of pairs(words(source))) known.set(key(pair), pair);
  if (!known.size) return [];

  const drifted = [];
  const seen = new Set();
  for (const pair of used) {
    const literal = key(pair);
    // The passage uses this exact phrase, so there is nothing to report.
    if (known.has(literal) || seen.has(literal)) continue;
    for (const [, candidate] of known) {
      // One word must match exactly and the other must be a near-miss. Both
      // drifting at once is two different words, not a drifted term.
      const headSame = candidate[0] === pair[0];
      const tailSame = candidate[1] === pair[1];
      if (headSame === tailSame) continue;
      const [mine, theirs] = headSame ? [pair[1], candidate[1]] : [pair[0], candidate[0]];
      if (sameWord(mine, theirs)) continue;
      if (closeness(mine, theirs) < NEAR) continue;
      drifted.push({ used: literal, source: key(candidate) });
      seen.add(literal);
      break;
    }
  }
  return drifted;
}
