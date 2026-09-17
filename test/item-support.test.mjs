import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VERIFY_MAX_CLAIM_CHARS,
  VERIFY_MAX_SPANS,
  VERIFY_MAX_SPAN_CHARS,
  verifyClaim,
} from '../lib/doctrine.js';
import {
  itemVerificationTargets,
  measuredSupport,
  projectCourseRows,
} from '../lib/learning/project-course.js';
import { measureItemSupport } from '../lib/learning/verify-support.js';

/**
 * `Item.support` is the product's "Verified" claim made good: an on-device HHEM
 * entailment check, scoring what an item ASSERTS against the passage text its
 * own citation resolves to.
 *
 * Every test here defends one rule -- a support score is a measurement or it is
 * nothing. There is no default, no estimate and no carried-forward value
 * anywhere in this path, so the interesting cases are all the ways
 * verification can fail: each must leave the id out of the map, leave
 * `Item.support` null, and let the approval succeed anyway.
 *
 * The verifier is never called for real. The live endpoint runs a model on an
 * 8GB board; these are stubs shaped like the responses it actually returns,
 * taken from probing it (an entailed claim ~0.84, an unsupported one ~0.005).
 */

/* ------------------------------ fixtures ------------------------------- */

const PAGE_4 =
  'Sight alignment is the relationship between the front sight post and the rear aperture. The post must be centred in the aperture and level across its top edge.';
const PAGE_5 =
  'Trigger control is the smooth rearward pressure applied straight to the rear without disturbing the sights. Jerking the trigger drives the muzzle off the target.';
const PAGE_6 =
  'A natural point of aim is where the rifle settles when the body is relaxed. Shift the hips rather than muscling the weapon onto the target.';

// The shape lib/arsenal-core.js `sourcePassageIndex` produces: every page part
// carries the bare source label plus its own "<label> p.N".
const PASSAGES = [
  { labels: ['src_1', 'src_1 p.4'], text: PAGE_4 },
  { labels: ['src_1', 'src_1 p.5'], text: PAGE_5 },
  { labels: ['src_1', 'src_1 p.6'], text: PAGE_6 },
];

const LESSON =
  'Sight alignment is the relationship between the front sight post and the rear aperture.';

function draft(overrides = {}) {
  return {
    title: 'Marksmanship fundamentals',
    sourceIds: ['src_1'],
    sections: [
      {
        title: 'Fundamentals',
        cite: 'src_1 p.4',
        cites: ['src_1 p.4', 'src_1 p.5', 'src_1 p.6'],
        lesson: LESSON,
        pre: [{
          stem: 'What does jerking the trigger disturb?',
          options: ['The muzzle', 'The aperture'],
          answer: 0,
          rationale:
            'Jerking the trigger drives the muzzle off the target; smooth rearward pressure straight to the rear does not.',
        }],
        post: [{
          stem: 'How is a natural point of aim corrected?',
          options: ['Shift the hips', 'Muscle the weapon across'],
          answer: 0,
          rationale:
            'A natural point of aim is where the rifle settles when the body is relaxed; shift the hips rather than muscling the weapon.',
        }],
        ...overrides,
      },
    ],
    scenario: {
      situation: 'You are on the 300 m line and your group is stringing vertically.',
      task: 'Call the correction.',
      coaching: 'Check alignment first.',
    },
  };
}

function projected(section) {
  return projectCourseRows('rec_v', draft(section), {
    sourceId: 'TC 3-22.9',
    passages: PASSAGES,
  }).sections;
}

/* --------------------------- the HTTP client ---------------------------- */

const VERIFIER = 'http://verifier.test:8000';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function rawResponse(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** Install a stubbed /api/verify for one test and always restore the globals. */
async function withVerifier(handler, run, { baseUrl = VERIFIER } = {}) {
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.DOCTRINE_BASE_URL;
  if (baseUrl === null) delete process.env.DOCTRINE_BASE_URL;
  else process.env.DOCTRINE_BASE_URL = baseUrl;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return handler(call);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.DOCTRINE_BASE_URL;
    else process.env.DOCTRINE_BASE_URL = savedUrl;
  }
}

test('an entailed claim gets a real score and an unsupported one a low score', async () => {
  await withVerifier(
    ({ body }) => jsonResponse({
      ok: true,
      support: body.spans.join(' ').includes(body.claim) ? 0.8366 : 0.0052,
      spans: body.spans.length,
      backend: 'hhem',
    }),
    async (calls) => {
      const entailed = await verifyClaim({ claim: LESSON, spans: [PAGE_4] });
      assert.deepEqual(entailed, { ok: true, support: 0.8366, spans: 1, backend: 'hhem' });

      // A low score is still a MEASUREMENT. "The source does not support this"
      // is the finding the check exists to produce, not a failure to record.
      const invented = await verifyClaim({
        claim: 'The rear aperture is adjusted for elevation with the windage knob.',
        spans: [PAGE_4],
      });
      assert.equal(invented.ok, true);
      assert.equal(invented.support, 0.0052);

      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, `${VERIFIER}/api/verify`);
      assert.equal(calls[0].init.method, 'POST');
      assert.deepEqual(calls[0].body, { claim: LESSON, spans: [PAGE_4] });
    },
  );
});

test('every failure shape is "not verified", and none of them throws', async () => {
  const failures = [
    // The service's own contract: it answers ok:false rather than raising, so a
    // caller that cannot verify can record nothing and carry on.
    [() => jsonResponse({ ok: false, error: 'verifier_unavailable' }), 'verifier_unavailable'],
    [() => jsonResponse({ ok: false, error: 'verify_failed' }), 'verify_failed'],
    [() => jsonResponse({ ok: false }), 'not_ok'],
    // Request validation and a dead model are both "no measurement".
    [() => jsonResponse({ detail: 'too long' }, 422), 'http_422'],
    [() => jsonResponse({}, 500), 'http_500'],
    // 200 carrying a proxy error page or the service's own index.
    [() => rawResponse('<html>captive portal</html>'), 'bad_response'],
    // A number that is not a probability is not a measurement.
    [() => jsonResponse({ ok: true, support: '0.9' }), 'bad_support'],
    [() => jsonResponse({ ok: true, support: null }), 'bad_support'],
    [() => jsonResponse({ ok: true }), 'bad_support'],
    [() => jsonResponse({ ok: true, support: 1.4 }), 'bad_support'],
    [() => jsonResponse({ ok: true, support: -0.1 }), 'bad_support'],
    [() => { throw new TypeError('fetch failed'); }, 'unreachable'],
  ];
  for (const [handler, reason] of failures) {
    await withVerifier(handler, async () => {
      const result = await verifyClaim({ claim: LESSON, spans: [PAGE_4] });
      assert.deepEqual(result, { ok: false, reason }, reason);
      assert.ok(!('support' in result), `a failure must not carry a score: ${reason}`);
    });
  }
});

test('a hung verifier aborts on its own timeout rather than hanging the caller', async () => {
  await withVerifier(
    ({ init }) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
    async () => {
      const result = await verifyClaim({ claim: LESSON, spans: [PAGE_4], timeoutMs: 20 });
      assert.deepEqual(result, { ok: false, reason: 'timeout' });
    },
  );
});

test('the endpoint bounds are respected, and an over-long claim is never truncated', async () => {
  await withVerifier(
    () => jsonResponse({ ok: true, support: 0.5, spans: 1, backend: 'hhem' }),
    async (calls) => {
      // Twelve spans, each enormous. Spans ARE cut down, because less evidence
      // can only make an entailment harder to find: the error runs toward "not
      // supported", never toward a flattering number.
      const many = Array.from(
        { length: 12 },
        (_, index) => `passage ${index} ${'x'.repeat(20_000)}`,
      );
      await verifyClaim({ claim: LESSON, spans: many });
      assert.equal(calls[0].body.spans.length, VERIFY_MAX_SPANS);
      assert.equal(calls[0].body.spans[0].length, VERIFY_MAX_SPAN_CHARS);
      assert.ok(calls[0].body.spans[0].startsWith('passage 0 '));

      // The CLAIM is not truncated: a score for the first 4000 characters of a
      // longer lesson is not a score for that lesson. It is simply unverified,
      // and the request is not made at all.
      const tooLong = 'A'.repeat(VERIFY_MAX_CLAIM_CHARS + 1);
      assert.deepEqual(
        await verifyClaim({ claim: tooLong, spans: [PAGE_4] }),
        { ok: false, reason: 'claim_too_long' },
      );
      assert.equal(calls.length, 1, 'an over-long claim must not reach the board');

      // Nothing asserted, or nothing to check it against.
      assert.deepEqual(await verifyClaim({ claim: '  ', spans: [PAGE_4] }), { ok: false, reason: 'no_claim' });
      assert.deepEqual(await verifyClaim({ claim: LESSON, spans: [] }), { ok: false, reason: 'no_spans' });
      assert.deepEqual(await verifyClaim({ claim: LESSON, spans: ['  '] }), { ok: false, reason: 'no_spans' });
      assert.deepEqual(await verifyClaim({}), { ok: false, reason: 'no_claim' });
      assert.equal(calls.length, 1);
    },
  );
});

test('an unconfigured doctrine service verifies nothing and calls nothing', async () => {
  await withVerifier(
    () => { throw new Error('must not be reached'); },
    async (calls) => {
      assert.deepEqual(
        await verifyClaim({ claim: LESSON, spans: [PAGE_4] }),
        { ok: false, reason: 'no_doctrine_service' },
      );
      assert.equal(calls.length, 0);
    },
    { baseUrl: null },
  );
});

/* ------------------------- what gets measured --------------------------- */

test("the spans sent are the passages the item's own citation resolves to", () => {
  const sections = projected();
  const targets = itemVerificationTargets(sections, PASSAGES);

  // Per-item citation resolution already decided which passage each item came
  // from. Verification reuses that decision rather than re-resolving: a score
  // measured against a passage the citation does not name would grade the item
  // on text the instructor is not being shown.
  assert.deepEqual(
    targets.map((target) => [target.id, target.spans]),
    [
      ['rec_v:s1:lesson', [PAGE_4]],
      ['rec_v:s1:pre1', [PAGE_5]],
      ['rec_v:s1:post1', [PAGE_6]],
    ],
  );
  assert.deepEqual(
    sections[0].items.map((item) => item.citation.citation),
    ['src_1 p.4', 'src_1 p.5', 'src_1 p.6'],
  );

  // And every target id is an id the transaction will actually write.
  const willBeWritten = new Set(
    sections.flatMap((section) => section.items.map((item) => item.id)),
  );
  for (const target of targets) assert.ok(willBeWritten.has(target.id), target.id);
});

test('the claim is the assertion: lesson prose, or the stem with its KEYED answer', () => {
  const [lesson, pre, post] = itemVerificationTargets(projected(), PASSAGES);

  // A lesson asserts its own prose. That IS the claim it is cited for.
  assert.equal(lesson.claim, LESSON);

  // A stem on its own is an interrogative and has no truth value for an
  // entailment model to find supported; the keyed option is the assertion, and
  // the rationale is the justification shown to the learner.
  assert.equal(
    pre.claim,
    'What does jerking the trigger disturb? The muzzle Jerking the trigger drives '
      + 'the muzzle off the target; smooth rearward pressure straight to the rear does not.',
  );
  // Distractors are excluded, exactly as per-item citation resolution excludes
  // them: they are by construction claims the source does NOT make.
  assert.ok(!pre.claim.includes('The aperture'));
  assert.ok(post.claim.startsWith('How is a natural point of aim corrected? Shift the hips'));
  assert.ok(!post.claim.includes('Muscle the weapon across'));
});

test('an item with nothing checkable, or no passage behind its citation, stays unverified', () => {
  // The scenario is a hypothetical situation and a task, not a claim about the
  // source, and its citation names the publication rather than a passage -- so
  // there are no spans a score could mean anything against.
  const sections = projected();
  const scenario = sections.at(-1).items[0];
  assert.equal(scenario.kind, 'SCENARIO');
  const ids = itemVerificationTargets(sections, PASSAGES).map((target) => target.id);
  assert.ok(!ids.includes(scenario.id));

  // No passage index at all (the legacy materialisation seam) measures nothing.
  assert.deepEqual(itemVerificationTargets(sections, []), []);
  assert.deepEqual(itemVerificationTargets(sections, undefined), []);
  assert.deepEqual(itemVerificationTargets(undefined, PASSAGES), []);

  // A citation label nothing persisted resolves to -- a free-text label from an
  // older draft -- yields no spans, so no measurement.
  const orphan = projectCourseRows('rec_o', draft({ cite: 'some other pub', cites: [] }), {
    sourceId: 'TC 3-22.9',
    passages: PASSAGES,
  }).sections;
  assert.deepEqual(itemVerificationTargets(orphan, PASSAGES), []);
});

/* --------------------------- the bounded run ---------------------------- */

/** A crude stand-in for HHEM: verbatim inside the span is entailed, else not. */
const stubVerifier = async ({ claim, spans }) => ({
  ok: true,
  support: spans.join(' ').includes(claim) ? 0.8366 : 0.0052,
  spans: spans.length,
  backend: 'hhem',
});

test('an entailed item is scored, an unsupported one scored low, and both recorded', async () => {
  const fabricated = projectCourseRows(
    'rec_v',
    draft({
      lesson: 'The rear aperture is adjusted for elevation using the windage knob on the carry handle.',
    }),
    { sourceId: 'TC 3-22.9', passages: PASSAGES },
  ).sections;

  const invented = await measureItemSupport(fabricated, PASSAGES, { verify: stubVerifier });
  assert.equal(invented.get('rec_v:s1:lesson'), 0.0052);

  const honest = await measureItemSupport(projected(), PASSAGES, { verify: stubVerifier });
  assert.equal(honest.get('rec_v:s1:lesson'), 0.8366);
});

test('nothing measured is nothing recorded, whatever the verifier does', async () => {
  const sections = projected();
  const verifiers = [
    async () => ({ ok: false, reason: 'verifier_unavailable' }),
    async () => ({ ok: false, reason: 'timeout' }),
    async () => { throw new Error('the board fell over'); },
    async () => null,
    async () => undefined,
    async () => ({ ok: true }),
    async () => ({ ok: true, support: null }),
    async () => ({ ok: true, support: '0.99' }),
    async () => ({ ok: true, support: Number.NaN }),
    async () => ({ ok: true, support: 1.01 }),
  ];
  for (const verify of verifiers) {
    const support = await measureItemSupport(sections, PASSAGES, { verify });
    // Not a default, not a zero, not a floor -- absent. lib/db.js then leaves
    // the column NULL and the review panel says "not verified".
    assert.equal(support.size, 0);
  }
});

test('the default client is the doctrine one, so an unconfigured engine measures nothing', async () => {
  await withVerifier(
    () => { throw new Error('must not be reached'); },
    async (calls) => {
      const support = await measureItemSupport(projected(), PASSAGES);
      assert.equal(support.size, 0);
      assert.equal(calls.length, 0);
    },
    { baseUrl: null },
  );
});

test('only a finite probability counts as a measurement', () => {
  for (const value of [0, 0.0052, 0.5, 1]) assert.equal(measuredSupport(value), value);
  for (const value of [
    undefined, null, '0.9', '', Number.NaN, Infinity, -Infinity, -0.001, 1.001, {}, [], true,
  ]) {
    assert.equal(measuredSupport(value), null, String(value));
  }
});

test('concurrency is bounded, because each call runs a real model on one board', async () => {
  let live = 0;
  let peak = 0;
  const verify = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    live -= 1;
    return { ok: true, support: 0.5, spans: 1, backend: 'hhem' };
  };
  const support = await measureItemSupport(projected(), PASSAGES, { verify, concurrency: 2 });
  assert.equal(support.size, 3);
  assert.equal(peak, 2);

  peak = 0;
  await measureItemSupport(projected(), PASSAGES, { verify, concurrency: 1 });
  assert.equal(peak, 1);
});

test('a whole-course budget stops dispatch, and clamps each call so nothing outlives it', async () => {
  let clock = 0;
  const timeouts = [];
  const verify = async ({ timeoutMs }) => {
    timeouts.push(timeoutMs);
    clock += 40;
    return { ok: true, support: 0.5, spans: 1, backend: 'hhem' };
  };
  const support = await measureItemSupport(projected(), PASSAGES, {
    verify,
    concurrency: 1,
    budgetMs: 60,
    now: () => clock,
  });

  // Two items fit inside the budget; the third is never dispatched and stays
  // unverified. A slow verifier degrades to null, it does not hang an approval.
  assert.deepEqual([...support.keys()], ['rec_v:s1:lesson', 'rec_v:s1:pre1']);
  assert.ok(!support.has('rec_v:s1:post1'));
  // Each call may only use what is left of the budget, so one hung request
  // cannot push the total past it.
  assert.deepEqual(timeouts, [60, 20]);
});
