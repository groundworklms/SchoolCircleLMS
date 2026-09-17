/**
 * Can a learner answer this item from the pages they were actually shown?
 *
 * Every item in a generated course is already checked against the passage its
 * section cites. That is the right check for truthfulness and it is the wrong
 * check for fairness, because THE LEARNER NEVER SEES THE PASSAGE. They see the
 * lesson pages, and the pages are a subset of the passage: `groundLessonPages`
 * drops every block the passage cannot support, every block that narrates the
 * lesson, and every block restating an earlier one. Whatever is left is the
 * course, as far as the learner is concerned.
 *
 * So an item can be perfectly grounded and still unanswerable. The live course
 * is full of this:
 *
 *   - a rationale reading "The passage states that the Coast Guard is a unique
 *     Military Service residing within the Department of Homeland Security",
 *     on a page that never mentions the Coast Guard;
 *   - a stem citing "the Goldwater-Nichols DoD Reorganization Act of 1986" on
 *     a page that says only "the act and later reforms";
 *   - an item calling the National Military Strategy "classified" where the
 *     page applies that word to a different document.
 *
 * A diligent learner who read the page carefully gets these wrong. That is the
 * defect, and it is invisible to a passage-level check by construction.
 *
 * WHAT THIS IS FOR. A shortfall here is a statement about the PAGE, not about
 * the item: the item knows something the page forgot to teach. So it is
 * recorded and surfaced for review rather than deleted. Dropping the item
 * would hide the evidence that the page is underwritten, which is the opposite
 * of what the signal is worth -- and the same reasoning the generator already
 * applies when it keeps a partly-built course and names what is missing.
 *
 * Pure and dependency-free apart from the shared grounding score.
 */

import { groundingScore } from './grounding.js';

/** Every string a learner can read on a section's pages. */
export function pageText(section) {
  const pages = Array.isArray(section?.pages) ? section.pages : [];
  const parts = [];
  for (const page of pages) {
    if (typeof page?.title === 'string') parts.push(page.title);
    for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
      if (!block || typeof block !== 'object') continue;
      for (const value of [block.title, block.text, block.result]) {
        if (typeof value === 'string') parts.push(value);
      }
      const entries = Array.isArray(block.entries)
        ? block.entries
        : Array.isArray(block.items)
          ? block.items
          : [];
      for (const entry of entries) {
        if (Array.isArray(entry)) parts.push(...entry.filter((value) => typeof value === 'string'));
        else if (entry && typeof entry === 'object') {
          for (const value of [entry.title, entry.text, entry.body]) {
            if (typeof value === 'string') parts.push(value);
          }
        } else if (typeof entry === 'string') parts.push(entry);
      }
      if (Array.isArray(block.steps)) parts.push(...block.steps.filter((value) => typeof value === 'string'));
    }
  }
  // The intro is on screen too, ahead of the pages.
  if (typeof section?.intro === 'string') parts.push(section.intro);
  return parts.join(' ');
}

/**
 * What an item asserts, from the learner's side: the stem, the keyed answer,
 * and the rationale that explains it. Distractors are deliberately left out --
 * a good distractor is plausible and WRONG, so it has no business being
 * supported by the page, and requiring it to be would push the generator
 * toward distractors nobody would pick.
 */
export function itemClaim(item) {
  const options = Array.isArray(item?.options) ? item.options : [];
  const index = item?.answer ?? item?.answerIndex;
  const keyed = Number.isInteger(index) && index >= 0 && index < options.length ? options[index] : '';
  const answer = typeof keyed === 'string' ? keyed : keyed?.text;
  return [item?.stem, answer, item?.rationale]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
}

// Deliberately below the 0.4 floor the page blocks themselves had to clear.
// An item is a question ABOUT the page, not an extract of it, so it carries
// interrogative words the page has no reason to contain, and a parallel-form
// stem is mostly connective language by design. This is a check for an item
// that is about something else entirely -- the Coast Guard on a page about the
// Department of the Navy -- and not a style check on how closely an item
// echoes the prose.
export const PAGE_SUPPORT_THRESHOLD = 0.25;

/**
 * The items a section's own pages cannot support.
 *
 * Returns `[]` when the section has no pages: a section still on its
 * micro-lesson has nothing to measure against, and reporting every one of its
 * items as unsupported would bury the real signal. The publish gate already
 * refuses a course with unwritten pages, which is the check that belongs
 * there.
 */
export function itemsBeyondPages(section, { threshold = PAGE_SUPPORT_THRESHOLD } = {}) {
  const source = pageText(section);
  if (!source.trim()) return [];
  const beyond = [];
  for (const phase of ['pre', 'post']) {
    const items = Array.isArray(section?.[phase]) ? section[phase] : [];
    for (const [index, item] of items.entries()) {
      const claim = itemClaim(item);
      if (!claim.trim()) continue;
      const { tokens, overlap } = groundingScore(claim, source);
      if (tokens > 0 && overlap >= threshold) continue;
      beyond.push({
        phase,
        index,
        stem: typeof item?.stem === 'string' ? item.stem : '',
        overlap: Number(overlap.toFixed(3)),
      });
    }
  }
  return beyond;
}

/*
 * The overlap score above catches an item that is about something else
 * entirely -- the Coast Guard on a page about the Department of the Navy. It
 * cannot catch an item that is almost entirely on-page and asserts ONE thing
 * that is not, because one term out of forty barely moves a ratio:
 *
 *   page  "Under the act and later reforms, the Service Chiefs are
 *          responsible for organizing, training and equipping their forces."
 *   item  "Under the GOLDWATER-NICHOLS DOD REORGANIZATION ACT OF 1986, what is
 *          the primary responsibility of the Service Chiefs?"
 *
 * Everything except the name is on the page, so the item scores well and the
 * learner still cannot verify the one clause the question turns on.
 *
 * So a second, narrower signal: the DISTINCTIVE TERMS an item uses that the
 * page never mentions. Proper names, acronyms and years are the marks of a
 * specific claim -- a learner can check them or they cannot. Ordinary words
 * are left alone, because paraphrase is what a good item does.
 *
 * This also answers a finding of its own: an acronym used in an item and never
 * expanded anywhere the learner can see is the same defect wearing a different
 * hat.
 */

// A capitalised name of one or more words ("Goldwater-Nichols", "National
// Military Strategy"), an all-caps acronym of 2-6 letters, or a four-digit
// year. Sentence-initial capitals are handled by the stop list below.
const DISTINCTIVE = /\b(?:[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)*|[A-Z]{2,6}|(?:1[6-9]|20)\d{2})\b/g;

// Words that begin sentences and question stems constantly, and carry no claim
// on their own.
const COMMON_CAPITAL = new Set([
  'the', 'a', 'an', 'which', 'what', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'their', 'under', 'according', 'in',
  'on', 'at', 'to', 'for', 'and', 'or', 'but', 'if', 'as', 'by', 'with', 'from', 'both',
  'all', 'each', 'every', 'none', 'one', 'two', 'three', 'four', 'first', 'second', 'third',
  'true', 'false', 'best', 'most', 'only', 'other', 'another', 'select', 'choose', 'identify',
]);

function normaliseTerm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The distinctive terms in a piece of text, normalised and de-duplicated. */
export function distinctiveTerms(value) {
  const found = new Map();
  for (const match of String(value ?? '').matchAll(DISTINCTIVE)) {
    // The match is greedy across consecutive capitals, so a sentence-initial
    // "The" or "Which" gets glued onto the term after it ("Which NME",
    // "Defense The NME"). Splitting on those words separates the furniture
    // from the claim instead of discarding the whole phrase.
    let run = [];
    const parts = [];
    for (const word of match[0].trim().split(/\s+/)) {
      if (COMMON_CAPITAL.has(normaliseTerm(word))) {
        if (run.length) parts.push(run);
        run = [];
      } else {
        run.push(word);
      }
    }
    if (run.length) parts.push(run);

    for (const part of parts) {
      const raw = part.join(' ');
      const key = normaliseTerm(raw);
      if (!key) continue;
      // A lone capitalised ordinary word is sentence case, not a name. An
      // acronym, a year, a hyphenated name or a multi-word phrase is neither.
      if (
        part.length === 1 &&
        !/^[A-Z]{2,6}$/.test(raw) &&
        !/^\d{4}$/.test(raw) &&
        !/[-’']/.test(raw)
      ) {
        continue;
      }
      if (!found.has(key)) found.set(key, raw);
    }
  }
  return found;
}

/**
 * The distinctive terms an item asserts that the section's pages never
 * mention. A term counts as mentioned when its normalised form appears
 * anywhere in the page text, so "Goldwater-Nichols" is satisfied by the page
 * writing it any way at all, and only genuine absence is reported.
 */
export function termsNotOnPage(item, section) {
  const source = ` ${normaliseTerm(pageText(section))} `;
  if (!source.trim()) return [];
  const missing = [];
  for (const [key, raw] of distinctiveTerms(itemClaim(item))) {
    if (source.includes(` ${key} `)) continue;
    missing.push(raw);
  }
  return missing;
}
