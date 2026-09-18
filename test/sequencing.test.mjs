import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inSourceOrder,
  mayReorder,
  pageNumber,
  pageSequence,
  readsOutOfOrder,
} from '../lib/learning/sequencing.js';

const at = (page, title) => ({ title: title || `p${page}`, cite: `pub p.${page}` });

test('a page number is read out of a citation, and only when it is one', () => {
  assert.equal(pageNumber('mcwp 5-10 p.56'), 56);
  assert.equal(pageNumber('pub p. 7'), 7);
  // Appendix and roman locators have no place in a numeric order, and a course
  // mixing them with digits has no single order to find.
  assert.equal(pageNumber('pub p.A-3'), null);
  assert.equal(pageNumber('pub p.iv'), null);
  assert.equal(pageNumber('no page here'), null);
  assert.equal(pageNumber(null), null);
});

// The sequence ASTRA found, verbatim.
test('a course that jumps around is put in the order the publication reads', () => {
  const sections = [2, 5, 6, 7, 27, 121, 67, 124, 67, 131, 54].map((p, i) => at(p, `s${i}`));
  const ordered = inSourceOrder(sections);
  assert.deepEqual(pageSequence(ordered), [2, 5, 6, 7, 27, 54, 67, 67, 121, 124, 131]);
  assert.equal(readsOutOfOrder(ordered), false);
  assert.equal(ordered.length, sections.length, 'nothing is dropped');
});

test('two sections on the same page keep the order they arrived in', () => {
  const a = at(67, 'first');
  const b = at(67, 'second');
  const ordered = inSourceOrder([at(120, 'later'), a, b]);
  assert.deepEqual(ordered.map((s) => s.title), ['first', 'second', 'later']);
});

test('a section with no usable page holds its ground rather than being swept aside', () => {
  const sections = [at(30, 'a'), { title: 'appendix', cite: 'pub p.A-1' }, at(10, 'b')];
  const ordered = inSourceOrder(sections);
  assert.equal(ordered.length, 3);
  assert.ok(ordered.some((s) => s.title === 'appendix'));
});

test('a course already in order is returned untouched', () => {
  const sections = [at(1), at(2), at(3)];
  assert.equal(inSourceOrder(sections), sections, 'the same array, so a caller can tell nothing moved');
});

test('nothing to order by means nothing is reordered', () => {
  const sections = [{ title: 'a' }, { title: 'b' }];
  assert.equal(inSourceOrder(sections), sections);
  assert.deepEqual(inSourceOrder([]), []);
  assert.deepEqual(inSourceOrder(null), []);
});

/*
 * The half that matters more than the sorting. Two orders in this system are
 * deliberate, and rearranging either would be overruling a person.
 */
test('objectives an instructor typed are left in the order they typed them', () => {
  assert.equal(mayReorder({ explicitObjectives: ['first this', 'then this'] }), false);
});

test('a course following a program of instruction keeps the POI order', () => {
  assert.equal(mayReorder({ fromPoi: true }), false);
  assert.equal(mayReorder({ fromPoi: true, explicitObjectives: [] }), false);
});

test('an outline the model wrote from prose has no order of its own', () => {
  assert.equal(mayReorder({}), true);
  assert.equal(mayReorder({ explicitObjectives: [], fromPoi: false }), true);
});

test('readsOutOfOrder names the problem without changing anything', () => {
  assert.equal(readsOutOfOrder([at(1), at(5), at(9)]), false);
  assert.equal(readsOutOfOrder([at(1), at(9), at(5)]), true);
  assert.equal(readsOutOfOrder([at(1), { title: 'x' }, at(9)]), false, 'a gap is not a jump');
});
