/**
 * Are two assessment items really the same item?
 *
 * A section carries four items: two pre and two post. The pre pair measures
 * what a learner already knows and the post pair measures what they learned,
 * so the post items must be a PARALLEL FORM -- the same objective, different
 * items -- and not a rewording. When they are a rewording the section has two
 * items pretending to be four, the learner sees the answer minutes before
 * being asked for it again, and the gain score the platform reports measures
 * recall of the pre-test rather than learning.
 *
 * The generator already refuses an exactly repeated stem. The live course
 * shows that is not the test that matters:
 *
 *   pre  "Which statement best describes the purpose of joint doctrine?"
 *   post "Which statement best describes what joint doctrine does?"
 *
 *   pre  "Which set of instruments of national power is identified by the
 *         acronym DIME?"
 *   post "Which statement best describes the four categories named in the
 *         passage as the instruments of national power?"
 *
 * Different strings, same question. So two things are compared instead.
 *
 * THE KEYED ANSWER, first and hardest. Two items keyed to the same answer are
 * the same item whatever their stems look like -- ASTRA's section 3 pair keys
 * to the same four words, and its other pair keys to "the President, with the
 * advice and assistance of the NSC" twice. This is the strong signal and it
 * is nearly free.
 *
 * THE STEM, with the question scaffolding removed. "Which statement best
 * describes" is furniture; every item in the course is built from it, so
 * leaving it in makes unrelated items look alike and hides the real overlap
 * underneath. What is left after removing it is what the item is actually
 * about.
 *
 * Pure and dependency-free, like narration.js and repetition.js beside it.
 */

// Question furniture. These words say an item is a multiple-choice question,
// which is true of every item in the course and therefore distinguishes none
// of them.
const SCAFFOLDING = new Set([
  'which', 'what', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'statement', 'statements', 'option', 'options', 'answer', 'answers', 'choice', 'choices',
  'best', 'most', 'correct', 'true', 'false', 'accurately', 'accurate', 'following', 'follows',
  'describes', 'describe', 'described', 'description', 'identifies', 'identify', 'identified',
  'lists', 'list', 'listed', 'names', 'name', 'named', 'matches', 'match', 'explains', 'explain',
  'according', 'passage', 'lesson', 'text', 'reading', 'above', 'below', 'given',
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'as', 'at', 'by', 'with', 'from', 'that', 'this', 'these', 'those',
  'it', 'its', 'their', 'they', 'you', 'your', 'set', 'sets', 'group', 'groups',
]);

function words(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * What a stem is actually about: its words with the question furniture taken
 * out. Exported so a caller can see what was compared when a pair is refused.
 */
export function stemGist(stem) {
  return new Set(words(stem).filter((word) => !SCAFFOLDING.has(word)));
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  // Against the SMALLER set, not the union. A short stem fully contained in a
  // longer one is the same question asked at greater length, and Jaccard reads
  // that as only half a match because it is punishing the extra words.
  return shared / Math.min(left.size, right.size);
}

/** The keyed answer's words. Empty when the item has no usable key. */
export function keyedAnswer(item) {
  const options = Array.isArray(item?.options) ? item.options : [];
  const index = item?.answer ?? item?.answerIndex;
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return new Set();
  const option = options[index];
  return new Set(words(typeof option === 'string' ? option : option?.text));
}

// Below this a gist or a key is too small to judge: a two-word phrase shares
// one word with half the course by chance.
const MIN_GIST_WORDS = 3;
// Keyed answers. Not equality: the live section 7 pair keys to answers that
// "differ by two words", which is the same answer written twice. Set here
// because an answer is a specific claim and two items making the same claim
// are one item, however the stems are dressed.
const SAME_ANSWER = 0.8;
// Stems, after the furniture comes out. Set high, and deliberately doing less
// work than the key check -- see the note on what this cannot separate.
const SAME_SUBJECT = 0.85;

/**
 * Do these two items ask the same question?
 *
 * Returns a reason string when they do -- so the generator can tell the model
 * WHY a draft item was rejected rather than only that it was -- and '' when
 * they differ.
 */
export function duplicateReason(left, right) {
  const leftKey = keyedAnswer(left);
  const rightKey = keyedAnswer(right);
  if (
    leftKey.size >= MIN_GIST_WORDS &&
    rightKey.size >= MIN_GIST_WORDS &&
    overlap(leftKey, rightKey) >= SAME_ANSWER
  ) {
    return 'it is keyed to the same answer';
  }

  const leftGist = stemGist(left?.stem);
  const rightGist = stemGist(right?.stem);
  if (leftGist.size < MIN_GIST_WORDS || rightGist.size < MIN_GIST_WORDS) return '';
  if (overlap(leftGist, rightGist) >= SAME_SUBJECT) return 'it asks about the same thing';
  return '';
}

/** Convenience predicate over duplicateReason. */
export function isDuplicateItem(left, right) {
  return duplicateReason(left, right) !== '';
}
