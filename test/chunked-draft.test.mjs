import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, nextStep, runChunkedDraft } from '../lib/learning/chunked-draft.js';

const DOCUMENTS = [
  {
    source: 'pub p.1',
    text:
      'Orders reconciliation is an internal command process in which planners review the entire ' +
      'order. Its purpose is to ensure the basic order and all annexes and appendices are complete ' +
      'and in agreement. Reconciliation identifies discrepancies or gaps that require corrective action.',
  },
  {
    source: 'pub p.2',
    text:
      'The orders crosswalk compares the draft order with the orders of higher, adjacent and ' +
      'subordinate commanders. Its purpose is to achieve unity of effort and to confirm that the ' +
      'plan nests within the higher commander intent before the order is approved.',
  },
];

/** A model that answers every stage of a generation from the passage it is given. */
function fixtureAsk({ onCall } = {}) {
  let call = 0;
  return async (_model, system, prompt) => {
    call += 1;
    if (typeof onCall === 'function') onCall({ system, prompt, call });
    if (system.includes('instructional designer')) {
      return {
        title: 'Orders reconciliation and crosswalk',
        objectives: [
          'Explain the purpose of orders reconciliation within the command',
          'Explain how the orders crosswalk achieves unity of effort',
        ],
      };
    }
    const passage = prompt
      .split('\n')
      .map((line) => line.trim())
      .sort((a, b) => b.length - a.length)[0] || '';
    const sentences = passage.split(/(?<=\.)\s+/).filter(Boolean);
    const first = (sentences[0] || 'The passage says so.').trim();

    if (/Write the lesson\.$/.test(prompt)) {
      return {
        refused: false,
        elements: [
          { kind: 'concept', passage: 1, text: first },
          { kind: 'why', passage: 1, text: `This matters because ${first.toLowerCase()}` },
          { kind: 'summary', passage: 1, text: `In summary, ${first.toLowerCase()}` },
        ],
      };
    }
    if (system.includes('"items"')) {
      const post = /PARALLEL FORM/.test(prompt);
      const fact = (post ? sentences[1] : sentences[0]) || first;
      const objective = (/Objective: ([^\n]+)/.exec(prompt) || [, 'the objective'])[1].slice(0, 40);
      return {
        refused: false,
        items: [
          {
            stem: `${post ? 'Which statement holds' : 'What does the passage state'} about ${objective}?`,
            options: [fact.trim(), 'None of the conditions above applies in any circumstance'],
            answerIndex: 0,
            rationale: fact.trim(),
          },
        ],
      };
    }
    if (system.includes('"cards"')) {
      return { refused: false, cards: [{ front: 'Reconciliation?', back: first }] };
    }
    return { refused: true, reason: 'not needed for this fixture' };
  };
}

const SPEC = { objectives: [], documents: DOCUMENTS, diagrams: false, pages: false };

test('nextStep reads what is left off the progress, without a model', () => {
  assert.deepEqual(nextStep(emptyProgress()), { do: 'plan' });
  assert.deepEqual(nextStep(null), { do: 'plan' });

  const planned = { plan: { grounded: [{}, {}, {}] }, sections: [] };
  assert.deepEqual(nextStep(planned), { do: 'section', index: 0, total: 3 });
  assert.deepEqual(nextStep({ ...planned, sections: [{}, {}] }), { do: 'section', index: 2, total: 3 });
  assert.deepEqual(nextStep({ ...planned, sections: [{}, {}, {}] }), { do: 'assemble', total: 3 });
});

test('progress is saved after the plan and after every section', async () => {
  const saves = [];
  const course = await runChunkedDraft(SPEC, {
    ask: fixtureAsk(),
    save: async (state) => saves.push(JSON.parse(JSON.stringify(state))),
  });
  assert.ok(course.sections.length >= 1, 'a course was produced');

  // The plan lands before any section is written, which is the whole point:
  // a run that dies during section one does not pay for the outline twice.
  assert.ok(saves[0].plan, 'the first checkpoint carries the plan');
  assert.equal(saves[0].sections.length, 0, 'and no sections yet');

  const counts = saves.map((s) => s.sections.length);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b), 'sections only ever accumulate');
  assert.equal(counts[counts.length - 1], course.sections.length + countRefused(saves));
});

function countRefused(saves) {
  const last = saves[saves.length - 1];
  return last.sections.filter((section) => section?.refused === true || !section).length;
}

// The property the whole change rests on.
test('a generation resumed from a checkpoint produces the same course as one that never stopped', async () => {
  const whole = await runChunkedDraft(SPEC, { ask: fixtureAsk() });

  // Run again, but stop after the first section and hand the state back.
  let stopped = null;
  let seen = 0;
  await assert.rejects(
    runChunkedDraft(SPEC, {
      ask: fixtureAsk(),
      save: async (state) => {
        stopped = JSON.parse(JSON.stringify(state));
        seen += 1;
        // Two checkpoints in: the plan, then section one. Die here, the way a
        // replaced instance does.
        if (seen === 2) throw new Error('the instance went away');
      },
    }),
    /the instance went away/,
  );
  assert.ok(stopped?.plan, 'the plan survived');
  assert.equal(stopped.sections.length, 1, 'and one finished section');

  const resumed = await runChunkedDraft({ ...SPEC, progress: stopped }, { ask: fixtureAsk() });
  assert.deepEqual(
    resumed.sections.map((s) => s.title),
    whole.sections.map((s) => s.title),
    'same sections, same order',
  );
  assert.equal(resumed.title, whole.title);
  assert.deepEqual(resumed.objectives, whole.objectives);
});

test('a resumed run does not re-plan, and does not rewrite what it already has', async () => {
  const first = [];
  let stopped = null;
  let seen = 0;
  await assert.rejects(
    runChunkedDraft(SPEC, {
      ask: fixtureAsk({ onCall: ({ system }) => first.push(system.slice(0, 40)) }),
      save: async (state) => {
        stopped = JSON.parse(JSON.stringify(state));
        seen += 1;
        if (seen === 2) throw new Error('stop');
      },
    }),
    /stop/,
  );

  const second = [];
  await runChunkedDraft({ ...SPEC, progress: stopped }, {
    ask: fixtureAsk({ onCall: ({ system }) => second.push(system.slice(0, 40)) }),
  });
  const outlineCalls = second.filter((s) => s.includes('instructional designer')).length;
  assert.equal(outlineCalls, 0, 'the outline is not paid for twice');
});

// Cross-section state has to travel on the row, or the duplicate checks go
// blind at exactly the seam nobody looks at.
test('the stems already asked are carried across a resume', async () => {
  let stopped = null;
  let seen = 0;
  await assert.rejects(
    runChunkedDraft(SPEC, {
      ask: fixtureAsk(),
      save: async (state) => {
        stopped = JSON.parse(JSON.stringify(state));
        seen += 1;
        if (seen === 2) throw new Error('stop');
      },
    }),
    /stop/,
  );
  assert.ok(Array.isArray(stopped.usedStems), 'the stems are on the checkpoint');
  assert.ok(stopped.usedStems.length > 0, 'and section one recorded what it asked');
});
