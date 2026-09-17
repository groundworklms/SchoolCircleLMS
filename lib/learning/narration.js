/**
 * Narration -- prose that is about the lesson instead of about its subject.
 *
 * "The lesson says that leaders are responsible for the learning environment"
 * and "The lesson is built to cover what learning means to Marines" are both
 * true, both grounded, and both worthless: a learner who reads them has been
 * told a lesson exists and nothing else.
 *
 * The grounding check cannot catch this, and it is worth being exact about
 * why. Grounding asks whether a block's words overlap the passage it cites. A
 * sentence that narrates a passage reuses that passage's own vocabulary, so it
 * scores as well as -- often better than -- a sentence that teaches the same
 * material. Narration clears the floor honestly. Grounding is a check on
 * truthfulness; narration is not untruthful, it is empty, and it needs its own
 * check.
 *
 * This module is pure and dependency-free on purpose: the generator applies it
 * when it writes pages, and the lesson player applies it when it falls back to
 * splitting the micro-lesson, so it has to be safe to load on the client.
 */

// The subjects that can mean nothing but the artifact. "Section", "chapter"
// and "document" are deliberately absent: doctrine really does have sections
// and chapters, and a sentence about one is usually teaching. The two errors
// are not symmetric -- a missed narration costs a dull sentence, a false
// positive deletes a true one -- so the list stays narrow.
const SUBJECT = 'lesson|course|module|page|slide|passage|excerpt|reading';

// Verbs of exposition: what a document does to a reader rather than what a
// thing does in the world.
const EXPOSITION =
  'say|state|begin|start|open|explain|describe|introduce|cover|tell|show|expose|discuss|' +
  'outline|emphasi[sz]e|note|mention|highlight|present|teach|focus|define|list|detail|' +
  'address|explore|examine|walk|remind|stress|conclude|end|aim|seek|intend|serve|organi[sz]e|' +
  'structure|sequence|prepare|equip|build|place|situate|frame|group|divide|link|offer|give|' +
  'provide|help|ask|expect|require|assume|close|finish|continue|summari[sz]e|review|recap|' +
  'restate|repeat|trace|follow|compare|contrast|consider|turn';

// Copulas and auxiliaries, which carry the same narration with a participle
// behind them: "The lesson IS BUILT to cover...", "The lesson IS ORGANIZED in
// a sequence...". Both were observed verbatim in the 2026-09-17 generation and
// neither has an exposition verb in the subject position.
const AUXILIARY = 'is|are|was|were|has|have|had|will|would|can|could|should|may|might|must|does|do|did';

const ADVERB = String.raw`(?:also\s+|then\s+|next\s+|further\s+|first\s+|finally\s+|now\s+|already\s+|briefly\s+|\w+ly\s+)?`;

const PATTERNS = [
  new RegExp(
    String.raw`\b(?:this|that|the|these|those)\s+(?:${SUBJECT})s?\s+` +
      ADVERB +
      String.raw`(?:(?:${EXPOSITION})(?:s|es|ed|ing)?|(?:${AUXILIARY}))\b`,
    'i',
  ),
  new RegExp(String.raw`\baccording to (?:this|the)\s+(?:${SUBJECT})\b`, 'i'),
  new RegExp(
    String.raw`\bas (?:this|the)\s+(?:${SUBJECT})\s+(?:${EXPOSITION})(?:s|es|ed|ing)?\b`,
    'i',
  ),
  /\byou (?:will|'ll) be (?:exposed|introduced) to\b/i,
];

/**
 * True when the text narrates the lesson rather than teaching its subject.
 * Pure, so the same prose always survives or falls the same way.
 */
export function narratesTheLesson(value) {
  const subject = typeof value === 'string' ? value : '';
  if (!subject.trim()) return false;
  return PATTERNS.some((pattern) => pattern.test(subject));
}

/**
 * Drop the narrating sentences from a paragraph, keeping the teaching ones.
 *
 * The block-level drop in the page writer has a cliff: a page that is entirely
 * narration disappears, and the player falls back to splitting the section's
 * micro-lesson -- which, on a section built from a chapter introduction, is
 * the same narration again. Filtering sentence by sentence degrades instead:
 * a paragraph that is half blurb and half doctrine keeps the doctrine.
 *
 * Takes and returns the sentence array the caller already split, so the two
 * stay in step on what counts as a sentence.
 */
export function withoutNarration(sentences) {
  const list = Array.isArray(sentences) ? sentences : [];
  const kept = list.filter((sentence) => !narratesTheLesson(sentence));
  // If every sentence narrates there is nothing to teach here, and saying so
  // by returning nothing is better than showing the blurb as though it were a
  // lesson. The caller decides what an empty lesson looks like.
  return kept;
}
