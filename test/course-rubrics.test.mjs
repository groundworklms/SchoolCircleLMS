import test from 'node:test';
import assert from 'node:assert/strict';
import {
  performanceSteps,
  rubricIsApprovable,
  rubricSourceText,
  rubricTaskFor,
  sectionsNeedingRubrics,
} from '../lib/learning/course-rubrics.js';
import { verifyTraceability, validateRubric, taskToText } from 'rubricon';

const SECTION = {
  title: 'Orders reconciliation',
  objective: 'Explain the purpose of orders reconciliation within the command',
  cite: 'MCWP 5-10 p.56',
  lesson:
    'Orders reconciliation is an internal command process in which planners review the entire order. '
    + 'Its purpose is to ensure the basic order and all annexes and appendices are complete and in agreement. '
    + 'Reconciliation identifies discrepancies or gaps that require corrective action before the order is issued.',
};

test('the standard is assembled out of what the section already carries', () => {
  const task = rubricTaskFor(SECTION);
  assert.equal(task.title, 'Orders reconciliation');
  assert.equal(task.standard, SECTION.objective);
  assert.equal(task.code, 'MCWP 5-10 p.56');
  assert.match(task.condition, /MCWP 5-10 p\.56/);
  assert.equal(task.performanceSteps.length, 3);
  // Nothing in the task may be text the section did not contain, because the
  // rubric's every anchor is required to trace back to it.
  for (const step of task.performanceSteps) {
    assert.ok(SECTION.lesson.includes(step), step);
  }
});

/*
 * The defect the per-objective design exists to fix. Rubricon builds its prompt
 * from taskToText(task) and nothing else, so whatever is not in the task is not
 * available to anchor in -- and verifyTraceability then checks the anchors
 * against whatever sourceText it is handed. Handing it the whole publication,
 * as the rubrics screen does, is checking a phrase against a book.
 */
test('the prompt and the grounding check read the same text', () => {
  const task = rubricTaskFor(SECTION);
  const prompt = taskToText(task);
  const grounding = rubricSourceText(SECTION);
  for (const step of task.performanceSteps) {
    assert.ok(prompt.includes(step), 'every step reaches the model');
    assert.ok(grounding.includes(step), 'and is checkable afterwards');
  }
});

test('an anchor quoting the section is grounded; one quoting the publication at large is not', () => {
  const grounding = rubricSourceText(SECTION);
  const honest = {
    dimensions: [
      { name: 'Completeness', source: 'all annexes and appendices are complete', anchors: {} },
    ],
  };
  const invented = {
    dimensions: [
      { name: 'Wargaming', source: 'the red cell portrays the enemy scheme of manoeuvre', anchors: {} },
    ],
  };
  assert.equal(verifyTraceability(honest, grounding).grounded, true);
  assert.equal(verifyTraceability(invented, grounding).grounded, false);
});

test('steps are deduplicated and capped, and page prose counts as section prose', () => {
  const withPages = {
    ...SECTION,
    pages: [
      {
        blocks: [
          { text: SECTION.lesson },
          { text: 'The crosswalk compares the draft order with the orders of adjacent commanders.' },
        ],
      },
    ],
  };
  const steps = performanceSteps(withPages);
  assert.equal(new Set(steps).size, steps.length, 'the repeated lesson is not listed twice');
  assert.ok(steps.some((step) => /crosswalk/.test(step)), 'page prose is usable material');
  assert.ok(steps.length <= 12);
});

test('a section with almost no prose yields no standard rather than a thin one', () => {
  assert.equal(rubricTaskFor({ title: 'x', objective: 'y', lesson: 'Too short.' }), null);
  assert.equal(rubricTaskFor({ lesson: SECTION.lesson }), null, 'nothing to name the task');
  assert.equal(rubricTaskFor(null), null);
});

test('a section with no citation still makes a standard, minus the condition', () => {
  const task = rubricTaskFor({ ...SECTION, cite: undefined });
  assert.ok(task);
  assert.equal(task.condition, undefined);
  assert.equal(task.code, undefined);
});

/* Resumability, which is the only thing that makes a per-objective pass safe to
   run inside a generation that gets killed by deploys. */
test('an objective that already has a rubric is not written a second time', () => {
  const other = { ...SECTION, title: 'Orders crosswalk', objective: 'Explain the orders crosswalk' };
  const wanted = sectionsNeedingRubrics([SECTION, other], [{ objective: SECTION.objective }]);
  assert.deepEqual(wanted.map((section) => section.title), ['Orders crosswalk']);
});

test('a flagged rubric is not re-litigated by generating another one', () => {
  const wanted = sectionsNeedingRubrics([SECTION], [{ objective: SECTION.objective, flagged: true }]);
  assert.deepEqual(wanted, [], 'an instructor already saw that refusal');
});

test('two sections teaching the same objective are written once', () => {
  const wanted = sectionsNeedingRubrics([SECTION, { ...SECTION, title: 'Again' }], []);
  assert.equal(wanted.length, 1);
});

test('nothing to write is an empty list, not a crash', () => {
  assert.deepEqual(sectionsNeedingRubrics(null, null), []);
  assert.deepEqual(sectionsNeedingRubrics([{ title: 'thin', objective: 'o', lesson: '' }], []), []);
});

/* approveRubric's four conditions, mirrored. If these two ever disagree the
   generation would report a rubric as ready that the approve button refuses. */
test('approvable means exactly what approveRubric means', () => {
  const ok = {
    rubric: { flagged: false, dimensions: [{}] },
    validation: { valid: true, flagged: false },
    traceability: { grounded: true, ungrounded: [] },
  };
  assert.equal(rubricIsApprovable(ok), true);
  assert.equal(rubricIsApprovable({ ...ok, rubric: { flagged: true } }), false);
  assert.equal(rubricIsApprovable({ ...ok, validation: { valid: false } }), false);
  assert.equal(rubricIsApprovable({ ...ok, validation: { valid: true, flagged: true } }), false);
  assert.equal(rubricIsApprovable({ ...ok, traceability: { grounded: false } }), false);
  assert.equal(
    rubricIsApprovable({ ...ok, traceability: { grounded: true, ungrounded: [{ name: 'x' }] } }),
    false,
    'grounded:true beside a populated ungrounded list is a contradiction, and the list wins',
  );
  assert.equal(rubricIsApprovable(), false);
});

// A rubric built from a real section has to survive Rubricon's own structural
// validator, or none of the above matters.
test('a well-formed BARS scale over this standard validates', () => {
  const rubric = {
    flagged: false,
    dimensions: [
      {
        name: 'Completeness check',
        source: 'all annexes and appendices are complete and in agreement',
        anchors: {
          unsatisfactory: 'Reviews the basic order only; annexes are not opened.',
          satisfactory: 'Reviews the basic order and every annex against it.',
          proficient: 'Reviews order, annexes and appendices and records each discrepancy found.',
        },
      },
    ],
  };
  assert.equal(validateRubric(rubric).valid, true);
  assert.equal(verifyTraceability(rubric, rubricSourceText(SECTION)).grounded, true);
});
