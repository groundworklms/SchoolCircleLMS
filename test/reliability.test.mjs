import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSTANTIAL,
  VERDICTS,
  cleanRatings,
  criterionOf,
  isVerdict,
  pairVerdicts,
  pooledReliability,
  reliabilityOf,
} from '../lib/learning/reliability.js';
import { cohenKappa } from 'rubricon';

const graded = (pairs) => pairs.map(([competency, verdict]) => ({ competency, verdict }));

const MODEL = graded([
  ['Frame the problem', 'mastered'],
  ['Design the course of action', 'competent'],
  ['Wargame the course of action', 'developing'],
  ['Compare courses of action', 'competent'],
]);

test('the verdict vocabulary is ordered weakest first, because the order is the scale', () => {
  assert.deepEqual(VERDICTS, ['developing', 'competent', 'mastered']);
  assert.equal(isVerdict('mastered'), true);
  assert.equal(isVerdict('MASTERED'), true);
  assert.equal(isVerdict('excellent'), false);
  assert.equal(isVerdict(null), false);
});

/*
 * Pairing on the wrong key produces a kappa that is arithmetically valid and
 * completely meaningless -- one rater's verdict on wargaming compared with the
 * other's on problem framing. A stored report calls the field `competency`; the
 * plan and the live session call it `elo`.
 */
test('a criterion is recognised however the record spells it', () => {
  assert.equal(criterionOf({ competency: 'Frame the problem' }), 'frame the problem');
  assert.equal(criterionOf({ elo: 'Frame the problem' }), 'frame the problem');
  assert.equal(criterionOf({}), '');
});

test('verdicts are paired on the criteria both raters actually judged', () => {
  const rater = graded([
    ['Wargame the course of action', 'competent'],
    ['Frame the problem', 'mastered'],
    ['Something this session never assessed', 'developing'],
  ]);
  const paired = pairVerdicts(MODEL, rater);
  assert.deepEqual(paired.criteria, ['frame the problem', 'wargame the course of action']);
  // Order follows the model's list, and the two columns line up with it.
  assert.deepEqual(paired.model, ['proficient', 'unsatisfactory']);
  assert.deepEqual(paired.rater, ['proficient', 'satisfactory']);
});

test('a criterion only one rater judged is reported, not scored as a disagreement', () => {
  const paired = pairVerdicts(MODEL, graded([['Frame the problem', 'mastered']]));
  assert.deepEqual(paired.criteria, ['frame the problem']);
  assert.equal(paired.unpaired.length, 3);
});

/* The arithmetic is Rubricon's and is not reimplemented here; this asserts the
   wiring produces the same number Rubricon would, on the same data. */
test('the kappa reported is the kappa Rubricon computes', () => {
  const rater = graded([
    ['Frame the problem', 'mastered'],
    ['Design the course of action', 'competent'],
    ['Wargame the course of action', 'competent'],
    ['Compare courses of action', 'developing'],
  ]);
  const result = reliabilityOf(MODEL, rater);
  assert.equal(result.n, 4);
  assert.equal(
    result.kappa,
    Math.round(cohenKappa(
      ['proficient', 'satisfactory', 'unsatisfactory', 'satisfactory'],
      ['proficient', 'satisfactory', 'satisfactory', 'unsatisfactory'],
    ) * 1000) / 1000,
  );
  assert.equal(typeof result.agreement, 'number');
  assert.equal(result.agreement, 0.5, 'two of four identical');
});

/*
 * Whetstone says developing/competent/mastered; Rubricon's canonical tiers are
 * unsatisfactory/satisfactory/proficient. Weighted kappa needs the ORDER,
 * because the weight of a disagreement is how many tiers apart it is, and
 * Rubricon refuses to guess an order from the alphabet -- which would rank
 * proficient below satisfactory and invert the scale. Passing our labels raw
 * would throw.
 */
test('being one tier apart counts as near agreement, not a full miss', () => {
  const oneApart = reliabilityOf(MODEL, graded([
    ['Frame the problem', 'competent'],
    ['Design the course of action', 'developing'],
    ['Wargame the course of action', 'developing'],
    ['Compare courses of action', 'competent'],
  ]));
  const twoApart = reliabilityOf(MODEL, graded([
    ['Frame the problem', 'developing'],
    ['Design the course of action', 'developing'],
    ['Wargame the course of action', 'mastered'],
    ['Compare courses of action', 'competent'],
  ]));
  assert.ok(
    oneApart.weightedKappa > twoApart.weightedKappa,
    'a scale that ignored tier distance would score these the same',
  );
});

test('two raters who agree on everything score a perfect kappa', () => {
  const result = reliabilityOf(MODEL, MODEL);
  assert.equal(result.agreement, 1);
  assert.equal(result.kappa, 1);
  assert.equal(result.substantial, true);
});

/*
 * The degenerate case is not "they agreed" -- it is "there was only ever one
 * category". With no variance there is no chance agreement to correct for, so
 * kappa is undefined and Rubricon returns NaN. Reporting 0 there would read as
 * "the raters agreed by luck", which is the opposite of what happened, and
 * reporting NaN puts a NaN on a screen.
 */
test('a session where every criterion got the same verdict says why kappa is absent', () => {
  const flat = graded([['Frame the problem', 'mastered'], ['Design the course of action', 'mastered']]);
  const result = reliabilityOf(flat, flat);
  assert.equal(result.agreement, 1);
  assert.equal(result.kappa, null);
  assert.equal(result.substantial, null);
  assert.match(result.reason, /cannot be corrected for chance/);
});

test('nothing rated in common is a reason, not a crash', () => {
  const result = reliabilityOf(MODEL, graded([['Unrelated', 'mastered']]));
  assert.equal(result.n, 0);
  assert.equal(result.report, null);
  assert.match(result.reason, /rated by both/);
  assert.equal(reliabilityOf(null, null).n, 0);
});

test('the substantial-agreement floor is stated rather than buried', () => {
  assert.equal(SUBSTANTIAL, 0.6);
  const poor = reliabilityOf(MODEL, graded([
    ['Frame the problem', 'developing'],
    ['Design the course of action', 'mastered'],
    ['Wargame the course of action', 'mastered'],
    ['Compare courses of action', 'developing'],
  ]));
  assert.equal(poor.substantial, false);
});

/* A rating arrives over HTTP from an instructor, so it is input. */
test('a submitted rating cannot invent a criterion or smuggle a field', () => {
  const clean = cleanRatings(MODEL, [
    { competency: 'Frame the problem', verdict: 'mastered', note: 'ignored', ownerId: 'someone-else' },
    { competency: 'A criterion this session never had', verdict: 'developing' },
    { competency: 'Design the course of action', verdict: 'outstanding' },
    { competency: 'Frame the problem', verdict: 'developing' },
  ]);
  assert.deepEqual(clean, [{ competency: 'Frame the problem', verdict: 'mastered' }]);
});

test('a rating keeps the criterion spelled as the session spells it', () => {
  const clean = cleanRatings(MODEL, [{ competency: 'FRAME THE PROBLEM', verdict: 'competent' }]);
  assert.deepEqual(clean, [{ competency: 'Frame the problem', verdict: 'competent' }]);
});

/*
 * Pooled, not averaged. A mean of per-session kappas weights a two-criterion
 * session the same as a nine-criterion one, and a kappa over two ratings is not
 * a number anybody should average into anything.
 */
test('reliability across sessions pools the ratings rather than averaging kappas', () => {
  const rater = graded([
    ['Frame the problem', 'mastered'],
    ['Design the course of action', 'developing'],
    ['Wargame the course of action', 'developing'],
    ['Compare courses of action', 'competent'],
  ]);
  const pooled = pooledReliability([
    { model: MODEL, rater },
    { model: MODEL, rater },
  ]);
  assert.equal(pooled.sessions, 2);
  assert.equal(pooled.n, 8, 'eight paired ratings, not two kappas');
});

test('sessions nobody rated are skipped and named as none', () => {
  const pooled = pooledReliability([{ model: MODEL, rater: [] }, null]);
  assert.equal(pooled.sessions, 0);
  assert.equal(pooled.n, 0);
  assert.match(pooled.reason, /no session has been rated/);
  assert.equal(pooledReliability(null).sessions, 0);
});
