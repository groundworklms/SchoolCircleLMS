/**
 * The project's one notion of "does this text come from that passage".
 *
 * This lived inside lib/arsenal-core.js as `groundingTokens`/`groundingPasses`
 * and is the floor `validateCourseDraft` applies before a draft may cross the
 * approval boundary. Materialisation now needs the same question asked per
 * item (which of a section's cited passages does this item actually come
 * from), and two different overlap notions would mean an item could pass the
 * validator against one passage and be cited to another. So it moves here
 * rather than being duplicated: one definition, two callers.
 *
 * It is deliberately deterministic and model-free. No import of lib/model.js
 * or Prisma belongs in this file -- lib/db.js reaches project-course.js on the
 * import path, and arsenal-core.js reaches lib/db.js through the model
 * settings, so a materialiser that imported arsenal-core directly would close
 * an import cycle. A leaf module with no dependencies cannot.
 */

const GROUNDING_STOP_WORDS = new Set(
  'a an the of to and or in on for with by is are be as at from that this it its into'.split(' '),
);

/** The distinct, meaningful lowercase tokens of a piece of text. */
export function groundingTokens(value) {
  return [
    ...new Set(
      String(value ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !GROUNDING_STOP_WORDS.has(word)),
    ),
  ];
}

/**
 * How much of `text` is accounted for by `source`: how many of the text's
 * distinct tokens it holds, out of how many, and the fraction.
 *
 * `overlap` is exactly the quantity `groundingPasses` thresholds. The counts
 * come with it because ranking one passage against another needs to know how
 * much text the fraction was measured over -- on a nine-token sentence a
 * single word is eleven per cent, which is a difference in arithmetic and not
 * in provenance. Empty text scores 0 rather than 1: nothing is not grounded.
 */
export function groundingScore(text, source) {
  const textTokens = groundingTokens(text);
  const sourceTokens = new Set(groundingTokens(source));
  const matched = textTokens.filter((token) => sourceTokens.has(token)).length;
  return {
    tokens: textTokens.length,
    matched,
    overlap: textTokens.length ? matched / textTokens.length : 0,
  };
}

/** The fraction of `text`'s distinct tokens that appear in `source`, 0..1. */
export function groundingOverlap(text, source) {
  return groundingScore(text, source).overlap;
}

export function groundingPasses(text, source, threshold = 0.4) {
  const { tokens, overlap } = groundingScore(text, source);
  return tokens > 0 && overlap >= threshold;
}

/** The floor `groundingPasses` applies by default, named for callers that rank. */
export const GROUNDING_THRESHOLD = 0.4;
