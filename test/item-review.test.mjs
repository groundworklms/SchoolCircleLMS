// Per-item ratification is the gate between a generated question and a
// student. These tests pin the decision rules that make the gate real: a
// revision may rewrite the wording but never the evidence, and nothing but an
// explicit instructor decision can move an item to APPROVED.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ITEM_DECISIONS,
  itemDecisionData,
  itemReviewCounts,
  itemRevisionData,
  normaliseDecision,
} from '../lib/learning/item-review.js';

const QUESTION = {
  id: 'rec_1:s1:pre1',
  kind: 'QUESTION',
  stem: 'Where does the front sight post sit?',
  options: ['Left of the aperture', 'Centred in the aperture'],
  answer: 1,
  rationale: 'Angular error grows with range.',
  citation: { citation: 'TC 3-22.9 p.7', pubId: 'TC 3-22.9', page: '7' },
  support: 0.91,
  status: 'PENDING',
};

const LESSON = {
  id: 'rec_1:s1:lesson',
  kind: 'LESSON',
  stem: 'Sight alignment is the relationship between the post and the aperture.',
  options: null,
  answer: null,
  rationale: null,
  citation: QUESTION.citation,
  support: null,
  status: 'PENDING',
};

function rejects(fn, status, match) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status, error.message);
    if (match) assert.match(error.message, match);
    return true;
  });
}

test('the three decisions are the only ones, and each maps to one status', () => {
  assert.deepEqual(ITEM_DECISIONS, ['APPROVE', 'REJECT', 'REVISE']);
  assert.deepEqual(itemDecisionData('APPROVE', {}, QUESTION), { status: 'APPROVED' });
  assert.deepEqual(itemDecisionData('REJECT', {}, QUESTION), { status: 'REJECTED' });

  assert.equal(normaliseDecision(' approve '), 'APPROVE');
  for (const bad of ['', 'PUBLISH', 'APPROVED', null, 7, {}]) {
    rejects(() => normaliseDecision(bad), 400, /APPROVE, REJECT or REVISE/);
  }
});

test('a revision edits the authored fields and ratifies in the same action', () => {
  const data = itemDecisionData(
    'REVISE',
    { stem: '  Where does the post sit in the aperture?  ', answer: 0 },
    QUESTION,
  );
  // `support: null` is not a written score, it is the withdrawal of one. The
  // HHEM measurement on record was taken against the wording this revision has
  // just replaced, so keeping it would print a confidence number beside text no
  // entailment check has ever seen -- the same lie as an invented number,
  // reached by inertia. The item reads "not verified" until something re-measures it.
  assert.deepEqual(data, {
    stem: 'Where does the post sit in the aperture?',
    answer: 0,
    support: null,
    status: 'APPROVED',
  });
});

test('approving or rejecting an item never touches the evidence on record', () => {
  // Only a change to the item's TEXT invalidates a measurement of that text.
  // Ratifying it unchanged leaves the score that was actually measured for it.
  for (const decision of ['APPROVE', 'REJECT']) {
    const data = itemDecisionData(decision, {}, QUESTION);
    assert.ok(!('support' in data), decision + ' must not write support');
    assert.ok(!('citation' in data), decision + ' must not write citation');
  }
});

// The whole point of the guardrail: evidence is measured, not authored. A
// citation names the passage the item came from and `support` is the HHEM score
// for the keyed answer. An instructor rewording a stem cannot re-derive either,
// so a revision must never write them -- a stale support score silently
// reattached to a new answer is worse than no score at all.
test('a revision never writes citation or support, however they are supplied', () => {
  const data = itemRevisionData(
    {
      stem: 'Reworded stem',
      citation: { citation: 'Some other pub p.1', pubId: 'FABRICATED', page: '1' },
      support: 1,
      status: 'APPROVED',
      id: 'rec_1:s9:pre9',
    },
    QUESTION,
  );
  assert.deepEqual(data, { stem: 'Reworded stem' });
  for (const field of ['citation', 'support', 'status', 'id']) {
    assert.ok(!(field in data), `${field} must not be writable through a revision`);
  }
});

test('a revision must actually change something', () => {
  rejects(() => itemRevisionData({}, QUESTION), 400, /must change something/);
  rejects(() => itemRevisionData({ citation: null, support: 0 }, QUESTION), 400, /must change something/);
});

test('a rewritten stem cannot be emptied', () => {
  rejects(() => itemRevisionData({ stem: '   ' }, QUESTION), 400, /non-empty/);
  rejects(() => itemRevisionData({ stem: 42 }, QUESTION), 400, /non-empty/);
});

test('a keyed answer must index the options that will be on record', () => {
  rejects(() => itemRevisionData({ answer: 2 }, QUESTION), 400, /index into options/);
  rejects(() => itemRevisionData({ answer: -1 }, QUESTION), 400, /index into options/);
  rejects(() => itemRevisionData({ answer: 1.5 }, QUESTION), 400, /index into options/);
  // Against the NEW options, not the ones on record.
  rejects(
    () => itemRevisionData({ options: ['a', 'b'], answer: 2 }, QUESTION),
    400,
    /index into options/,
  );
  assert.deepEqual(itemRevisionData({ options: ['a', 'b', 'c'], answer: 2 }, QUESTION), {
    options: ['a', 'b', 'c'],
    answer: 2,
  });
});

test('shrinking the options strands the key on record, so the reviewer must re-key', () => {
  const twoChoices = { ...QUESTION, options: ['a', 'b', 'c'], answer: 2 };
  rejects(
    () => itemRevisionData({ options: ['a', 'b'] }, twoChoices),
    400,
    /answer is required when options change/,
  );
  // Still in range: the key on record stays untouched and is not rewritten.
  assert.deepEqual(itemRevisionData({ options: ['x', 'y', 'z'] }, twoChoices), {
    options: ['x', 'y', 'z'],
  });
});

test('options must stay a real set of choices', () => {
  rejects(() => itemRevisionData({ options: ['only one'] }, QUESTION), 400, /at least two/);
  rejects(() => itemRevisionData({ options: ['a', '  '] }, QUESTION), 400, /at least two/);
  rejects(() => itemRevisionData({ options: 'a,b' }, QUESTION), 400, /array of choice strings/);
  // Whitespace is trimmed rather than rejected.
  assert.deepEqual(itemRevisionData({ options: [' a ', ' b '], answer: 0 }, QUESTION), {
    options: ['a', 'b'],
    answer: 0,
  });
});

test('an unkeyed item has no options or answer to revise', () => {
  rejects(() => itemRevisionData({ options: ['a', 'b'] }, LESSON), 400, /no options or keyed answer/);
  rejects(() => itemRevisionData({ answer: 0 }, LESSON), 400, /no options or keyed answer/);
  assert.deepEqual(itemRevisionData({ stem: 'Rewritten lesson text' }, LESSON), {
    stem: 'Rewritten lesson text',
  });
});

test('a rationale can be cleared but not corrupted', () => {
  assert.deepEqual(itemRevisionData({ rationale: null }, QUESTION), { rationale: null });
  assert.deepEqual(itemRevisionData({ rationale: '   ' }, QUESTION), { rationale: null });
  assert.deepEqual(itemRevisionData({ rationale: ' Because. ' }, QUESTION), { rationale: 'Because.' });
  rejects(() => itemRevisionData({ rationale: 7 }, QUESTION), 400, /string or null/);
});

test('review counts make partial ratification legible', () => {
  const sections = [
    { items: [{ status: 'APPROVED' }, { status: 'PENDING' }] },
    { items: [{ status: 'REJECTED' }, { status: 'PENDING' }, { status: 'NONSENSE' }] },
    { items: null },
    null,
  ];
  assert.deepEqual(itemReviewCounts(sections), { PENDING: 2, APPROVED: 1, REJECTED: 1 });
  assert.deepEqual(itemReviewCounts(undefined), { PENDING: 0, APPROVED: 0, REJECTED: 0 });
});
