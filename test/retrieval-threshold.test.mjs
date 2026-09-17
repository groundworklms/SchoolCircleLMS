/*
 * The retrieval floor is configurable; cite-or-refuse is not.
 *
 * Two independent thresholds sat in series on the learner path. Anchor selects
 * candidate passages with a cross-encoder reranker (unbounded logits, relative
 * selection), and Sourcerer then re-scored those ALREADY-AUTHORIZED passages
 * with `keywordRetriever` -- query-term coverage in [0, 1] -- and refused
 * `below_threshold` under a hardcoded 0.2 before any model call happened. The
 * two numbers are not in the same space, so the constant could not be correct
 * for both, and the cost landed entirely on real questions: coverage is divided
 * by the length of the QUESTION, so a precisely-worded doctrine question clears
 * a higher bar than a terse one.
 *
 * These tests pin the two halves of the fix:
 *   1. the floor is env-tunable and defaults to inert;
 *   2. nothing about that makes an UNCITED answer reachable -- every way a model
 *      can fail to ground still refuses, with no citations, at the most
 *      permissive floor there is.
 *
 * Hermetic: Anchor and the model are both injected. The doctrine text below is
 * a verbatim chunk from the indexed corpus (MCDP 1, Ch 1, "War Defined", para 2,
 * p.3) as returned by the live Anchor, so the coverage arithmetic these tests
 * rely on is arithmetic over real doctrine prose rather than over a fixture
 * written to make the numbers work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { keywordRetriever } from 'sourcerer';

import { groundedStudentAnswer } from '../lib/student-grounding.js';

const ANCHOR_CONTRACT = 'schoolcircle-grounding-v1';

/** Verbatim indexed chunk (live Anchor, POST /api/learn/answer -> source_text). */
const DOCTRINE = {
  id: 'mcdp1-war-defined',
  text:
    'The essence of war is a violent struggle between two hostile, independent, and irreconcilable wills, '
    + 'each trying to impose itself on the other. War is fundamentally an interactive social process. '
    + 'Clausewitz called it a Zweikampf (literally a "two-struggle") and suggested the image of a pair of '
    + 'wrestlers locked in a hold, each exerting force and counterforce to try to throw the other. War is '
    + 'thus a process of continuous mutual adaptation, of give and take, move and countermove. It is '
    + 'critical to keep in mind that the enemy is not an inanimate object to be acted upon but an '
    + 'independent and animate force with its own objectives and plans. While we try to impose our will on '
    + 'the enemy, he resists us and seeks to impose his own will on us. Appreciating this dynamic interplay '
    + 'between opposing human wills is essential to understanding the fundamental nature of war.',
  source: 'MCDP 1, (20 June 1997), Ch 1: The Nature of War, "War Defined", para 2, p.3',
};

/**
 * A second verbatim indexed chunk. It shares "planning" and "decisions" with the
 * question below, so it survives the lexical filter and ranks second -- which is
 * what makes a marker/`used` disagreement between two IN-RANGE passages
 * reachable, and so lets the citation set-equality check be exercised for real
 * rather than short-circuited by an out-of-range index.
 */
const SECOND_DOCTRINE = {
  id: 'mcdp5-planning-defined',
  text:
    'Planning involves projecting our thoughts forward in time and space to influence events before they '
    + 'occur rather than merely responding to events as they occur. This means contemplating and evaluating '
    + 'potential decisions and actions in advance. It involves thinking through the consequences of certain '
    + 'potential actions in order to estimate whether they will bring us closer to the desired future. In '
    + 'war, this naturally involves trying to anticipate possible enemy responses to our actions. Planning '
    + 'also involves integrating these individual decisions and actions together into potential sequences '
    + 'and examining the possible implications of these sequences.',
  source: 'MCDP 5, (21 July 1997), Ch 1: The Nature of Planning, "Planning and Plans Defined", para 4, p.4',
};

/** Shares no content words with the question below, so the lexical filter drops it. */
const UNRELATED = {
  id: 'unrelated-logistics',
  text: 'Refrigerated shipping containers require a dedicated generator set aboard the vessel.',
  source: 'MCDP 1-0, Ch 9, "Sustainment", para 4, p.9-2',
};

const PASSAGES = [DOCTRINE, UNRELATED];
const TWO_SURVIVORS = [DOCTRINE, SECOND_DOCTRINE, UNRELATED];

/*
 * A fair, precisely-worded question that MCDP 1's "War Defined" paragraph does
 * answer. It is deliberately phrased the way a student actually writes, which is
 * exactly what the coverage metric punishes: the extra words land in the
 * denominator and never appear in doctrine prose.
 */
const VERBOSE_QUESTION =
  'Could you explain, in your own words, how Marine Corps doctrine characterizes the reciprocal nature '
  + 'of a contest between two opposing belligerents, and why that characterization matters for practical '
  + 'planning decisions at the battalion level during a sustained campaign?';

/** A grounded answer that reuses the passage's vocabulary, as a real cited answer does. */
const GROUNDED_ANSWER =
  'War is a violent struggle between two hostile, independent, and irreconcilable wills, each trying to '
  + 'impose itself on the other, and it is therefore a process of continuous mutual adaptation of move and '
  + 'countermove. [1]';

function anchorAuthorizing(passages = PASSAGES) {
  return async (url, request) => {
    assert.match(String(url), /\/api\/ground$/);
    const sent = JSON.parse(request.body);
    const selected = passages.filter((passage) => sent.passages.some((p) => p.id === passage.id));
    const body = { abstained: false, passages: selected, contract: ANCHOR_CONTRACT };
    return { ok: true, text: async () => JSON.stringify(body) };
  };
}

/**
 * A model that grounds correctly. `answer`/`used` are overridable so each
 * cite-or-refuse test can inject one specific failure and change nothing else.
 */
function model({ answer = GROUNDED_ANSWER, used = [1], refused = false, faithful = true, verdict = 'in-doctrine' } = {}) {
  const calls = [];
  const chat = async (system, prompt) => {
    calls.push({ system, prompt });
    if (system.includes('strict fact-checker')) {
      return faithful
        ? { claims: [{ claim: 'War is a violent struggle between two wills.', supported: true }], unsupported: [] }
        : { claims: [{ claim: 'invented claim', supported: false }], unsupported: ['invented claim'] };
    }
    if (system.includes('strict doctrine examiner')) {
      return { verdict, conforms: verdict === 'in-doctrine', reasons: 'judged' };
    }
    return refused ? { refused: true, answer: '', used: [] } : { refused: false, answer, used };
  };
  return { chat, calls };
}

async function ask(question, dependencies = {}, env = {}) {
  const saved = {};
  for (const [key, value] of Object.entries({ DOCTRINE_BASE_URL: 'http://anchor.test', ...env })) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await groundedStudentAnswer(
      { question, passages: dependencies.passages ?? PASSAGES, history: [] },
      { fetch: dependencies.fetch ?? anchorAuthorizing(), chat: dependencies.chat },
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The premise: this question really does sit in the over-refusal band
 * ------------------------------------------------------------------ */

test('the motivating case genuinely scores between 0 and the old 0.2 floor', async () => {
  // Measured with the pinned scorer the gate actually uses, so the tests below
  // are not resting on a hand-computed constant that could drift.
  const ranked = await keywordRetriever(PASSAGES)(VERBOSE_QUESTION, PASSAGES.length);
  assert.ok(ranked.length > 0, 'the doctrine passage must survive the lexical filter');
  assert.equal(ranked[0].source, DOCTRINE.source, 'the doctrine passage must rank first');
  assert.ok(
    ranked[0].score > 0 && ranked[0].score < 0.2,
    `expected top coverage in (0, 0.2) so the old floor would refuse it; got ${ranked[0].score}`,
  );
});

/* ------------------------------------- *
 * Half one: the floor is a tuning knob
 * ------------------------------------- */

test('by default the retrieval floor no longer refuses an answerable doctrine question', async () => {
  const { chat } = model();
  const result = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: undefined });

  assert.equal(result.refused, false, `expected an answer, got refusal ${result.reason}`);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].source, DOCTRINE.source);
  assert.equal(result.stages.understudy.status, 'accepted');
});

test('SOURCERER_MIN_SCORE raises the floor again without a code change', async () => {
  const { chat } = model();
  const result = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: '0.2' });

  assert.equal(result.refused, true, 'a floor of 0.2 must still be able to refuse this question');
  assert.equal(result.reason, 'below_threshold');
  assert.deepEqual(result.citations, []);
});

test('the floor is read per call, so retuning it needs no restart', async () => {
  const { chat } = model();
  const refused = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: '0.9' });
  assert.equal(refused.reason, 'below_threshold');

  const answered = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: '0' });
  assert.equal(answered.refused, false, 'the same process must honour a new value on the next call');
});

for (const bad of ['abc', '-0.5', '1.5', '', '   ', 'NaN', 'Infinity']) {
  test(`an unusable SOURCERER_MIN_SCORE (${JSON.stringify(bad)}) falls back to the default instead of refusing everything`, async () => {
    const { chat } = model();
    const result = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: bad });
    // A value outside [0,1] cannot mean anything in a coverage space. Honouring
    // it literally would either refuse every question (>1) or be a silent no-op
    // (<0); a typo at an event must not take the tutor down.
    assert.equal(result.refused, false, `${JSON.stringify(bad)} must not become a refusal`);
    assert.equal(result.citations.length, 1);
  });
}

/* ----------------------------------------------------------------- *
 * Half two: cite-or-refuse, at the most permissive floor there is
 * ----------------------------------------------------------------- */

const UNCITABLE = [
  {
    name: 'the model names no passages',
    model: { used: [] },
    reason: 'no_citation',
  },
  {
    name: 'the model names a passage but writes no inline marker',
    model: { answer: 'War is a violent struggle between two irreconcilable wills.', used: [1] },
    reason: 'no_citation',
  },
  {
    name: 'the model cites a passage index that was never retrieved',
    model: { answer: 'War is a violent struggle between two irreconcilable wills. [9]', used: [9] },
    reason: 'no_citation',
  },
  {
    name: 'the model cites a passage index outside what survived retrieval',
    // Only one passage survives the lexical filter here, so index 2 is not a
    // real retrieved passage and Sourcerer rejects it before the set check.
    model: { answer: 'War is a violent struggle between two irreconcilable wills. [1]', used: [2] },
    reason: 'no_citation',
  },
  {
    name: 'the model declines',
    model: { refused: true },
    reason: 'unsupported',
  },
  {
    name: 'the answer is not entailed by its own sources',
    model: { faithful: false },
    reason: 'unfaithful',
  },
  {
    name: 'the doctrine examiner rejects it',
    model: { verdict: 'off-doctrine' },
    reason: 'understudy_rejected',
  },
];

for (const scenario of UNCITABLE) {
  test(`cite-or-refuse holds with the floor inert: ${scenario.name}`, async () => {
    const { chat } = model(scenario.model);
    const result = await ask(VERBOSE_QUESTION, { chat }, { SOURCERER_MIN_SCORE: '0' });

    assert.equal(result.refused, true, 'an ungrounded candidate must never be delivered');
    assert.equal(result.reason, scenario.reason);
    assert.deepEqual(result.citations, [], 'a refusal must not carry citations');
  });
}

test('no uncited answer is reachable by any of these paths, at any floor', async () => {
  // The single property the system may never lose, asserted over the whole
  // matrix rather than once per case: refused, or cited. Never neither.
  //
  // The matrix must include a case that reaches `citedPassages`, not only cases
  // Sourcerer rejects first -- otherwise the set-equality check is never
  // exercised here and this test would pass while that guard was removed.
  const matrix = [
    ...UNCITABLE.map((scenario) => ({ ...scenario, passages: PASSAGES })),
    {
      name: 'markers and used disagree with both in range',
      model: { answer: 'War is a violent struggle between two irreconcilable wills. [1]', used: [2] },
      passages: TWO_SURVIVORS,
    },
    { name: 'well-formed', model: {}, passages: PASSAGES },
  ];
  for (const floor of ['0', '0.05', undefined, '0.2']) {
    for (const scenario of matrix) {
      const { chat } = model(scenario.model || {});
      const result = await ask(
        VERBOSE_QUESTION,
        { chat, passages: scenario.passages, fetch: anchorAuthorizing(scenario.passages) },
        { SOURCERER_MIN_SCORE: floor },
      );
      const cited = Array.isArray(result.citations) && result.citations.length > 0;
      assert.ok(
        result.refused === true || cited,
        `floor=${floor} scenario=${scenario.name || 'well-formed'} produced an answer with no citation`,
      );
      if (result.refused !== true) {
        assert.ok(
          result.citations.every((citation) => typeof citation.source === 'string' && citation.source),
          'every citation on a delivered answer must name its source',
        );
      }
    }
  }
});

test('an answer whose markers and used set disagree is refused, both being in range', async () => {
  // Two passages survive retrieval, so [1] and [2] are both real. The prose
  // leans on [1] while `used` declares [2]: the evidence handed to Understudy
  // would not be the evidence the answer rests on, so it cannot be delivered.
  const { chat } = model({
    answer: 'War is a violent struggle between two irreconcilable wills. [1]',
    used: [2],
  });
  const result = await ask(
    VERBOSE_QUESTION,
    { chat, passages: TWO_SURVIVORS, fetch: anchorAuthorizing(TWO_SURVIVORS) },
    { SOURCERER_MIN_SCORE: '0' },
  );

  assert.equal(result.refused, true);
  assert.equal(result.reason, 'citation_invalid');
  assert.deepEqual(result.citations, []);
});

test('two surviving passages really are both in range, so the check above is not vacuous', async () => {
  const ranked = await keywordRetriever(TWO_SURVIVORS)(VERBOSE_QUESTION, TWO_SURVIVORS.length);
  assert.equal(ranked.length, 2, 'exactly the two doctrine passages must survive the lexical filter');
  assert.equal(ranked[0].source, DOCTRINE.source);
  assert.equal(ranked[1].source, SECOND_DOCTRINE.source);
});

test('an answer is only ever cited to passages Anchor authorized', async () => {
  // Anchor authorizes ONLY the unrelated passage; the model then tries to cite
  // the doctrine passage it was never given. That must not become a citation.
  const { chat } = model({
    answer: 'War is a violent struggle between two irreconcilable wills. [1]',
    used: [1],
  });
  const result = await ask(
    VERBOSE_QUESTION,
    {
      chat,
      fetch: async (url, request) => {
        const sent = JSON.parse(request.body);
        const only = sent.passages.filter((passage) => passage.id === UNRELATED.id);
        return {
          ok: true,
          text: async () => JSON.stringify({ abstained: false, passages: only, contract: ANCHOR_CONTRACT }),
        };
      },
    },
    { SOURCERER_MIN_SCORE: '0' },
  );

  if (result.refused !== true) {
    assert.ok(
      result.citations.every((citation) => citation.source === UNRELATED.source),
      'a citation must never point outside the passages Anchor authorized',
    );
  }
});

test('an Anchor abstention still refuses regardless of the floor', async () => {
  const { chat } = model();
  const result = await ask(
    VERBOSE_QUESTION,
    {
      chat,
      fetch: async () => ({
        ok: true,
        text: async () => JSON.stringify({ abstained: true, passages: [], contract: ANCHOR_CONTRACT }),
      }),
    },
    { SOURCERER_MIN_SCORE: '0' },
  );

  assert.equal(result.refused, true);
  assert.equal(result.reason, 'anchor_abstained');
  assert.deepEqual(result.citations, []);
});
