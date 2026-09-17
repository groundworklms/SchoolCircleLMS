/**
 * Thin, data-only seams for the learning-evidence Arsenal packages.
 *
 * This module deliberately does not know about Prisma, authentication, or Express. The route
 * adapter supplies saved records and receives pure package results. Keeping persistence outside
 * this file makes it difficult to accidentally turn a fixture, a client supplied learner id, or a
 * model fallback into production evidence.
 */
import {
  classGaps,
  learningGain,
  masteryRollup,
} from 'sextant';
import {
  plan as cadencePlan,
  toICS,
  toReminders,
} from 'cadence';
import {
  hotwash,
  heuristicMemo,
  narrativeAAR,
} from 'hotwash';
import {
  classProfile,
  profile as waypointProfile,
  recommendations,
} from 'waypoint';
import {
  buildCartridge,
  validatePackage,
} from 'cartridge';
import {
  benchmark,
  scoreCase,
} from 'understudy';
import { projectLearnerLessons } from './learning/delivery.js';
import { provenanceOf } from './provenance.js';

export const COHORT_MIN = 5;

/**
 * An error intended to cross the route boundary. The route uses `status` and `code` but callers
 * can still treat it as an ordinary Error in tests and worker code.
 */
export class EvidenceError extends Error {
  constructor(message, code = 'EVIDENCE_ERROR', status = 400) {
    super(message);
    this.name = 'EvidenceError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function validatedObjective(attempt) {
  const value = attempt.objective ?? attempt.topic ?? attempt.section ?? attempt.competency;
  if (value == null) return 'overall';
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function projectAttempt(attempt) {
  if (
    !isObject(attempt) ||
    (attempt.phase !== 'pre' && attempt.phase !== 'post') ||
    typeof attempt.correct !== 'boolean'
  ) {
    return null;
  }
  const objective = validatedObjective(attempt);
  if (!objective) return null;
  const projected = {
    objective,
    phase: attempt.phase,
    correct: attempt.correct,
  };
  if (typeof attempt.learnerId === 'string' && attempt.learnerId.trim()) {
    projected.learnerId = attempt.learnerId;
  }
  return projected;
}

function evidenceObjective(attempt) {
  return attempt.objective;
}

function contributorPhases(attempts) {
  const overall = new Map();
  const objectives = new Map();
  for (const attempt of attempts) {
    const learnerId = attempt?.learnerId;
    if (learnerId == null || !String(learnerId).trim()) continue;
    const id = String(learnerId);
    const phase = attempt.phase;
    if (!overall.has(id)) overall.set(id, new Set());
    overall.get(id).add(phase);
    const objective = evidenceObjective(attempt);
    if (!objectives.has(objective)) objectives.set(objective, new Map());
    if (!objectives.get(objective).has(id)) objectives.get(objective).set(id, new Set());
    objectives.get(objective).get(id).add(phase);
  }
  return { overall, objectives };
}

function pairedContributorCount(phases) {
  return [...phases.values()].filter((values) => values.has('pre') && values.has('post')).length;
}

function pairedContributorIds(phases) {
  return new Set(
    [...phases.entries()]
      .filter(([, values]) => values.has('pre') && values.has('post'))
      .map(([learnerId]) => learnerId),
  );
}

/**
 * Build analytics from saved attempts and saved mastery reports.
 *
 * `learnerId` values are accepted by Sextant solely so it can enforce distinct-learner cohort
 * suppression. They never appear in this return value. In cohort scope, membership is only the
 * outer population gate: overall gain and each objective require `minCohort` distinct paired
 * pre/post contributors, and each mastery competency is independently suppressed below the same
 * threshold. Instructors must leave `minCohort` at the default (or a larger value); the router
 * does not expose this option to clients.
 */
export function buildAnalytics({
  attempts = [],
  sessions = [],
  minCohort = COHORT_MIN,
  cohort = false,
  distinctLearnerCount,
} = {}) {
  requireArray(attempts, 'attempts');
  requireArray(sessions, 'sessions');
  if (!Number.isInteger(minCohort) || minCohort < 1) {
    throw new TypeError('minCohort must be a positive integer');
  }

  // Sextant treats a missing `correct` as false and can use attempt count as a
  // cohort proxy. Neither is safe for Whetstone records: a mastery turn is not
  // a pre/post scored item, and an absent learner id is not a distinct learner.
  // Keep only a strict, data-only DTO at this boundary. In particular, never pass a raw request or
  // persistence object to Sextant: its grouping key is retained in its result and could otherwise
  // carry nested learner ids, answers, or grading keys.
  const explicitAttempts = attempts.map(projectAttempt).filter(Boolean);
  const attemptsWithLearner = explicitAttempts.filter(
    (attempt) => attempt.learnerId != null && String(attempt.learnerId).trim(),
  );
  const learnerIds = new Set(
    attemptsWithLearner.map((attempt) => String(attempt.learnerId)),
  );
  const validSessions = sessions
    .filter((report) => isObject(report) && Array.isArray(report.criteria))
    .map((report) => {
      const criteria = report.criteria
        .filter((criterion) =>
          isObject(criterion) &&
          typeof (criterion.competency ?? criterion.elo) === 'string' &&
          String(criterion.competency ?? criterion.elo).trim() &&
          ['developing', 'competent', 'mastered'].includes(criterion.verdict),
        )
        .map((criterion) => ({
          competency: String(criterion.competency ?? criterion.elo).trim(),
          verdict: criterion.verdict,
        }));
      if (!criteria.length) return null;
      const projected = { criteria };
      if (typeof report.learnerId === 'string' && report.learnerId.trim()) {
        projected.learnerId = report.learnerId;
      }
      return projected;
    })
    .filter(Boolean);
  for (const report of validSessions) {
    if (report.learnerId != null && String(report.learnerId).trim()) {
      learnerIds.add(String(report.learnerId));
    }
  }
  const observedLearners = Number.isInteger(distinctLearnerCount)
    ? distinctLearnerCount
    : learnerIds.size;

  const insufficientGain = {
    status: 'insufficient_evidence',
    reason: 'Learning gain requires saved attempts with explicit pre/post phases and boolean correctness.',
  };
  const insufficientCohort = {
    status: 'insufficient_evidence',
    reason: `A cohort needs at least ${minCohort} distinct learners before aggregate evidence is shown.`,
    minimumLearners: minCohort,
    observedLearners,
  };

  // Whole-cohort suppression applies to every aggregate, not just Sextant's
  // class-gaps rows. The store may provide an authoritative count when a
  // learner id is intentionally not selected in its aggregate query.
  if (cohort && observedLearners < minCohort) {
    return {
      gain: insufficientCohort,
      gaps: [],
      mastery: insufficientCohort,
      privacy: {
        cohortSuppressedBelow: minCohort,
        observedLearners,
        learnerIdsReturned: false,
      },
      evidence: {
        gain: insufficientCohort,
        mastery: insufficientCohort,
      },
    };
  }

  // Only identified records may feed a cohort computation. This prevents
  // Sextant's documented attempt-count fallback from bypassing suppression.
  const analyticsAttempts = cohort ? attemptsWithLearner : explicitAttempts;
  const contributorSets = cohort ? contributorPhases(analyticsAttempts) : null;
  const pairedOverallContributors = contributorSets
    ? pairedContributorCount(contributorSets.overall)
    : null;
  const pairedOverallIds = contributorSets
    ? pairedContributorIds(contributorSets.overall)
    : null;
  const overallGainAttempts = cohort
    ? analyticsAttempts.filter((attempt) => pairedOverallIds.has(attempt.learnerId))
    : analyticsAttempts;
  const eligibleObjectives = contributorSets
    ? new Set(
      [...contributorSets.objectives.entries()]
        .filter(([, phases]) => pairedContributorCount(phases) >= minCohort)
        .map(([objective]) => objective),
    )
    : null;
  const objectivePairedIds = contributorSets
    ? new Map(
      [...contributorSets.objectives.entries()].map(([objective, phases]) => [
        objective,
        pairedContributorIds(phases),
      ]),
    )
    : null;
  const objectiveGainAttempts = cohort
    ? analyticsAttempts.filter((attempt) => {
        return objectivePairedIds.get(evidenceObjective(attempt))?.has(attempt.learnerId);
      })
    : analyticsAttempts;
  const rawGain = (() => {
    const hasPre = overallGainAttempts.some((attempt) => attempt.phase === 'pre');
    const hasPost = overallGainAttempts.some((attempt) => attempt.phase === 'post');
    const overall = hasPre && hasPost ? learningGain(overallGainAttempts) : insufficientGain;
    if (!cohort) return overall;
    const objectives = objectiveGainAttempts.length
      ? learningGain(objectiveGainAttempts).objectives
      : [];
    return { ...overall, objectives };
  })();
  const gainContributorInsufficient = cohort && pairedOverallContributors < minCohort;
  const insufficientContributorGain = {
    status: 'insufficient_evidence',
    reason: `Overall gain requires at least ${minCohort} distinct contributors with paired pre/post evidence.`,
    minimumContributors: minCohort,
    observedContributors: pairedOverallContributors ?? 0,
    overall: null,
    objectives: [],
  };
  const gain = gainContributorInsufficient
    ? insufficientContributorGain
    : cohort
      ? {
          ...rawGain,
          objectives: rawGain.objectives.filter((objective) =>
            eligibleObjectives.has(String(objective.objective))),
        }
      : rawGain;
  const gapAttempts = cohort
    ? analyticsAttempts.filter((attempt) => eligibleObjectives.has(evidenceObjective(attempt)))
    : analyticsAttempts;
  const gaps = gapAttempts.length ? classGaps(gapAttempts, { minCohort }) : [];
  const mastery = (() => {
    if (!validSessions.length) return [];
    if (!cohort) return masteryRollup(validSessions);

    // A learner may save several mastery snapshots. Count each learner once
    // per competency, using the persistence order's first snapshot.
    const masteryByLearnerCompetency = new Map();
    for (const report of validSessions) {
      const learnerId = report.learnerId;
      if (learnerId == null || !String(learnerId).trim()) continue;
      const id = String(learnerId);
      for (const criterion of report.criteria) {
        const competency = String(criterion.competency ?? criterion.elo);
        const key = `${id}\u0000${competency}`;
        if (!masteryByLearnerCompetency.has(key)) {
          masteryByLearnerCompetency.set(key, {
            competency,
            verdict: criterion.verdict,
            learnerId: id,
          });
        }
      }
    }
    const masteryContributors = new Map();
    for (const criterion of masteryByLearnerCompetency.values()) {
      if (!masteryContributors.has(criterion.competency)) {
        masteryContributors.set(criterion.competency, new Set());
      }
      masteryContributors.get(criterion.competency).add(criterion.learnerId);
    }
    const eligibleCompetencies = new Set(
      [...masteryContributors.entries()]
        .filter(([, learners]) => learners.size >= minCohort)
        .map(([competency]) => competency),
    );
    const masteryRecords = [...masteryByLearnerCompetency.values()]
      .filter((criterion) => eligibleCompetencies.has(criterion.competency));
    if (!masteryRecords.length) {
      return {
        status: 'insufficient_evidence',
        reason: `Each mastery competency requires at least ${minCohort} distinct contributors.`,
        minimumContributors: minCohort,
        observedContributors: Math.max(
          0,
          ...[...masteryContributors.values()].map((learners) => learners.size),
        ),
      };
    }
    return masteryRollup(masteryRecords);
  })();
  return {
    gain,
    gaps,
    mastery,
    privacy: {
      cohortSuppressedBelow: minCohort,
      ...(cohort ? { observedLearners } : {}),
      ...(cohort
        ? {
            gainContributors: {
              minimum: minCohort,
              observed: pairedOverallContributors,
              status: gainContributorInsufficient ? 'insufficient_evidence' : 'complete',
            },
            objectiveContributors: {
              minimum: minCohort,
              eligible: eligibleObjectives.size,
              suppressed: [...contributorSets.objectives.values()]
                .filter((phases) => pairedContributorCount(phases) < minCohort).length,
            },
          }
        : {}),
      learnerIdsReturned: false,
    },
    evidence: {
      gain: gain.status === 'insufficient_evidence' ? gain : null,
      mastery: mastery?.status === 'insufficient_evidence'
        ? mastery
        : validSessions.length
          ? null
          : {
              status: 'insufficient_evidence',
              reason: 'No saved mastery report.criteria entries with a validated verdict were found.',
            },
    },
  };
}

/**
 * Build all three Cadence courses of action and a calendar for the recommended one.
 *
 * The syllabus must come from a persisted Course/Section/Item projection supplied by the caller.
 * This function intentionally does not accept or fetch learner ids.
 */
export function buildStudyPlan({
  syllabus,
  availability = 60,
  asOf,
  status,
  ics = {},
} = {}) {
  requireArray(syllabus, 'syllabus');
  if (!isObject(ics)) throw new TypeError('ics must be an object');

  const input = { syllabus, availability, asOf };
  if (status != null) input.status = status;
  const plan = cadencePlan(input);
  const selectedBlocks = plan.coas[plan.recommended]?.blocks ?? [];

  return {
    plan,
    selectedBlocks,
    ics: toICS(selectedBlocks, ics),
    reminders: toReminders(selectedBlocks),
  };
}

function modelIsAvailable(model) {
  return (
    typeof model === 'function' ||
    (model && typeof model === 'object' &&
      (typeof model.complete === 'function' ||
        typeof model.chat === 'function' ||
        typeof model.generateJSON === 'function'))
  );
}

/**
 * Call the injected application model without consulting an environment key or a package
 * default. The stable seam is `({ capability, role, system, user, json }) => result`; `complete`,
 * `chat`, the current model.js `generateJSON` shape, and the prose `generateText` shape are also
 * accepted for easy wiring.
 */
async function callInjectedModel(model, payload) {
  let result;
  if (typeof model === 'function') {
    result = await model(payload);
  } else if (typeof model.complete === 'function') {
    result = await model.complete(payload);
  } else if (typeof model.chat === 'function') {
    // A two-argument chat function is the common lightweight test seam. A one-argument chat
    // function receives the full payload and can select a provider itself.
    result = model.chat.length >= 2
      ? await model.chat(payload.system, payload.user)
      : await model.chat(payload);
  } else if (payload.json === false && typeof model.generateText === 'function') {
    result = await model.generateText({
      system: payload.system,
      prompt: payload.user,
      maxTokens: 4000,
    });
  } else if (payload.json === false) {
    throw new TypeError('model does not expose a prose generateText capability');
  } else if (typeof model.generateJSON === 'function') {
    result = await model.generateJSON({
      system: payload.system,
      prompt: payload.user,
      schema: payload.schema,
      maxTokens: 4000,
    });
  } else {
    throw new TypeError('model must be a function or expose complete, chat, generateText, or generateJSON');
  }
  return result;
}

function textFromModelResult(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (typeof value.memo === 'string') return value.memo.trim();
  if (typeof value.text === 'string') return value.text.trim();
  if (typeof value.content === 'string') return value.content.trim();
  if (value.data && value.data !== value) return textFromModelResult(value.data);
  return '';
}

/**
 * Build Hotwash's ranked course AAR. Hotwash's deterministic memo is always available. A model is
 * used only when the caller explicitly injects one; narrativeAAR is fed an in-process transport so
 * it cannot silently use OPENROUTER_API_KEY or a package default endpoint.
 */
export async function buildAar({
  critiques,
  course,
  model,
} = {}) {
  requireArray(critiques, 'critiques');
  const report = hotwash({ critiques });
  const memoOptions = course ? { course: String(course) } : {};
  const fallback = heuristicMemo(report, memoOptions);

  if (!model) {
    return {
      report,
      memo: fallback,
      source: 'heuristic',
      modelAvailable: false,
    };
  }
  const hasProseAdapter = model &&
    typeof model === 'object' &&
    typeof model.generateText === 'function';
  if (!modelIsAvailable(model) && !hasProseAdapter) {
    throw new TypeError('model must be a function or expose complete, chat, generateText, or generateJSON');
  }

  const injectedFetch = async (_endpoint, init = {}) => {
    let body = {};
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    } catch {
      return { ok: false, status: 400, async json() { return {}; } };
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const result = await callInjectedModel(model, {
      capability: 'hotwash',
      role: 'narrative',
      system: messages[0]?.content ?? '',
      user: messages[1]?.content ?? '',
      json: false,
    });
    const text = textFromModelResult(result);
    if (!text) return { ok: false, status: 502, async json() { return {}; } };
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: text } }] };
      },
    };
  };

  const narrative = await narrativeAAR(report, {
    ...memoOptions,
    // A sentinel is required by narrativeAAR's transport contract; no secret is read and this
    // value is never sent anywhere because injectedFetch is local.
    apiKey: 'injected-model',
    endpoint: 'injected://hotwash',
    fetchImpl: injectedFetch,
  });
  return {
    report,
    memo: narrative.memo,
    source: narrative.source,
    modelAvailable: true,
  };
}

/**
 * Score a Waypoint response map. Name is supplied by authenticated persistence code, not the
 * request body, so a learner cannot rename another learner's profile.
 */
export function buildProfile({ responses, name = null } = {}) {
  requireObject(responses, 'responses');
  const profile = waypointProfile(responses, { name });
  return { profile, recommendations: recommendations(profile) };
}

/**
 * Aggregate saved, already-owned cohort profiles without returning raw survey answers.
 *
 * Waypoint itself can aggregate any non-empty array, so the adapter supplies
 * the privacy boundary. `distinctLearnerCount` is an optional authoritative
 * count from persistence; otherwise entries must carry learnerId values. A
 * profile response without five distinct learners is an explicit
 * insufficiency, never a small-cell class profile.
 */
export function buildCohortProfile({
  entries,
  distinctLearnerCount,
  minCohort = COHORT_MIN,
} = {}) {
  requireArray(entries, 'entries');
  if (!Number.isInteger(minCohort) || minCohort < 1) {
    throw new TypeError('minCohort must be a positive integer');
  }
  const ids = new Set(
    entries
      .map((entry) => entry?.learnerId)
      .filter((id) => id != null && String(id).trim())
      .map((id) => String(id)),
  );
  const observedLearners = Number.isInteger(distinctLearnerCount)
    ? distinctLearnerCount
    : ids.size;
  if (observedLearners < minCohort) {
    return {
      status: 'insufficient_evidence',
      reason: `A cohort needs at least ${minCohort} distinct learners before Waypoint aggregates are shown.`,
      minimumLearners: minCohort,
      observedLearners,
      profile: null,
      privacy: { learnerIdsReturned: false },
    };
  }
  if (!entries.length) {
    throw new EvidenceError('No saved cohort profiles', 'NO_COHORT_PROFILES', 404);
  }
  const profiles = entries.map((entry) => entry?.profile ?? entry?.responses ?? entry);
  return {
    status: 'complete',
    ...classProfile(profiles),
    privacy: { learnerIdsReturned: false, cohortSuppressedBelow: minCohort },
  };
}

/**
 * The last resort when a stored citation carries no publication name and no
 * locator `provenanceOf` recognises -- older or hand-shaped projections that
 * name their source under `source`, `cite`, `sourceId` or `section`. This was
 * the whole of `citationText`; it is now only reached when the shared
 * provenance line has nothing to work with, so an odd shape still produces a
 * citation rather than tripping `assertCitation`.
 */
function legacyCitationLabel(value) {
  const label = String(
    value.citation ||
      value.source ||
      value.cite ||
      value.sourceId ||
      value.pubId ||
      value.section ||
      '',
  ).trim();
  if (value.page == null || !label || /\bp\.\s*\d+\b/i.test(label)) return label;
  return `${label} p.${value.page}`;
}

/**
 * How one citation reads in an exported package, and what it addresses.
 *
 * `cite` is the line a human sees. It comes from the SAME helper every screen
 * uses (lib/provenance.js `provenanceOf`), because the export is the one
 * surface where a wrong provenance line is never re-read: a SCORM bundle drops
 * into another LMS and nobody there opens the source to check it. A stored
 * citation is a LOCATOR -- "<source record id> p.85" -- and preferring it, as
 * this adapter did, printed a cuid where every other surface prints
 * "TC 3-22.9 p.85".
 *
 * `locator` is that exact stored string, kept rather than discarded: it is the
 * addressing contract the source viewer resolves, and dropping it on export
 * would make an exported package impossible to trace back to the passage it
 * was ratified against. It travels beside the lesson in the package payload and
 * is not displayed -- the key stays available, it just stops being the citation.
 */
function citationParts(value) {
  if (typeof value !== 'string' && (!value || typeof value !== 'object')) return null;
  const provenance = provenanceOf(value);
  if (provenance?.text) return { cite: provenance.text, locator: provenance.locator };
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { cite: label, locator: label } : null;
  }
  const label = legacyCitationLabel(value);
  return label ? { cite: label, locator: label } : null;
}

function citationText(value) {
  return citationParts(value)?.cite ?? '';
}

/** A Cartridge lesson: the visible provenance line, plus the locator it stands for. */
function lessonWithCitation(text, citation) {
  const parts = citationParts(citation);
  return {
    text,
    cite: parts?.cite ?? '',
    // Cartridge embeds the lesson objects verbatim in the package payload and
    // renders only `text` and `cite`, so this rides along without being shown.
    ...(parts?.locator && parts.locator !== parts.cite ? { locator: parts.locator } : {}),
  };
}

function itemAnswer(item) {
  const answer = item.answer;
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    return answer.index ?? answer.correctIndex ?? answer.answer ?? answer.answerIndex ?? 0;
  }
  return answer ?? item.answerIndex ?? 0;
}

function itemText(item) {
  return item.text ?? item.stem ?? item.title ?? '';
}

function contentError(message) {
  return new EvidenceError(message, 'COURSE_CONTENT_MISSING', 409);
}

function assertQuestion(question, where) {
  if (!isObject(question) || typeof question.stem !== 'string' || !question.stem.trim()) {
    throw contentError(`${where} must have non-empty question text`);
  }
  if (
    !Array.isArray(question.options) ||
    question.options.length === 0 ||
    question.options.some((option) => typeof option !== 'string' || !option.trim())
  ) {
    throw contentError(`${where} must have non-empty options`);
  }
  if (
    !Number.isInteger(question.answer) ||
    question.answer < 0 ||
    question.answer >= question.options.length
  ) {
    throw contentError(`${where} must have an in-range answer`);
  }
}

function assertLesson(lesson, where) {
  const text = typeof lesson === 'string' ? lesson : lesson?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw contentError(`${where} must have non-empty lesson text`);
  }
}

function assertCitation(value, where) {
  if (!citationText(value)) {
    throw contentError(`${where} requires a valid source citation`);
  }
}

/**
 * Convert a saved Course projection to Cartridge's plain course shape while enforcing approval.
 *
 * A store may return a pre-shaped `{ approved: true, lessons, quiz }`, Prisma-like
 * `{ sections: [{ items: [...] }] }`, or the actual Coursewright section projection
 * `{ sections: [{ lesson, pre, post, cite }] }`. Coursewright sections must retain non-empty lesson,
 * pre-test, and post-test content; a title-only or refusal-only export is rejected.
 *
 * NOT the route's path any more. It can only judge a WHOLE projection -- either every item in it
 * carries `status: 'APPROVED'` or the export is refused -- so a projection with no item status in it
 * at all, which is exactly what an approved authoring draft is, passes as approved.
 * `ratifiedCourseForCartridge` below reads the materialised delivery rows instead, and is what
 * /api/learning/export uses.
 */
export function approvedCourseForCartridge(course) {
  requireObject(course, 'course');
  if (!course.title || typeof course.title !== 'string') {
    throw new EvidenceError('Course title is required', 'INVALID_COURSE', 422);
  }

  const sections = Array.isArray(course.sections) ? course.sections : null;
  const sectionItemFlags = sections?.map((section) => Array.isArray(section?.items)) || [];
  if (
    sectionItemFlags.some(Boolean) &&
    sectionItemFlags.some((hasItems) => !hasItems)
  ) {
    throw contentError('Course sections mix incompatible item and Coursewright projections');
  }
  const hasItemProjection = Boolean(
    sections && sectionItemFlags.length > 0 && sectionItemFlags.every(Boolean),
  );
  const sourceItems = hasItemProjection
    ? sections.flatMap((section) => Array.isArray(section?.items) ? section.items : [])
    : [];
  const courseApproved = course.approved === true ||
    String(course.status ?? '').toUpperCase() === 'APPROVED';
  if (hasItemProjection) {
    for (const item of sourceItems) {
      if (String(item.status ?? '').toUpperCase() !== 'APPROVED') {
        throw new EvidenceError(
          'SCORM export is limited to approved course items',
          'COURSE_NOT_APPROVED',
          409,
        );
      }
    }
  } else if (!courseApproved) {
    throw new EvidenceError(
      'SCORM export requires an approved course projection',
      'COURSE_NOT_APPROVED',
      409,
    );
  }

  let lessons;
  let quiz;
  if (hasItemProjection) {
    if (sections.some((section) => section.items.length === 0)) {
      throw contentError('Approved course sections must contain non-empty items');
    }
    lessons = sourceItems
      .filter((item) => String(item.kind).toUpperCase() === 'LESSON')
      .map((item, index) => {
        const text = itemText(item);
        assertLesson(text, `sections item ${index}`);
        assertCitation(item.citation, `sections item ${index}`);
        return lessonWithCitation(text, item.citation);
      });
    quiz = sourceItems
      .filter((item) => String(item.kind).toUpperCase() === 'QUESTION')
      .map((item, index) => {
        const question = {
          stem: item.stem ?? itemText(item),
          options: item.options,
          answer: itemAnswer(item),
        };
        assertQuestion(question, `sections question ${index}`);
        return question;
      });
  } else if (sections) {
    if (!sections.length) throw contentError('Coursewright course has no sections');
    lessons = [];
    quiz = [];
    for (const [index, section] of sections.entries()) {
      if (section?.status != null && String(section.status).toUpperCase() !== 'APPROVED') {
        throw new EvidenceError(
          'SCORM export is limited to approved course sections',
          'COURSE_NOT_APPROVED',
          409,
        );
      }
      assertLesson(section?.lesson, `section ${index}.lesson`);
      assertCitation(section?.cite ?? section?.citation, `section ${index}.lesson`);
      if (!Array.isArray(section.pre) || !section.pre.length) {
        throw contentError(`section ${index}.pre must contain non-empty questions`);
      }
      if (!Array.isArray(section.post) || !section.post.length) {
        throw contentError(`section ${index}.post must contain non-empty questions`);
      }
      lessons.push(lessonWithCitation(section.lesson, section.cite));
      for (const phase of ['pre', 'post']) {
        for (const [questionIndex, item] of section[phase].entries()) {
          assertQuestion(item, `section ${index}.${phase}[${questionIndex}]`);
          quiz.push({
            stem: item.stem,
            options: item.options,
            answer: itemAnswer(item),
          });
        }
      }
    }
  } else {
    if (!courseApproved) throw new EvidenceError(
      'SCORM export requires an approved course projection',
      'COURSE_NOT_APPROVED',
      409,
    );
    lessons = Array.isArray(course.lessons) ? course.lessons : [];
    quiz = Array.isArray(course.quiz) ? course.quiz : [];
    lessons.forEach((lesson, index) => {
      assertLesson(lesson, `lessons[${index}]`);
      assertCitation(lesson?.cite ?? lesson?.citation, `lessons[${index}]`);
    });
    quiz.forEach((question, index) => assertQuestion(question, `quiz[${index}]`));
  }
  if (!lessons.length) throw contentError('Approved course has no non-empty lessons');

  return {
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    summary: course.summary,
    masteryScore: course.masteryScore,
    lessons,
    quiz,
  };
}

/**
 * Cartridge's knowledge check carries the FIRST TWELVE questions and silently
 * drops the rest (`quiz.slice(0, 12)` in node_modules/cartridge/src/cartridge.js
 * `courseware`). The golden course alone ratifies twenty-nine, so this is not a
 * theoretical edge: a package can be short of ratified content for a reason
 * that has nothing to do with ratification, and the disclosure below has to say
 * so or the same "looks complete" problem comes back through another door.
 * Pinned by a test that packages thirteen questions and counts what lands.
 */
const PACKAGED_QUESTION_LIMIT = 12;

function countByKind(items, predicate) {
  const counts = { LESSON: 0, QUESTION: 0, OTHER: 0 };
  for (const item of items) {
    if (!predicate(item)) continue;
    const kind = String(item?.kind || '').toUpperCase();
    if (kind === 'LESSON' || kind === 'QUESTION') counts[kind] += 1;
    else counts.OTHER += 1;
  }
  return counts;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function verb(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

/** "3 lessons and 12 questions", omitting whatever is zero. */
function kindPhrase(counts) {
  const parts = [];
  if (counts.LESSON) parts.push(plural(counts.LESSON, 'lesson'));
  if (counts.QUESTION) parts.push(plural(counts.QUESTION, 'question'));
  if (counts.OTHER) parts.push(plural(counts.OTHER, 'other item'));
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * What an exported package must admit about itself, in the words a person
 * reading it in another LMS would need.
 *
 * Every sentence here answers the same question: is what I am looking at the
 * whole course? Three separate things can make the answer no -- content still
 * awaiting review, Cartridge's twelve-question cap, and ratified items of a
 * kind the courseware has no place for -- and each gets its own sentence,
 * because "partial" without a reason is a shrug rather than a disclosure.
 */
function packageDisclosure(census) {
  const notes = [];
  if (census.awaiting.total > 0) {
    notes.push(
      `Partial release. An instructor has ratified ${census.ratified.total} of ` +
        `${census.total} items in this course; the remaining ` +
        `${kindPhrase(census.awaiting) || plural(census.awaiting.total, 'item')} ` +
        `${verb(census.awaiting.total, 'is', 'are')} still awaiting review and ` +
        `${verb(census.awaiting.total, 'is', 'are')} not in this package.`,
    );
  }
  if (census.packagedQuestions < census.ratified.QUESTION) {
    notes.push(
      `The knowledge check carries the first ${census.packagedQuestions} of ` +
        `${census.ratified.QUESTION} ratified questions, which is as many as a SCORM ` +
        'package holds.',
    );
  }
  if (census.ratified.OTHER > 0) {
    notes.push(
      `${plural(census.ratified.OTHER, 'ratified item')} of a kind this package format ` +
        `does not carry (such as a practical scenario) ` +
        `${verb(census.ratified.OTHER, 'is', 'are')} not included.`,
    );
  }
  return notes;
}

/**
 * The Cartridge course for ONE RATIFIED RELEASE, built from the materialised
 * delivery rows rather than from the authoring draft.
 *
 * Why the rows. The export used to package `store.getApprovedCourse`, which for
 * a release with no typed rows hands back the approved DRAFT payload -- lesson,
 * pre and post exactly as generated, with no item status anywhere in it. That
 * bypassed the ratification gate outright, and it bypassed it at the one door
 * where it matters most: a SCORM bundle leaves the system and nobody
 * downstream re-reviews it. Even where typed rows did exist the projection
 * filtered them to APPROVED silently, so a half-reviewed course exported as a
 * complete-looking package under the full course title.
 *
 * So the ratified set is read from ONE place -- the same rows
 * `listDeliveryCourseItems` returns and the learner projection reads -- and the
 * prose half comes from `projectLearnerLessons`, the function that already
 * decides which lesson text a ratification decision releases. Two definitions
 * of "approved" is how a gate and its export drift apart.
 *
 * PENDING blocks the export; REJECTED does not. A rejected item is a decision
 * an instructor has already made and the course simply does not contain it. A
 * pending item is a decision nobody has made yet, and shipping around it is
 * either omitting content the instructor means to approve or exporting a course
 * they have not finished reading.
 *
 * @param {object} course    the authorised release: `id` and `title`
 * @param {Array}  sections  rows as lib/db.js `listDeliveryCourseItems` returns them
 * @param {boolean} allowPartial  the instructor explicitly asked for the ratified subset
 */
export function ratifiedCourseForCartridge({ course, sections, allowPartial = false } = {}) {
  requireObject(course, 'course');
  if (!course.title || typeof course.title !== 'string') {
    throw new EvidenceError('Course title is required', 'INVALID_COURSE', 422);
  }
  const rows = Array.isArray(sections) ? sections : [];
  const items = rows.flatMap((section) => (Array.isArray(section?.items) ? section.items : []));

  const isApproved = (item) => String(item?.status || '').toUpperCase() === 'APPROVED';
  const isRejected = (item) => String(item?.status || '').toUpperCase() === 'REJECTED';
  const ratified = countByKind(items, isApproved);
  const awaiting = countByKind(items, (item) => !isApproved(item) && !isRejected(item));
  ratified.total = ratified.LESSON + ratified.QUESTION + ratified.OTHER;
  awaiting.total = awaiting.LESSON + awaiting.QUESTION + awaiting.OTHER;

  if (ratified.total === 0) {
    // Covers both "nothing reviewed yet" and a release with no materialised
    // rows at all. An empty package is not a smaller course, it is a course
    // title with nothing behind it -- the most misleading artifact of all.
    throw new EvidenceError(
      awaiting.total > 0
        ? `SCORM export is limited to ratified content, and none of the ${awaiting.total} items ` +
          'in this course has been approved yet. Ratify the content from the review screen first.'
        : 'This course release has no ratified items on record, so there is nothing to export.',
      'COURSE_NOT_RATIFIED',
      409,
    );
  }
  if (awaiting.total > 0 && !allowPartial) {
    throw new EvidenceError(
      `SCORM export is limited to ratified content: ` +
        `${kindPhrase(awaiting) || plural(awaiting.total, 'item')} of the ${items.length} in this ` +
        `course ${verb(awaiting.total, 'is', 'are')} still awaiting instructor review. ` +
        'Ratify them from the review screen, or ' +
        'export the ratified subset, which is labelled a partial release inside the package.',
      'COURSE_NOT_RATIFIED',
      409,
    );
  }

  // The prose half, from the function the learner projection uses. `released`
  // is that function's word for "an instructor approved this row", so a PENDING
  // lesson arrives here with no text and no citation and is simply not a lesson.
  const lessons = projectLearnerLessons(rows)
    .filter((lesson) => lesson.released)
    .map((lesson, index) => {
      assertLesson(lesson.text, `ratified lesson ${index}`);
      assertCitation(lesson.citation, `ratified lesson ${index}`);
      return lessonWithCitation(lesson.text, lesson.citation);
    });
  if (!lessons.length) {
    throw contentError('This course release has no ratified lesson text to export');
  }

  const quiz = items
    .filter((item) => isApproved(item) && String(item?.kind).toUpperCase() === 'QUESTION')
    .map((item, index) => {
      const question = { stem: item.stem ?? itemText(item), options: item.options, answer: itemAnswer(item) };
      assertQuestion(question, `ratified question ${index}`);
      return question;
    });

  const census = {
    total: items.length,
    ratified,
    awaiting,
    partial: awaiting.total > 0,
    packagedLessons: lessons.length,
    packagedQuestions: Math.min(quiz.length, PACKAGED_QUESTION_LIMIT),
  };
  const notes = packageDisclosure(census);

  return {
    census: { ...census, notes },
    course: {
      id: course.id,
      // The manifest's <organization> title is what a receiving LMS lists the
      // course under, and a catalogue entry is the one string nobody re-opens
      // the package to check. If the package is short of the course, it says so
      // there, not only in the body.
      title: census.partial ? `${course.title} — PARTIAL RELEASE` : course.title,
      subtitle: course.subtitle,
      // Rendered as the package's opening "Overview" card.
      summary: [...notes, course.summary].filter(Boolean).join(' '),
      masteryScore: course.masteryScore,
      lessons,
      quiz,
    },
  };
}

/**
 * Build and validate a SCORM package. The route must not send the bytes unless `valid` is true.
 *
 * Pass `sections` -- the materialised delivery rows -- and the package is built
 * from the ratified set only (`ratifiedCourseForCartridge`). That is what the
 * route does, always. The no-`sections` form remains for the pre-shaped and
 * Coursewright projections `approvedCourseForCartridge` documents; it applies
 * the older whole-projection approval rules and cannot see per-item status, so
 * nothing that serves an instructor should reach for it.
 */
export async function buildApprovedScorm({ course, version = '1.2', sections, allowPartial = false } = {}) {
  const ratified = Array.isArray(sections)
    ? ratifiedCourseForCartridge({ course, sections, allowPartial })
    : null;
  const cartridgeCourse = ratified ? ratified.course : approvedCourseForCartridge(course);
  const zip = await buildCartridge(cartridgeCourse, { version });
  const validation = await validatePackage(zip);
  if (!validation.valid) {
    throw new EvidenceError(
      `Generated SCORM package failed validation: ${validation.issues.join('; ')}`,
      'SCORM_VALIDATION_FAILED',
      500,
    );
  }
  return { zip, validation, course: cartridgeCourse, census: ratified?.census ?? null };
}

function parsedUnderstudyResult(value) {
  if (value && typeof value === 'object' && value.error) return value;
  if (value && typeof value === 'object' && value.data && value.data !== value) {
    return parsedUnderstudyResult(value.data);
  }
  if (typeof value === 'string') {
    const text = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'model returned non-JSON output' };
    }
  }
  return value && typeof value === 'object'
    ? value
    : { error: 'model returned no parsed JSON' };
}

/**
 * Run the separate Understudy fidelity benchmark. This is intentionally not part of tutor answer
 * handling. Missing model capability returns an explicit unavailable result rather than allowing
 * Understudy's default network client to produce errored runs that look like a score.
 */
export async function evaluateFidelity({
  cases,
  persona,
  doctrine,
  retriever,
  k,
  strict,
  groundingThreshold,
  model,
} = {}) {
  requireArray(cases, 'cases');
  if (!cases.length) throw new TypeError('cases must be a non-empty array');
  if (!persona || typeof persona !== 'string') throw new TypeError('persona must be a string');
  if (retriever != null && typeof retriever !== 'function') {
    throw new TypeError('retriever must be a function');
  }
  if (retriever == null && doctrine == null) {
    throw new EvidenceError(
      'Fidelity input must include approved doctrine passages or a retriever',
      'FIDELITY_DOCTRINE_MISSING',
      422,
    );
  }

  if (!model) {
    return {
      status: 'unavailable',
      reason: 'No injected model is configured for the Understudy agent and independent judge.',
      report: null,
      runs: [],
    };
  }
  if (!modelIsAvailable(model)) {
    throw new TypeError('model must be a function or expose complete, chat, or generateJSON');
  }

  const modelChat = (role) => async (system, user) => {
    const result = await callInjectedModel(model, {
      capability: 'understudy',
      role,
      system,
      user,
      json: true,
      schema: role === 'judge'
        ? {
          type: 'object',
          properties: { verdict: { type: 'string' }, reasons: { type: 'string' } },
        }
        : {
          type: 'object',
          properties: {
            action: { type: 'string' },
            rationale: { type: 'string' },
            used: { type: 'array' },
            outOfDoctrine: { type: 'boolean' },
            note: { type: 'string' },
          },
        },
    });
    return parsedUnderstudyResult(result);
  };

  const judge = async (args) => scoreCase({
    ...args,
    chat: modelChat('judge'),
  });

  const result = await benchmark(cases, {
    persona,
    doctrine,
    retriever,
    k,
    strict,
    groundingThreshold,
    chat: modelChat('agent'),
    judge,
  });
  return { status: 'complete', ...result };
}
