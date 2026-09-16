/**
 * Pure course-revision helpers.
 *
 * Course revisions are deliberately applied to a cloned Coursewright document.
 * The model is allowed to author the selected lesson/question only; this module
 * owns the structural boundary which keeps every other generated artifact byte
 * for byte unchanged and retains stable target ids.
 */

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function courseRevisionError(message, code = 'COURSE_REVISION_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function stableId(value, fallback, used) {
  const candidate = nonEmptyString(value) || fallback;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  const unique = `${candidate}-${suffix}`;
  used.add(unique);
  return unique;
}

/**
 * Add ids to a fresh Coursewright response without changing its content. A
 * revision never regenerates these ids: applyCourseRevision starts from this
 * normalized document and explicitly carries the selected target id forward.
 */
export function normaliseCourseIds(course) {
  if (!course || typeof course !== 'object' || Array.isArray(course)) {
    throw courseRevisionError('generated course must be an object');
  }
  const result = clone(course);
  if (!Array.isArray(result.sections)) return result;

  const sectionIds = new Set();
  result.sections = result.sections.map((rawSection, sectionIndex) => {
    if (!rawSection || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
      return rawSection;
    }
    const section = { ...rawSection };
    section.id = stableId(
      section.id || section.sectionId,
      `section-${sectionIndex + 1}`,
      sectionIds,
    );

    for (const phase of ['pre', 'post']) {
      if (!Array.isArray(section[phase])) continue;
      const questionIds = new Set();
      section[phase] = section[phase].map((rawQuestion, questionIndex) => {
        if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
          return rawQuestion;
        }
        const question = { ...rawQuestion };
        question.id = stableId(
          question.id || question.questionId,
          `${section.id}:${phase}${questionIndex + 1}`,
          questionIds,
        );
        return question;
      });
    }
    return section;
  });
  return result;
}

export const normalizeCourseIds = normaliseCourseIds;

export function parseRevisionRequest(body = {}) {
  if (!Number.isInteger(body.version) || body.version < 0) {
    throw new TypeError('version must be a non-negative integer');
  }
  if (body.scope !== 'question' && body.scope !== 'lesson') {
    throw new TypeError('scope must be question or lesson');
  }
  const sectionId = nonEmptyString(body.sectionId);
  if (!sectionId) throw new TypeError('sectionId is required');
  const instructions = nonEmptyString(body.instructions);
  if (!instructions) throw new TypeError('instructions is required');

  const phase = body.phase === undefined ? undefined : body.phase;
  if (phase !== undefined && phase !== 'pre' && phase !== 'post') {
    throw new TypeError('phase must be pre or post');
  }
  const questionId = body.questionId === undefined ? undefined : nonEmptyString(body.questionId);
  if (body.questionId !== undefined && !questionId) {
    throw new TypeError('questionId must be a non-empty string');
  }
  if (body.scope === 'question' && !questionId) {
    throw new TypeError('questionId is required for question revisions');
  }
  return {
    version: body.version,
    scope: body.scope,
    sectionId,
    ...(phase ? { phase } : {}),
    ...(questionId ? { questionId } : {}),
    instructions,
  };
}

function sectionFor(course, sectionId) {
  const section = course.sections.find((candidate) => candidate?.id === sectionId);
  if (!section) {
    throw courseRevisionError(`Section ${sectionId} was not found`, 'COURSE_REVISION_TARGET_NOT_FOUND', 404);
  }
  return section;
}

function questionFor(section, request) {
  const phases = request.phase ? [request.phase] : ['pre', 'post'];
  const matches = [];
  for (const phase of phases) {
    const questions = Array.isArray(section[phase]) ? section[phase] : [];
    questions.forEach((question, index) => {
      if (question?.id === request.questionId) matches.push({ phase, index, question });
    });
  }
  if (matches.length === 0) {
    throw courseRevisionError(
      `Question ${request.questionId} was not found in section ${request.sectionId}`,
      'COURSE_REVISION_TARGET_NOT_FOUND',
      404,
    );
  }
  if (matches.length > 1) {
    throw courseRevisionError(
      `Question ${request.questionId} is ambiguous; phase is required`,
      'COURSE_REVISION_TARGET_INVALID',
      422,
    );
  }
  return matches[0];
}

function generatedQuestion(generated) {
  if (generated?.question && typeof generated.question === 'object') return generated.question;
  if (generated && typeof generated === 'object') return generated;
  return null;
}

/**
 * Apply one model result. Only the selected field is read from the result:
 * model-provided sections, phases, citations, or ids cannot replace unrelated
 * saved content or the grounding anchor selected by the instructor.
 */
export function applyCourseRevision(course, request, generated) {
  const next = normaliseCourseIds(course);
  if (!Array.isArray(next.sections)) {
    throw courseRevisionError('course has no sections');
  }
  if (!generated || generated.refused === true || generated.error) {
    throw courseRevisionError(
      generated?.reason || generated?.error || 'The model refused this revision.',
      'COURSE_REVISION_REFUSED',
      422,
    );
  }

  const section = sectionFor(next, request.sectionId);
  if (request.scope === 'lesson') {
    const lesson =
      typeof generated.lesson === 'string'
        ? generated.lesson
        : typeof generated.section?.lesson === 'string'
          ? generated.section.lesson
          : '';
    if (!lesson.trim()) {
      throw courseRevisionError('The model returned no revised lesson text.', 'COURSE_REVISION_INVALID', 422);
    }
    // Deliberately keep section.cite/citation and all checks/cards unchanged.
    section.lesson = lesson.trim();
    return next;
  }

  const target = questionFor(section, request);
  const replacement = generatedQuestion(generated);
  if (!replacement || typeof replacement.stem !== 'string' || !replacement.stem.trim()) {
    throw courseRevisionError('The model returned no revised question stem.');
  }
  if (!Array.isArray(replacement.options) || replacement.options.length < 2) {
    throw courseRevisionError('The revised question must contain at least two options.');
  }
  const answer = replacement.answer ?? replacement.answerIndex;
  if (!Number.isInteger(answer) || answer < 0 || answer >= replacement.options.length) {
    throw courseRevisionError('The revised question has an invalid answer.');
  }
  const savedId = target.question.id;
  // Keep the existing question's id and citation anchor, and only copy
  // question-owned fields. In particular, a model cannot move a question to
  // another phase/section or replace the saved Anchor citation.
  const nextQuestion = { ...target.question, id: savedId };
  for (const key of ['stem', 'options', 'rationale']) {
    if (Object.prototype.hasOwnProperty.call(replacement, key)) {
      nextQuestion[key] = clone(replacement[key]);
    }
  }
  nextQuestion.answer = answer;
  delete nextQuestion.answerIndex;
  delete nextQuestion.questionId;
  section[target.phase][target.index] = nextQuestion;
  return next;
}

export function revisionHistoryOf(payload) {
  return Array.isArray(payload?.revisionHistory) ? clone(payload.revisionHistory) : [];
}

export function revisionSummary(record, payload) {
  return {
    id: record.id,
    scope: payload.scope,
    sectionId: payload.sectionId,
    ...(payload.phase ? { phase: payload.phase } : {}),
    ...(payload.questionId ? { questionId: payload.questionId } : {}),
    instructions: payload.instructions,
    baseVersion: payload.baseVersion,
    version: payload.reviewedVersion,
    status: record.status,
    ...(record.createdAt ? { createdAt: new Date(record.createdAt).toISOString() } : {}),
    ...(record.updatedAt ? { updatedAt: new Date(record.updatedAt).toISOString() } : {}),
  };
}
