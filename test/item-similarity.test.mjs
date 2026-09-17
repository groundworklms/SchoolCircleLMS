import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateReason, isDuplicateItem, keyedAnswer, stemGist } from '../lib/learning/item-similarity.js';

const item = (stem, key, others) => ({ stem, options: [key, ...others], answer: 0 });

test('stemGist keeps what an item is about and drops the question furniture', () => {
  assert.deepEqual(
    [...stemGist('Which statement best describes the purpose of joint doctrine?')].sort(),
    ['doctrine', 'joint', 'purpose'],
  );
  assert.deepEqual([...stemGist('According to the passage, which option is correct?')], []);
});

test('keyedAnswer reads the keyed option and refuses an unusable key', () => {
  assert.deepEqual([...keyedAnswer(item('S', 'Operational control', ['x', 'y']))].sort(), [
    'control',
    'operational',
  ]);
  assert.equal(keyedAnswer({ stem: 'S', options: ['a', 'b'], answer: 7 }).size, 0);
  assert.equal(keyedAnswer({ stem: 'S', options: ['a', 'b'] }).size, 0);
  assert.equal(keyedAnswer(null).size, 0);
});

// ASTRA section 3: "the keyed answers are the same four words".
test('a post item keyed to the same answer as its pre item is the same item', () => {
  const pre = item(
    'Which set of instruments of national power is identified by the acronym DIME?',
    'Diplomatic, informational, military, and economic',
    ['Army, Navy, Air Force, Marines', 'Land, sea, air, and space', 'Strategic, operational, tactical'],
  );
  const post = item(
    'Which statement best describes the four categories named as the instruments of national power?',
    'The instruments are diplomatic, informational, military, and economic',
    ['They are the four services', 'They are the levels of war', 'They are the warfighting functions'],
  );
  assert.equal(duplicateReason(pre, post), 'it is keyed to the same answer');
});

// ASTRA section 7: "keys differ by two words" -- so equality would miss it.
test('keys that differ by a couple of words are still the same answer', () => {
  const pre = item(
    'Which statement best describes the purpose of joint doctrine?',
    'Joint doctrine provides fundamental principles that guide the employment of joint forces',
    ['It is a binding legal order', 'It lists the combatant commands', 'It assigns forces to commanders'],
  );
  const post = item(
    'Which statement best describes what joint doctrine does?',
    'Joint doctrine provides fundamental principles guiding employment of US joint forces',
    ['It binds commanders legally', 'It names the services', 'It funds the force'],
  );
  assert.equal(duplicateReason(pre, post), 'it is keyed to the same answer');
});

// The pair that proves the stem check cannot carry this on its own: both of
// these share "instruments of national power" with the item above, and only
// one of them is a duplicate.
test('two items from one passage with different answers are two items', () => {
  const dime = item(
    'Which set of instruments of national power is identified by the acronym DIME?',
    'Diplomatic, informational, military, and economic',
    ['The four services', 'The levels of war', 'The warfighting functions'],
  );
  const president = item(
    'Who directs the employment of the instruments of national power?',
    'The President, with the advice and assistance of the National Security Council',
    ['The Chairman of the Joint Chiefs', 'The combatant commander', 'The Secretary of the Navy'],
  );
  assert.equal(duplicateReason(dime, president), '');
});

// Near-identical vocabulary, opposite answers. Section 6's OPCON/TACON pair is
// exactly the case a careless similarity check would collapse.
test('items that turn on a distinction are not duplicates of each other', () => {
  const opcon = item('Which authority is inherent in COCOM and may be delegated?', 'Operational control (OPCON)', [
    'Tactical control (TACON)',
    'Administrative control',
    'Support relationship',
  ]);
  const tacon = item('Which authority is inherent in OPCON?', 'Tactical control (TACON)', [
    'Operational control',
    'Combatant command',
    'Direct support',
  ]);
  assert.equal(duplicateReason(opcon, tacon), '');
});

test('a reworded stem with a different key is caught by the stem check', () => {
  const left = item('Which option lists a common operating precept for joint forces?', 'Unity of effort', [
    'a',
    'b',
    'c',
  ]);
  const right = item('Which option identifies a common operating precept for joint forces?', 'Centralized control', [
    'd',
    'e',
    'f',
  ]);
  assert.equal(duplicateReason(left, right), 'it asks about the same thing');
});

test('a stem too short to judge is not called a duplicate on that basis', () => {
  const left = item('Define OPCON.', 'Operational control of assigned forces', ['x', 'y']);
  const right = item('Define TACON.', 'Local direction of movement and manoeuvre', ['x', 'y']);
  assert.equal(duplicateReason(left, right), '');
});

test('isDuplicateItem agrees with duplicateReason', () => {
  const left = item('Which authority is inherent in COCOM?', 'Operational control of assigned forces', ['x', 'y']);
  const right = item('Which authority does COCOM carry inherently?', 'Operational control of the assigned forces', [
    'p',
    'q',
  ]);
  assert.equal(isDuplicateItem(left, right), true);
  assert.equal(isDuplicateItem(left, item('What is a MAGTF?', 'A Marine air-ground task force', ['x', 'y'])), false);
});

test('the comparison is symmetric', () => {
  const left = item('Which authority is inherent in COCOM?', 'Operational control of assigned forces', ['x', 'y']);
  const right = item('Which authority does COCOM carry inherently?', 'Operational control of the assigned forces', [
    'p',
    'q',
  ]);
  assert.equal(duplicateReason(left, right), duplicateReason(right, left));
});
