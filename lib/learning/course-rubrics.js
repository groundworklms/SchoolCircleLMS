/**
 * Turning a generated course section into the standard a BARS rubric is built
 * from.
 *
 * WHY THIS EXISTS. Rubricon writes a Behaviorally Anchored Rating Scale from
 * one performance standard, and it is the artifact that makes a mastery session
 * worth sitting: a BARS dimension IS an enabling objective, and its three
 * anchors are the three things an evaluator would see. deriveMasteryPlan
 * already prefers approved rubrics over anything a model invents, and
 * masteryCriteriaFromRubric copies the anchors across verbatim, so the words a
 * learner is graded against are words a human approved.
 *
 * None of that had ever run on a generated course, because writing a rubric
 * meant opening the rubrics screen, choosing a source, filling in a task form,
 * and doing all of it again for the next objective. So every generated course
 * arrived with no rubrics at all, and its mastery plan -- if an instructor made
 * one -- was derived by a model rather than anchored to a standard.
 *
 * THE GROUNDING PROBLEM THIS ALSO FIXES. Rubricon builds its prompt from
 * taskToText(task) and NOTHING else; the sourceText argument is used only by
 * verifyTraceability afterwards. The existing screen passes the whole approved
 * document as that argument -- two hundred pages of MCWP 5-10 -- so a phrase the
 * model produced had only to reach 0.6 token overlap with a book before it was
 * declared grounded. It nearly always did. The check was passing on volume.
 *
 * Generating per objective fixes both halves at once, because a course section
 * already is a standard's worth of text: it was retrieved for one objective,
 * written from its own cited passages, and it is short. So the task carries that
 * section's real sentences -- which is what the model actually sees -- and
 * traceability is checked against that same section. The model must anchor in
 * what it was shown, and the verification reads the same text. Neither is
 * decoration any more.
 *
 * Pure. One import, no model, no database.
 */

import { sentencesOf } from './repetition.js';
import { pageOf, publicationName } from '../provenance.js';

/**
 * How many sentences of the section become the standard.
 *
 * This was twelve, and twelve was the reason the first rubric of the MCWP 5-10
 * course came back flagged. That section's lesson alone is twenty usable
 * sentences and its pages another twenty-three; taking the first twelve handed
 * Rubricon a standard that stopped partway through the six steps, and it
 * refused -- correctly -- because the outputs of the later steps were not in
 * the text it was given. The flag was right and the input was wrong.
 *
 * Raised to cover a whole section. Rubricon's own task path caps performance
 * steps at twenty, so this is the same order of magnitude and not a new claim
 * about how much a model should read.
 */
const MAX_STEPS = 24;
/** Long enough to be a step, rather than a fragment left by the sentence split. */
const MIN_STEP_WORDS = 5;
/** Matches MAX_TASK_FIELD_LENGTH in arsenal-core, which caps the drafted task. */
const MAX_FIELD = 600;

const clean = (value) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const capped = (value) => clean(value).slice(0, MAX_FIELD);
const words = (value) => clean(value).split(' ').filter(Boolean);

/**
 * The observable steps of the standard, taken from the section's own prose.
 *
 * Not asked of a model. The lesson was already written from cited passages and
 * already passed the grounding floor, so its sentences are the most defensible
 * text available -- and using them means the rubric is anchored to what the
 * course teaches rather than to something adjacent in the same publication.
 *
 * Page prose is included after the lesson because a page expansion is the same
 * material at more length, and a rubric for a taught objective should be able
 * to cite either.
 */
export function performanceSteps(section) {
  const blocks = [clean(section?.lesson)];
  for (const page of Array.isArray(section?.pages) ? section.pages : []) {
    for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
      if (typeof block?.text === 'string') blocks.push(clean(block.text));
    }
  }
  const seen = new Set();
  const all = [];
  for (const block of blocks) {
    for (const sentence of sentencesOf(block)) {
      const text = capped(sentence);
      if (words(text).length < MIN_STEP_WORDS) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(text);
    }
  }
  return spanning(all, MAX_STEPS);
}

/**
 * At most `limit` sentences, spanning the whole passage rather than its start.
 *
 * Taking a prefix is what produced a standard that covered two of six steps: a
 * section teaches its material in order, so the first N sentences are the first
 * topic and the cap silently decides which half of an objective a rubric may be
 * written about. Sampling evenly keeps the shape of the whole section, and the
 * first and last sentences are always kept because they carry the section's
 * framing and its conclusion.
 */
export function spanning(sentences, limit) {
  const list = Array.isArray(sentences) ? sentences : [];
  if (list.length <= limit) return list;
  const kept = [];
  for (let i = 0; i < limit; i += 1) {
    // Rounded across the full span so index 0 and the final sentence are both
    // included, whatever the ratio.
    const at = Math.round((i * (list.length - 1)) / (limit - 1));
    const sentence = list[at];
    if (!kept.includes(sentence)) kept.push(sentence);
  }
  return kept;
}

/**
 * The text traceability is checked against: everything the task was built from.
 *
 * Deliberately the same material, so a dimension's verbatim source phrase is
 * verified against the passage the model was actually shown. Passing the whole
 * publication here would make the check meaningless, which is the defect in the
 * note at the top of this file.
 */
export function rubricSourceText(section) {
  return [clean(section?.lesson), ...performanceSteps(section)].filter(Boolean).join('\n');
}

/**
 * The performance standard for one taught objective.
 *
 * Every field is copied from something that already exists: the objective is the
 * standard, the section title names the task, the citation states the condition,
 * and the steps are the lesson's own sentences. Nothing here is invented, which
 * is the only way a rubric built from it can honestly claim to be grounded.
 *
 * Returns null when the section has too little prose to state a standard -- a
 * refused or nearly empty section -- because a rubric built from one sentence
 * would be a shape rather than a standard.
 */
export function rubricTaskFor(section, { publication } = {}) {
  const objective = capped(section?.objective);
  const title = capped(section?.title);
  if (!objective && !title) return null;
  const steps = performanceSteps(section);
  if (steps.length < 2) return null;
  /* The citation as a person reads it.
   *
   * A section's `cite` is "<source record id> p.145", and the reader resolves
   * the id to a publication name before drawing it. Nothing resolved it here,
   * so a rubric's task code -- which the rubrics screen prints verbatim --
   * read "cmu67789l002ms6013zw026ls p.145". That is not a citation anybody can
   * check, on the one artifact whose whole claim is that it is traceable. */
  const cite = citeLabel(section?.cite, publication);
  return {
    ...(cite ? { code: cite } : {}),
    title: title || objective,
    // Factual rather than invented: this is where the material being performed
    // against comes from, and it is the citation the section already carries.
    ...(cite ? { condition: `Given ${cite}.` } : {}),
    standard: objective || title,
    performanceSteps: steps,
    ...(cite ? { references: cite } : {}),
  };
}

/**
 * Which sections still need a rubric.
 *
 * Matched on the objective, because that is the link a rubric records and the
 * key deriveMasteryPlan reads when it looks for a ratified one. Skipping what
 * exists is what makes a rubric pass resumable for free: each rubric is its own
 * row, so a run cut in half leaves the finished ones behind and the next attempt
 * starts where it stopped.
 *
 * A section whose objective already has a rubric is skipped whatever state that
 * rubric is in -- pending, approved, flagged. Writing a second rubric for an
 * objective an instructor already flagged would spend a model call to
 * re-litigate a decision they made.
 */
/**
 * "MCWP 5-10 p.145" from "<record id> p.145", when the publication is known.
 *
 * Falls back to the raw locator rather than dropping it: a citation nobody can
 * read still records which passage the standard came from, and inventing a name
 * would be worse than an ugly one.
 */
export function citeLabel(cite, publication) {
  const raw = clean(cite);
  if (!raw) return '';
  const name = publicationName(clean(publication));
  if (!name) return raw;
  const page = pageOf(raw);
  return page ? `${name} p.${page}` : name;
}

export function sectionsNeedingRubrics(sections, rubrics) {
  const covered = new Set(
    (Array.isArray(rubrics) ? rubrics : [])
      .map((rubric) => clean(rubric?.objective).toLowerCase())
      .filter(Boolean),
  );
  const wanted = [];
  const queued = new Set();
  for (const section of Array.isArray(sections) ? sections : []) {
    const objective = clean(section?.objective);
    const key = objective.toLowerCase();
    if (!objective || covered.has(key) || queued.has(key)) continue;
    if (!rubricTaskFor(section)) continue;
    queued.add(key);
    wanted.push(section);
  }
  return wanted;
}

/**
 * Can this rubric become mastery criteria without a second look?
 *
 * The same four conditions approveRubric enforces, asked here so a generation
 * can report how many of the rubrics it wrote are actually usable rather than
 * only how many it produced. It does NOT approve anything: approval is an
 * instructor pressing a button, and a rubric that a learner is graded against
 * having passed through a person is the point of this product.
 */
export function rubricIsApprovable({ rubric, validation, traceability } = {}) {
  return Boolean(
    validation?.valid === true
    && validation?.flagged !== true
    && rubric?.flagged !== true
    && traceability?.grounded === true
    && !(Array.isArray(traceability?.ungrounded) && traceability.ungrounded.length > 0),
  );
}
