import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attemptsLeft,
  citedPages,
  criteriaProgress,
  currentCriterion,
  exchanges,
  sessionProgress,
} from '../lib/learning/mastery-progress.js';

const SESSION = {
  eloIndex: 1,
  exchanges: 4,
  maxTurns: 12,
  maxAttemptsPerCriterion: 3,
  attempts: [3, 1, 0],
  criteria: [
    { elo: 'Frame the problem', verdict: 'mastered' },
    { elo: 'Design the course of action', verdict: null },
    { elo: 'Wargame the course of action', verdict: null },
  ],
};

test('the criterion the current question is aimed at is named', () => {
  assert.deepEqual(currentCriterion(SESSION), {
    index: 1,
    name: 'Design the course of action',
    verdict: null,
  });
});

test('a finished session is aimed at nothing, rather than clamping to the last criterion', () => {
  // Clamping would print a criterion beside a question that is not being
  // asked, which reads as "you are still on this one" at the end of a session.
  assert.equal(currentCriterion({ ...SESSION, eloIndex: 3 }), null);
  assert.equal(currentCriterion({ ...SESSION, eloIndex: null }), null);
  assert.equal(currentCriterion(null), null);
});

test('a criterion recorded as competency rather than elo is still named', () => {
  const session = { eloIndex: 0, criteria: [{ competency: 'Frame the problem' }] };
  assert.equal(currentCriterion(session).name, 'Frame the problem');
});

test('progress is counted against the budget the session actually spends from', () => {
  // Whetstone counts `exchanges` against maxTurns; `turns` is its own tally and
  // the two are not interchangeable.
  assert.deepEqual(sessionProgress(SESSION), { used: 4, total: 12, left: 8, nearlyDone: false });
  assert.deepEqual(
    sessionProgress({ turns: 9, maxTurns: 12 }),
    { used: 9, total: 12, left: 3, nearlyDone: false },
    'falls back to turns when exchanges is absent',
  );
});

test('the last couple of exchanges are called out, because the session ends when the budget does', () => {
  assert.equal(sessionProgress({ exchanges: 10, maxTurns: 12 }).nearlyDone, true);
  assert.equal(sessionProgress({ exchanges: 12, maxTurns: 12 }).nearlyDone, false, 'over is not nearly');
  assert.equal(sessionProgress({ exchanges: 13, maxTurns: 12 }).used, 12, 'never past the total');
});

test('a session with no budget reports none rather than zero of zero', () => {
  // 0/0 says the session is both finished and not started.
  assert.equal(sessionProgress({ exchanges: 0 }), null);
  assert.equal(sessionProgress(null), null);
});

/*
 * A learner who does not know this gets three shots at something, spends two
 * warming up, and never finds out the third was the last.
 */
test('attempts left on the live criterion are reported', () => {
  assert.deepEqual(attemptsLeft(SESSION), { used: 1, max: 3, left: 2 });
});

test('attempts keyed by criterion name rather than position still count', () => {
  const session = { ...SESSION, attempts: { 'Design the course of action': 2 } };
  assert.deepEqual(attemptsLeft(session), { used: 2, max: 3, left: 1 });
});

test('no live criterion or no cap means no attempt count to show', () => {
  assert.equal(attemptsLeft({ ...SESSION, eloIndex: 9 }), null);
  assert.equal(attemptsLeft({ ...SESSION, maxAttemptsPerCriterion: null }), null);
});

/*
 * Counted from the verdicts, not the cursor. Whetstone can move past a
 * criterion without reaching one, and reporting the cursor would tell a learner
 * four of six were done when two were skipped.
 */
test('only criteria with a verdict count as assessed', () => {
  assert.deepEqual(criteriaProgress(SESSION), { total: 3, assessed: 1, mastered: 1 });
  const skipped = {
    criteria: [
      { elo: 'a', verdict: 'mastered' },
      { elo: 'b', verdict: null },
      { elo: 'c', verdict: 'developing' },
      { elo: 'd', verdict: 'not assessed' },
    ],
  };
  assert.deepEqual(criteriaProgress(skipped), { total: 4, assessed: 2, mastered: 1 });
  assert.deepEqual(criteriaProgress(null), { total: 0, assessed: 0, mastered: 0 });
});

/* The transcript was rendered as one list item per entry with a JSON.stringify
   fallback, so a learner reviewing a session read the questions and their own
   answers as one undifferentiated column. */
test('a transcript becomes a conversation, question then answer', () => {
  const turns = exchanges(['What is reconciliation for?', 'To check the order agrees.', 'And the crosswalk?']);
  assert.deepEqual(turns.map((turn) => turn.role), ['question', 'answer', 'question']);
  assert.equal(turns[1].text, 'To check the order agrees.');
});

test('an entry that states its own role is believed, and the alternation resumes from it', () => {
  const turns = exchanges([
    { role: 'assistant', text: 'First question.' },
    { role: 'learner', text: 'My answer.' },
    'Next question.',
    'Next answer.',
  ]);
  assert.deepEqual(turns.map((turn) => turn.role), ['question', 'answer', 'question', 'answer']);
});

test('empty and unreadable entries are dropped rather than printed as objects', () => {
  const turns = exchanges(['   ', null, { nothing: true }, 'A real question.']);
  assert.deepEqual(turns, [{ role: 'question', text: 'A real question.' }]);
  assert.deepEqual(exchanges(null), []);
});

/* One citation per retrieved chunk means a nine-page source can carry forty
   entries, and forty numbers say less than nine. */
test('cited pages are deduplicated and ordered', () => {
  assert.deepEqual(
    citedPages([{ page: 7 }, { page: 2 }, { page: 7 }, { page: 11 }, { page: 2 }]),
    [2, 7, 11],
  );
  assert.deepEqual(citedPages([{ page: 'not a page' }, {}, null]), []);
  assert.deepEqual(citedPages(null), []);
});
