import test from 'node:test';
import assert from 'node:assert/strict';
import {
  performanceSteps,
  rubricIsApprovable,
  rubricSourceText,
  rubricTaskFor,
  sectionsNeedingRubrics,
  spanning,
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

/*
 * A section's cite is "<source record id> p.145", and the reader resolves the
 * id to a publication name before drawing it. Nothing resolved it here, so a
 * rubric's task code -- printed verbatim on the rubrics screen -- read
 * "cmu67789l002ms6013zw026ls p.145". Not a citation anybody can check, on the
 * one artifact whose entire claim is that it is traceable.
 */
test('the task cites a publication a person can look up, not a record id', () => {
  const section = { ...SECTION, cite: 'cmu67789l002ms6013zw026ls p.145' };
  const task = rubricTaskFor(section, { publication: 'mcwp 5-10.pdf' });
  assert.equal(task.code, 'MCWP 5-10 p.145'.replace('MCWP 5-10', 'mcwp 5-10'));
  assert.match(task.condition, /mcwp 5-10 p\.145/);
  assert.equal(task.references, task.code);
});

test('an unknown publication leaves the locator alone rather than inventing a name', () => {
  const section = { ...SECTION, cite: 'cmu67789l002ms6013zw026ls p.145' };
  const task = rubricTaskFor(section, {});
  assert.equal(task.code, 'cmu67789l002ms6013zw026ls p.145');
  assert.equal(rubricTaskFor(section, { publication: '   ' }).code, 'cmu67789l002ms6013zw026ls p.145');
});

test('a locator with no page keeps the publication name alone', () => {
  const task = rubricTaskFor({ ...SECTION, cite: 'some-record-id' }, { publication: 'MCWP 5-10.pdf' });
  assert.equal(task.code, 'MCWP 5-10');
});

/*
 * The defect that produced the first flagged rubric on the MCWP 5-10 course.
 *
 * That section's lesson alone is twenty usable sentences and its pages another
 * twenty-three. Taking the first twelve handed Rubricon a standard that stopped
 * partway through the six steps of the planning process, and it refused --
 * correctly -- because the outputs of the later steps were not in the text it
 * was given. The flag was right; the input was wrong.
 */
test('a standard spans the whole section rather than stopping partway through it', () => {
  const sentences = [
    'The process has six steps and begins with problem framing.',
    'Problem framing produces the commander battlespace area evaluation.',
    'Course of action development produces feasible alternatives for comparison.',
    'The war game tests each course of action against enemy actions.',
    'Comparison and decision produces the commander selected course of action.',
    'Orders development turns the selected course of action into an order.',
    'Transition delivers the order to the units that will execute it.',
  ];
  const section = {
    title: 'The Marine Corps Planning Process',
    objective: 'Identify the six steps and explain how their outputs support decision-making',
    cite: 'pub p.6',
    lesson: sentences.join(' '),
  };
  const task = rubricTaskFor(section);
  const joined = task.performanceSteps.join(' ');
  // Every step of the process reaches the model, not just the ones that
  // happened to come first.
  for (const term of ['problem framing', 'war game', 'Orders development', 'Transition']) {
    assert.match(joined, new RegExp(term, 'i'), term);
  }
});

test('an over-long section is sampled across its whole span, keeping both ends', () => {
  const many = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} of the section.`);
  const kept = spanning(many, 24);
  assert.equal(kept.length, 24);
  assert.equal(kept[0], many[0], 'the framing sentence is kept');
  assert.equal(kept[kept.length - 1], many[many.length - 1], 'and the conclusion');
  // The point of sampling rather than truncating: the tail is represented.
  assert.ok(kept.some((sentence) => many.indexOf(sentence) > 40));
});

test('a section that fits under the cap is not resampled', () => {
  const few = ['One sentence here.', 'And a second one here.'];
  assert.deepEqual(spanning(few, 24), few);
  assert.deepEqual(spanning([], 24), []);
  assert.deepEqual(spanning(null, 24), []);
});
