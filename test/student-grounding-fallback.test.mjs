/*
 * The grounded tutor must never hard-fail when the Orin (Anchor) is unreachable.
 *
 * On the hosted deployment the Orin sits on a USB link to a laptop and is absent,
 * so `anchorGround` used to throw and 503 the entire tutor -- killing the
 * product's central feature on the live site. The fix composes a GROUNDED
 * fallback: when, and only when, Anchor cannot be reached, the configured
 * Settings model answers STRICTLY over the same supplied, approved course
 * passages, and the unchanged cite-or-refuse stages (Sourcerer strict verify,
 * citedPassages, Understudy) still decide whether anything is delivered.
 *
 * These tests hold the integrity line that is the whole product thesis:
 *   (a) a reachable Orin still runs the Anchor pipeline; the fallback is not used.
 *   (b) Orin unavailable + supported question -> a grounded answer whose every
 *       citation maps to a supplied passage.
 *   (c) Orin unavailable + unsupported question -> an honest refusal, no citation.
 *   (d) an adversarial model that cites a passage that was NOT provided is
 *       refused, never delivered. This is the guarantee that must not break.
 *
 * Every model call is an injected fake -- there is no live model or Orin in CI,
 * and there is deliberately no way for a real request to leave the process here.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { groundedStudentAnswer } from '../lib/student-grounding.js';
import { setStoredDoctrineBaseUrl } from '../lib/doctrine.js';

const PASSAGES = [
  { id: 'p-1', text: 'Learners complete the safety check before launch.', source: 'manual p. 1' },
  { id: 'p-2', text: 'The systems check follows launch.', source: 'manual p. 2' },
];

let savedDoctrineEnv;

beforeEach(() => {
  savedDoctrineEnv = process.env.DOCTRINE_BASE_URL;
  delete process.env.DOCTRINE_BASE_URL;
  setStoredDoctrineBaseUrl(null);
});

afterEach(() => {
  if (savedDoctrineEnv === undefined) delete process.env.DOCTRINE_BASE_URL;
  else process.env.DOCTRINE_BASE_URL = savedDoctrineEnv;
  setStoredDoctrineBaseUrl(null);
});

/** A grounded model: writes a cited answer, confirms it, and judges it in-doctrine. */
function groundingChat(answer, used) {
  return async (system) => {
    if (system.includes('strict fact-checker')) {
      return { claims: [{ claim: answer, supported: true }], unsupported: [] };
    }
    if (system.includes('strict doctrine examiner')) {
      return { verdict: 'in-doctrine', conforms: true };
    }
    return { refused: false, answer, used };
  };
}

// (a) The Orin is reachable: the Anchor pipeline runs exactly as before, and the
// fallback is never reached. Proven by asserting Anchor's /api/ground was
// actually fetched and the stage is 'grounded', with no fallback marker.
test('a reachable Orin runs the Anchor pipeline and never invokes the fallback', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://anchor.test';
  let anchorFetched = false;
  const result = await groundedStudentAnswer(
    { question: 'What happens before launch?', passages: PASSAGES },
    {
      fetch: async (url, request) => {
        anchorFetched = true;
        assert.equal(url, 'http://anchor.test/api/ground');
        return {
          ok: true,
          text: async () => JSON.stringify({
            abstained: false,
            passages: JSON.parse(request.body).passages,
            contract: 'schoolcircle-grounding-v1',
          }),
        };
      },
      chat: groundingChat('Learners complete the safety check before launch. [1]', [1]),
    },
  );

  assert.equal(anchorFetched, true, 'Anchor must be contacted first when the Orin is reachable');
  assert.equal(result.refused, false);
  assert.equal(result.stages.anchor.status, 'grounded');
  assert.equal('fallback' in result.stages, false, 'the fallback marker must be absent on the Anchor path');
  assert.deepEqual(result.citations, [{ n: 1, ...PASSAGES[0] }]);
});

// (b) The Orin is unavailable and the passages support the question: the model
// composes a grounded answer over the supplied passages, and every citation
// maps to one of the provided passages (id, text, and source all match).
test('Orin unavailable + supported question -> grounded fallback, every citation maps to a provided passage', async () => {
  let anchorContacted = false;
  const result = await groundedStudentAnswer(
    { question: 'What happens before launch?', passages: PASSAGES },
    {
      // No Orin address is configured, so anchorGround short-circuits before any
      // network call. If the fallback ever tried to reach Anchor, this fails.
      fetch: async () => { anchorContacted = true; assert.fail('Anchor must not be contacted when unavailable'); },
      chat: groundingChat('Learners complete the safety check before launch. [1]', [1]),
    },
  );

  assert.equal(anchorContacted, false);
  assert.equal(result.refused, false, 'a supported question must be answerable via the fallback');
  assert.equal(result.stages.anchor.status, 'unavailable', 'Anchor is honestly marked unavailable');
  assert.equal(result.stages.fallback, 'model-grounded', 'the record shows the model-grounded path answered');

  assert.ok(result.citations.length > 0, 'a delivered answer must carry citations');
  const provided = new Map(PASSAGES.map((p) => [p.id, p]));
  for (const citation of result.citations) {
    const source = provided.get(citation.id);
    assert.ok(source, `citation id ${citation.id} must be a provided passage`);
    assert.equal(citation.text, source.text, 'citation text must be the provided passage text verbatim');
    assert.equal(citation.source, source.source, 'citation source must be the provided passage source verbatim');
    // The inline marker the prose carries must be exactly this citation's number.
    assert.match(result.answer, new RegExp(`\\[${citation.n}\\]`));
  }
});

// (c) The Orin is unavailable and nothing supports the question: the fallback
// must REFUSE and invent no citation -- an honest "unavailable"/"unsupported" is
// required, and is strictly better than a fabricated cite. Two shapes of
// non-answer are checked: an explicit model refusal, and content with no marker.
test('Orin unavailable + unsupported question -> the fallback refuses and fabricates no citation', async () => {
  const declined = await groundedStudentAnswer(
    { question: 'What happens before launch?', passages: PASSAGES },
    { chat: async () => ({ refused: true, answer: '', used: [] }) },
  );
  assert.equal(declined.refused, true);
  assert.equal(declined.reason, 'unsupported');
  assert.deepEqual(declined.citations, []);
  assert.equal(declined.stages.anchor.status, 'unavailable');
  assert.equal(declined.stages.fallback, 'model-grounded');

  // Content the model did not cite is uncited, not cited-loosely: refuse it and
  // never let the ungrounded prose reach the learner.
  const uncited = 'Learners salute the range officer before launch.';
  const uncitedResult = await groundedStudentAnswer(
    { question: 'What happens before launch?', passages: PASSAGES },
    {
      chat: async (system) => {
        if (system.includes('strict doctrine examiner')) assert.fail('an uncited answer must never be judged');
        return { refused: false, answer: uncited, used: [1] };
      },
    },
  );
  assert.equal(uncitedResult.refused, true);
  assert.deepEqual(uncitedResult.citations, []);
  assert.notEqual(uncitedResult.answer, uncited, 'the ungrounded prose must not be delivered');
});

// (d) THE INTEGRITY GUARANTEE. The adversarial model cites [3]/used:[3] -- a
// passage index that was never provided (only two passages exist). Because the
// fallback authorizes ONLY the supplied passages, index 3 is out of range and
// the answer is refused; no fabricated citation and no fabricated prose reach
// the learner.
//
// This test has teeth: it is proven to fail if the fallback ever admits an
// unprovided passage into its authorized set. To confirm, apply this ONE-LINE
// mutation to lib/student-grounding.js (the fallback branch of
// runGroundedStudentAnswer) and rerun -- (d) turns red because index 3 then
// resolves to the injected ghost and is delivered:
//
//   -    anchored = { abstained: false, passages: scope };
//   +    anchored = { abstained: false, passages: [...scope,
//   +      { id: 'ghost', text: 'Position varies.', source: 'not-a-course-source' }] };
//
// (The ghost is crafted to rank last so index 3 selects it, and its text equals
// the adversary's answer body so the grounding proxy would pass -- isolating the
// citation-provenance check as the only thing standing between the fabricated
// citation and the learner.) Revert the mutation to restore the guarantee.
test('the fallback refuses a citation to a passage that was not provided (adversarial)', async () => {
  const fabricated = 'Position varies.';
  const adversary = async (system) => {
    if (system.includes('strict fact-checker')) {
      return { claims: [{ claim: fabricated, supported: true }], unsupported: [] };
    }
    if (system.includes('strict doctrine examiner')) {
      return { verdict: 'in-doctrine', conforms: true };
    }
    // Cite passage 3 -- there is no passage 3 among the two supplied passages.
    return { refused: false, answer: `${fabricated} [3]`, used: [3] };
  };

  const result = await groundedStudentAnswer(
    // The question overlaps BOTH real passages strongly (so both are retrieved at
    // indices 1 and 2, making [3] genuinely beyond the provided set) and overlaps
    // the fabricated body weakly on "position" (so a mutated ghost would rank
    // last, at index 3, and be retrievable). Correct code retrieves only the two
    // real passages, so [3] is out of range and refused.
    { question: 'What safety check happens before launch and which systems check follows, and does position matter?', passages: PASSAGES },
    { chat: adversary },
  );

  assert.equal(result.refused, true, 'a citation to an unprovided passage must be refused');
  assert.deepEqual(result.citations, [], 'no citation may be fabricated for the missing passage');
  assert.notEqual(result.answer, `${fabricated} [3]`, 'the fabricated prose must never be delivered');
  assert.equal(result.stages.anchor.status, 'unavailable');
  assert.equal(result.stages.fallback, 'model-grounded');
});
