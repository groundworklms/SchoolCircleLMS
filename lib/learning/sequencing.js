/**
 * What order the sections of a course should be read in.
 *
 * The reviewed course ran its cited pages 2, 5, 6, 7, 27, 121, 67, 124, 67,
 * 131, 54. That follows neither the publication nor any learning progression:
 * it is the order the outline happened to emit its objectives in, which is the
 * order a model happened to write a list. A learner working through it is sent
 * back and forth through the manual for no reason, and a section that depends
 * on one thirty pages later arrives first.
 *
 * A publication is written to be read in order. When the outline has no order
 * of its own, the source's is the best one available and it is free.
 *
 * WHEN NOT TO DO THIS, which is the whole difficulty. Two orders in this
 * system ARE deliberate, and re-sorting would destroy them:
 *
 *   - An instructor who typed objectives into the box wrote them in the order
 *     they want them taught. That is the most explicit instruction the system
 *     ever receives about sequence.
 *   - A program of instruction ENUMERATES its lessons, and the outline prompt
 *     is told in capitals to follow its structure and order. A POI's order is
 *     the schoolhouse's own, and rearranging it would be rearranging the
 *     syllabus.
 *
 * So this reorders only what nobody ordered: an outline the model wrote from
 * prose. Everything else is left exactly as it arrived.
 *
 * Pure and dependency-free apart from the shared page parser.
 */

import { pageOf } from '../provenance.js';

/**
 * A cited page as a number, for comparison. Returns null for anything that is
 * not a plain page number -- "A-3", "iv", a missing citation -- because a
 * course mixing those with digits has no single order and guessing one is
 * worse than leaving it alone.
 */
export function pageNumber(cite) {
  const page = pageOf(typeof cite === 'string' ? cite : '');
  if (!page || !/^\d+$/.test(page)) return null;
  const value = Number(page);
  return Number.isFinite(value) ? value : null;
}

/**
 * Should this course's sections be reordered at all?
 *
 * `explicitObjectives` is what the instructor typed; `fromPoi` says the
 * outline followed a program of instruction. Either one means the order is
 * already someone's decision.
 */
export function mayReorder({ explicitObjectives = [], fromPoi = false } = {}) {
  if (fromPoi) return false;
  return !(Array.isArray(explicitObjectives) && explicitObjectives.length > 0);
}

/**
 * Sections in the order their pages appear in the publication.
 *
 * Stable: sections whose pages tie, or that have no usable page, keep their
 * original position relative to each other. A course where NO section has a
 * plain page number comes back untouched, because there is nothing to order by
 * and a reshuffle on no information is just churn.
 *
 * Returns the same array instance when nothing would move, so a caller can
 * tell whether anything happened.
 */
export function inSourceOrder(sections) {
  const list = Array.isArray(sections) ? sections : [];
  if (list.length < 2) return list;

  const keyed = list.map((section, index) => ({
    section,
    index,
    page: pageNumber(section?.cite),
  }));
  if (keyed.every((entry) => entry.page === null)) return list;

  const sorted = [...keyed].sort((left, right) => {
    // A section with no page number cannot be placed, so it holds its ground
    // rather than being swept to one end of the course.
    if (left.page === null || right.page === null) return left.index - right.index;
    if (left.page !== right.page) return left.page - right.page;
    return left.index - right.index;
  });

  const moved = sorted.some((entry, position) => entry.index !== position);
  return moved ? sorted.map((entry) => entry.section) : list;
}

/**
 * The page sequence a course reads in, for reporting.
 *
 * Exported because "2, 5, 6, 7, 27, 121, 67, 124" is the clearest possible
 * statement of the problem, and an instructor looking at a course that was
 * deliberately NOT reordered should be able to see it.
 */
export function pageSequence(sections) {
  return (Array.isArray(sections) ? sections : []).map((section) => pageNumber(section?.cite));
}

/** Does this sequence go backwards anywhere? Null pages are ignored. */
export function readsOutOfOrder(sections) {
  const pages = pageSequence(sections).filter((page) => page !== null);
  return pages.some((page, index) => index > 0 && page < pages[index - 1]);
}
