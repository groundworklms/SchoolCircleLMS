/**
 * A title is a claim about what is inside.
 *
 * The reviewed course has a section titled "Human performance and bias". The
 * word "bias" appears exactly once in the entire course -- in that title. No
 * bias content on the page, no bias item, nothing about bias in the cited
 * passage. The title was either carried over from a different course or
 * generated from an objective that was never fulfilled, and either way a
 * learner opening that section is promised something the section does not
 * contain.
 *
 * The course title has the same defect one level up: "Learning, National
 * Defense, Joint Operations, and Readiness" reads as four courses stapled
 * together, generated from a cluster of section topics rather than written as
 * a scope.
 *
 * Nothing in the pipeline checked either. Every other artifact has to earn its
 * place against the source, and the title -- the one line most learners read
 * before deciding what a section is about -- was taken on trust.
 *
 * So a title's content words are checked against what the section actually
 * contains. A word that appears NOWHERE in the section's lesson, pages, items
 * or objective is a promise nothing keeps.
 *
 * Conservative by construction, because a title is a summary and summarising
 * means choosing words the body does not use. Only the whole-word absence of a
 * content word counts. A title whose every word appears somewhere is left
 * alone even if the emphasis is off, since that is an editorial judgement and
 * this is a factual one.
 *
 * Pure and dependency-free apart from `pageText`.
 */

import { pageText } from './page-support.js';

// Words a title uses to join its content words together. A title is short, so
// this list is short: anything that is not structural is treated as a claim.
const TITLE_STRUCTURE = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'from', 'as', 'at',
  'by', 'its', 'their', 'this', 'that', 'these', 'those', 'into', 'about', 'between', 'across',
  'within', 'through', 'under', 'over', 'is', 'are', 'was', 'were', 'be', 'you', 'your',
  'introduction', 'overview', 'fundamentals', 'basics', 'principles', 'concepts', 'topics',
  'part', 'section', 'module', 'lesson', 'unit', 'chapter', 'course',
]);

// Words shorter than this carry too little to insist on. Three rather than
// four, because "war", "air" and "fog" are all real subjects and a four-letter
// floor drops them silently -- which is the same class of mistake as not
// checking the title at all.
const MIN_TITLE_WORD = 3;

function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Endings a simple inflection adds. Stripped from both sides so the comparison
// is symmetric: "planning" in a title is delivered by "planners" in the body,
// and neither is a prefix of the other.
const INFLECTION = /(?:ings?|ers?|ors?|ions?|edly|ed|es|s|ly|al)$/;

/**
 * A word reduced to something two inflections of it share. Deliberately crude
 * -- one pass, no dictionary -- and floored at three characters so it cannot
 * collapse short words into each other.
 */
function stem(word) {
  // Repeated until stable, because one pass does not reach a common form:
  // "biases" loses "es" to give "bias", and "bias" loses "s" to give "bia", so
  // a single pass leaves the two a step apart and the words look unrelated.
  let current = word;
  for (;;) {
    const stripped = current.replace(INFLECTION, '');
    if (stripped === current || stripped.length < 3) return current;
    current = stripped;
  }
}

/**
 * Does the body deliver this title word?
 *
 * Exact first, then on the shared stem, so "bias" is satisfied by "biases" and
 * "planning" by "planners". Never on a bare prefix: "war" is not delivered by
 * "warrant", and a check that thought it was would be worse than no check,
 * because it would pass silently on exactly the titles worth questioning.
 */
function appears(word, body) {
  if (body.has(word)) return true;
  const wanted = stem(word);
  for (const candidate of body) {
    if (stem(candidate) === wanted) return true;
  }
  return false;
}

/** Everything a section says, title excluded. */
export function sectionBody(section) {
  const parts = [pageText(section), section?.lesson, section?.objective];
  for (const phase of ['pre', 'post']) {
    for (const item of Array.isArray(section?.[phase]) ? section[phase] : []) {
      parts.push(item?.stem, item?.rationale);
      for (const option of Array.isArray(item?.options) ? item.options : []) {
        parts.push(typeof option === 'string' ? option : option?.text);
      }
    }
  }
  for (const card of Array.isArray(section?.flashcards) ? section.flashcards : []) {
    parts.push(card?.front, card?.back);
  }
  return parts.filter((value) => typeof value === 'string' && value.trim()).join(' ');
}

/**
 * The words a title promises that its section never delivers.
 *
 * Returns `[]` for a section with no content yet: a title cannot be checked
 * against nothing, and reporting every word would be noise.
 */
export function titleWordsNotTaught(section) {
  const title = normalise(section?.title);
  if (!title) return [];
  const body = new Set(normalise(sectionBody(section)).split(' ').filter(Boolean));
  if (body.size === 0) return [];
  const missing = [];
  for (const word of title.split(' ')) {
    if (!word || word.length < MIN_TITLE_WORD || TITLE_STRUCTURE.has(word)) continue;
    if (appears(word, body)) continue;
    if (!missing.includes(word)) missing.push(word);
  }
  return missing;
}

/**
 * The same question for the course title, answered against every section.
 *
 * A course title is allowed to be more abstract than any one section -- that
 * is what a scope is -- so it is checked against the whole course, and only a
 * word no section anywhere uses is reported.
 */
export function courseTitleWordsNotTaught(course) {
  const title = normalise(course?.title);
  if (!title) return [];
  const sections = Array.isArray(course?.sections) ? course.sections : [];
  const body = new Set(
    normalise(sections.map((section) => `${section?.title || ''} ${sectionBody(section)}`).join(' '))
      .split(' ')
      .filter(Boolean),
  );
  if (body.size === 0) return [];
  const missing = [];
  for (const word of title.split(' ')) {
    if (!word || word.length < MIN_TITLE_WORD || TITLE_STRUCTURE.has(word)) continue;
    if (appears(word, body)) continue;
    if (!missing.includes(word)) missing.push(word);
  }
  return missing;
}
