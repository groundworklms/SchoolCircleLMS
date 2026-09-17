/**
 * Repetition -- prose the learner has already read.
 *
 * A generated course repeats itself in two different ways, and they need two
 * different remedies.
 *
 * WITHIN a section the model restates itself: the 2026-09-17 generation put
 * "the combat commanders are responsible for the planning and execution of
 * joint operations" in two consecutive paragraphs, and elsewhere ran two
 * paragraphs that both opened "This matters because" and then said
 * substantially the same thing. That is a duplicate, and a duplicate can be
 * dropped outright -- nothing is lost, because the learner already read it.
 *
 * ACROSS sections the model reaches for the same frame every time. "This
 * matters because" opened a paragraph in nearly every section of that course,
 * with "Taken together", "The key idea is" and "A common error is to" closing
 * them. None of those paragraphs is a duplicate; each says something true and
 * different. Dropping them would delete real teaching. The remedy is upstream:
 * sections are written one at a time, so each one can be told which openings
 * the course has already spent.
 *
 * Pure and dependency-free, like narration.js next door.
 */

const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'in',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'them', 'these', 'they', 'this',
  'to', 'was', 'were', 'which', 'with', 'you', 'your',
]);

function tokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Sentences, keeping their trailing punctuation and spacing. */
export function sentencesOf(value) {
  const body = String(value ?? '');
  if (!body.trim()) return [];
  return body.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [body];
}

/**
 * The normalised opening of a paragraph -- the phrase a reader recognises as
 * "here we go again". Stop words are kept, because the frame is made of them:
 * "this matters because" is three stop words and a conjunction.
 */
export function openingPhrase(value, words = 4) {
  const list = tokens(value);
  if (list.length < words) return '';
  return list.slice(0, words).join(' ');
}

// Below this many content words a sentence is too short to judge. "This is
// required." and "The answer is no." legitimately recur.
const MIN_CONTENT_WORDS = 6;
// Jaccard over content words. Set high: the cost of a false positive is a
// deleted sentence that was actually saying something new.
const SIMILAR = 0.8;

function contentWords(value) {
  return new Set(tokens(value).filter((word) => !STOP.has(word)));
}

/** Do two sentences say the same thing? Symmetric, and false for short ones. */
export function tooSimilar(a, b) {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size < MIN_CONTENT_WORDS || right.size < MIN_CONTENT_WORDS) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = left.size + right.size - shared;
  return union > 0 && shared / union >= SIMILAR;
}

/**
 * A running memory of what a section has already said.
 *
 * Held by the caller and passed down the section's pages in order, so a
 * paragraph on page 4 is checked against every paragraph before it rather
 * than only against its neighbour -- the repetition ASTRA found was in
 * consecutive paragraphs, but nothing makes that the only place it happens.
 */
export function createSectionProse() {
  const seen = [];
  return {
    /** True when this sentence repeats one already kept, and it is not kept. */
    isRepeat(sentence) {
      return seen.some((earlier) => tooSimilar(earlier, sentence));
    },
    remember(sentence) {
      seen.push(sentence);
    },
    /**
     * Drop the sentences of a paragraph that repeat something already said,
     * remembering the ones that survive. Returns the trimmed paragraph, or ''
     * when the whole paragraph was a restatement.
     */
    keepNew(paragraph) {
      const kept = [];
      for (const sentence of sentencesOf(paragraph)) {
        if (!sentence.trim()) continue;
        if (this.isRepeat(sentence)) continue;
        this.remember(sentence);
        kept.push(sentence);
      }
      return kept.join('').trim();
    },
  };
}
