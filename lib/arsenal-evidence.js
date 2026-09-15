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
 * `chat`, and the current model.js `generateJSON` shape are also accepted for easy wiring.
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
  } else if (typeof model.generateJSON === 'function') {
    result = await model.generateJSON({
      system: payload.system,
      prompt: payload.user,
      schema: payload.schema,
      maxTokens: 4000,
    });
  } else {
    throw new TypeError('model must be a function or expose complete, chat, or generateJSON');
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
  if (!modelIsAvailable(model)) {
    throw new TypeError('model must be a function or expose complete, chat, or generateJSON');
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

function citationText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.citation || value.source || value.cite || value.section || '';
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
  if (!Array.isArray(question.options) || question.options.length === 0) {
    throw contentError(`${where} must have non-empty options`);
  }
}

function assertLesson(lesson, where) {
  const text = typeof lesson === 'string' ? lesson : lesson?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw contentError(`${where} must have non-empty lesson text`);
  }
}

/**
 * Convert a saved Course projection to Cartridge's plain course shape while enforcing approval.
 *
 * A store may return a pre-shaped `{ approved: true, lessons, quiz }`, Prisma-like
 * `{ sections: [{ items: [...] }] }`, or the actual Coursewright section projection
 * `{ sections: [{ lesson, pre, post, cite }] }`. Coursewright sections must retain non-empty lesson,
 * pre-test, and post-test content; a title-only or refusal-only export is rejected.
 */
export function approvedCourseForCartridge(course) {
  requireObject(course, 'course');
  if (!course.title || typeof course.title !== 'string') {
    throw new EvidenceError('Course title is required', 'INVALID_COURSE', 422);
  }

  const sections = Array.isArray(course.sections) ? course.sections : null;
  const hasItemProjection = Boolean(
    sections && sections.some((section) => Array.isArray(section?.items)),
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
    lessons = sourceItems
      .filter((item) => String(item.kind).toUpperCase() === 'LESSON')
      .map((item, index) => {
        const text = itemText(item);
        assertLesson(text, `sections item ${index}`);
        return { text, cite: citationText(item.citation) };
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
      if (!Array.isArray(section.pre) || !section.pre.length) {
        throw contentError(`section ${index}.pre must contain non-empty questions`);
      }
      if (!Array.isArray(section.post) || !section.post.length) {
        throw contentError(`section ${index}.post must contain non-empty questions`);
      }
      lessons.push({ text: section.lesson, cite: citationText(section.cite) });
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
    lessons.forEach((lesson, index) => assertLesson(lesson, `lessons[${index}]`));
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

/** Build and validate a SCORM package. The route must not send the bytes unless `valid` is true. */
export async function buildApprovedScorm({ course, version = '1.2' } = {}) {
  const cartridgeCourse = approvedCourseForCartridge(course);
  const zip = await buildCartridge(cartridgeCourse, { version });
  const validation = await validatePackage(zip);
  if (!validation.valid) {
    throw new EvidenceError(
      `Generated SCORM package failed validation: ${validation.issues.join('; ')}`,
      'SCORM_VALIDATION_FAILED',
      500,
    );
  }
  return { zip, validation, course: cartridgeCourse };
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
