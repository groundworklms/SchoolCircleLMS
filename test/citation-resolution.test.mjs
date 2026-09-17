import test from 'node:test';
import assert from 'node:assert/strict';
import { citationKey, entriesForCitation } from '../lib/learning/citation.js';
import { passageForCitation } from '../lib/arsenal-core.js';

const DOCUMENTS = [
  { source: 'AY27 Coursebook p.54', text: 'Physical training includes compliance with body composition standards.' },
  { source: 'AY27 Coursebook p.67', text: 'The Department of the Navy comprises the Navy and the Marine Corps.' },
  { source: 'AY27 Coursebook p.121', text: 'Joint doctrine is authoritative but requires judgment in application.' },
];

test('citationKey unifies the ways a page reference is written', () => {
  const same = ['AY27 Coursebook p.67', 'AY27 Coursebook p. 67', 'AY27 Coursebook page 67', 'AY27 Coursebook pg 67'];
  const keys = new Set(same.map(citationKey));
  assert.equal(keys.size, 1, [...keys].join(' | '));
  assert.notEqual(citationKey('AY27 Coursebook p.67'), citationKey('AY27 Coursebook p.6'));
  assert.equal(citationKey(null), '');
});

test('a citation resolves to its own passage and no other', () => {
  const passage = passageForCitation(DOCUMENTS, 'AY27 Coursebook p.67');
  assert.match(passage, /Department of the Navy/);
  assert.doesNotMatch(passage, /body composition/, 'p.54 must not leak into a p.67 section');
  assert.doesNotMatch(passage, /Joint doctrine/);
});

test('a citation written a different way still resolves', () => {
  for (const label of ['AY27 Coursebook p. 67', 'AY27 Coursebook page 67', 'ay27 coursebook p.67']) {
    assert.match(passageForCitation(DOCUMENTS, label), /Department of the Navy/, label);
  }
});

// The defect this whole change exists for. ASTRA found a section citing p.67
// whose items were about the Coast Guard, and a Space Force item inside a
// Marine human-performance section grounded in p.54.
test('an unresolvable citation yields nothing, never the whole corpus', () => {
  for (const label of ['AY27 Coursebook p.999', 'Some Other Publication p.1', '', null, undefined]) {
    assert.equal(passageForCitation(DOCUMENTS, label), null, String(label));
  }
});

test('an ambiguous citation refuses rather than guessing', () => {
  const ambiguous = [
    { source: 'Coursebook p.6', text: 'Six.' },
    { source: 'Coursebook p.67', text: 'Sixty-seven.' },
  ];
  // "Coursebook p" is a token-run inside both keys, so neither is identified.
  assert.deepEqual(entriesForCitation(ambiguous, 'Coursebook p'), []);
  // The unambiguous one still resolves.
  assert.deepEqual(
    entriesForCitation(ambiguous, 'Coursebook p.67').map((entry) => entry.source),
    ['Coursebook p.67'],
  );
});

test('a section grounded in several passages is rewritten from all of them', () => {
  const passage = passageForCitation(DOCUMENTS, ['AY27 Coursebook p.67', 'AY27 Coursebook p.121']);
  assert.match(passage, /Department of the Navy/);
  assert.match(passage, /Joint doctrine/);
  assert.doesNotMatch(passage, /body composition/, 'only the cited passages');
});

test('passages come back in corpus order, and a repeated citation is read once', () => {
  const passage = passageForCitation(DOCUMENTS, [
    'AY27 Coursebook p.121',
    'AY27 Coursebook p.67',
    'AY27 Coursebook p.67',
  ]);
  assert.ok(
    passage.indexOf('Department of the Navy') < passage.indexOf('Joint doctrine'),
    'corpus order, not citation order',
  );
  assert.equal(passage.match(/Department of the Navy/g).length, 1);
});

test('a citation list resolves the labels it can and drops the ones it cannot', () => {
  const passage = passageForCitation(DOCUMENTS, ['AY27 Coursebook p.67', 'AY27 Coursebook p.999']);
  assert.match(passage, /Department of the Navy/);
  assert.doesNotMatch(passage, /body composition/);
  assert.doesNotMatch(passage, /Joint doctrine/);
});

test('no documents means no passage', () => {
  assert.equal(passageForCitation([], 'AY27 Coursebook p.67'), null);
  assert.equal(passageForCitation(null, 'AY27 Coursebook p.67'), null);
});
