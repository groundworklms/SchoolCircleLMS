import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestQuestionRewrite } from '../lib/arsenal-core.js';

const PASSAGE =
  'Orders reconciliation is an internal command process in which planners review the entire order. ' +
  'Its purpose is to ensure the basic order and all annexes and appendices are complete and in ' +
  'agreement. Reconciliation identifies discrepancies or gaps that require corrective action.';

const QUESTION = {
  stem: 'What is orders reconciliation for?',
  options: ['To check the order is complete and in agreement', 'To brief the commander', 'x', 'y'],
  answer: 0,
  rationale: 'It ensures the order and its attachments agree.',
};

const reply = (value) => async () => value;

test('a grounded rewrite comes back in the shape the form fills', async () => {
  const suggestion = await suggestQuestionRewrite(
    { question: QUESTION, passage: PASSAGE },
    {
      ask: reply({
        refused: false,
        stem: 'During orders reconciliation, what are planners checking for?',
        options: [
          'That the basic order and all annexes and appendices are complete and in agreement',
          'That the commander has signed every annex',
          'That subordinate units have rehearsed the plan',
          'That the intelligence estimate has been published',
        ],
        answerIndex: 0,
        rationale:
          'Reconciliation ensures the basic order and all annexes and appendices are complete and ' +
          'in agreement, identifying discrepancies or gaps that require corrective action.',
      }),
    },
  );
  assert.match(suggestion.stem, /orders reconciliation/i);
  assert.equal(suggestion.options.length, 4);
  assert.equal(suggestion.answer, 0);
  assert.match(suggestion.rationale, /complete and in agreement/);
});

// The reason this can be offered at all. A fluent rewrite the source does not
// support is worse than none, because it arrives looking like an improvement
// on a screen whose job is approving things.
test('a rewrite the cited passage does not support is not offered', async () => {
  const suggestion = await suggestQuestionRewrite(
    { question: QUESTION, passage: PASSAGE },
    {
      ask: reply({
        refused: false,
        stem: 'Which spacepower discipline governs orbital warfare and offensive fires?',
        options: ['Orbital Warfare', 'Space Battle Management', 'Cyber Operations', 'Space Access'],
        answerIndex: 0,
        rationale: 'Orbital Warfare concerns orbital manoeuvre and offensive and defensive fires.',
      }),
    },
  );
  assert.equal(suggestion, null);
});

test("the model's own refusal is honoured", async () => {
  const suggestion = await suggestQuestionRewrite(
    { question: QUESTION, passage: PASSAGE },
    { ask: reply({ refused: true, reason: 'the passage supports no better version' }) },
  );
  assert.equal(suggestion, null);
});

test('a rewrite that narrates the question instead of asking one is refused', async () => {
  const suggestion = await suggestQuestionRewrite(
    { question: QUESTION, passage: PASSAGE },
    {
      ask: reply({
        refused: false,
        stem: 'The lesson explains that orders reconciliation reviews the entire order. What is it for?',
        options: [
          'To ensure the basic order and all annexes and appendices are complete and in agreement',
          'To brief the commander',
          'x',
          'y',
        ],
        answerIndex: 0,
        rationale: 'The passage states that reconciliation identifies discrepancies or gaps.',
      }),
    },
  );
  assert.equal(suggestion, null, 'narration is the same defect here as in prose');
});

test('a malformed reply is refused rather than half-applied', async () => {
  const bad = [
    { refused: false, stem: '', options: ['a', 'b'], answerIndex: 0, rationale: 'x' },
    { refused: false, stem: 'A stem', options: ['only one'], answerIndex: 0, rationale: 'x' },
    { refused: false, stem: 'A stem', options: ['a', 'b'], answerIndex: 9, rationale: 'x' },
    { refused: false, stem: 'A stem', options: ['a', 'b'], rationale: 'x' },
    null,
    'not an object',
  ];
  for (const value of bad) {
    // eslint-disable-next-line no-await-in-loop
    const suggestion = await suggestQuestionRewrite(
      { question: QUESTION, passage: PASSAGE },
      { ask: reply(value) },
    );
    assert.equal(suggestion, null, JSON.stringify(value));
  }
});

test('no passage means no suggestion, without asking a model', async () => {
  let asked = false;
  const suggestion = await suggestQuestionRewrite(
    { question: QUESTION, passage: '' },
    {
      ask: async () => {
        asked = true;
        return {};
      },
    },
  );
  assert.equal(suggestion, null);
  assert.equal(asked, false, 'there is nothing to ground a rewrite in, so nothing is spent');
});

test("the instructor's own instruction reaches the model", async () => {
  let seen = '';
  await suggestQuestionRewrite(
    {
      question: QUESTION,
      passage: PASSAGE,
      instructions: 'The distractors are too easy to eliminate.',
    },
    {
      ask: async (_role, _system, prompt) => {
        seen = prompt;
        return { refused: true, reason: 'x' };
      },
    },
  );
  assert.match(seen, /too easy to eliminate/);
  assert.match(seen, /What the instructor wants changed/);
});
