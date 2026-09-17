import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupSourcesByCollection,
  cleanSourceLabel,
  sourceMatchesQuery,
} from '../app/prototype/source-groups.js';

test('cleanSourceLabel tidies raw filenames for display without losing their identity', () => {
  // Underscores become spaces, a stray space before a suffix collapses, and the
  // leftover is trimmed -- the exact shape zipped lesson PDFs arrive in.
  assert.equal(
    cleanSourceLabel('BE0108_Series-ParallelResistiveCircuits_ StudentLab'),
    'BE0108 Series-ParallelResistiveCircuits StudentLab',
  );
  // Codes and casing are left exactly as they are -- not ours to re-case.
  assert.equal(cleanSourceLabel('MCWP_2-10'), 'MCWP 2-10');
  assert.equal(cleanSourceLabel('Approved field manual'), 'Approved field manual');
  // Empty or missing falls back to a readable placeholder, never blank.
  assert.equal(cleanSourceLabel(''), 'Untitled source');
  assert.equal(cleanSourceLabel(null), 'Untitled source');
  assert.equal(cleanSourceLabel('   '), 'Untitled source');
});

test('sourceMatchesQuery searches the cleaned label, the citation id and the collection, case-insensitively', () => {
  const source = {
    title: 'BE0108_Series-ParallelResistiveCircuits_ StudentLab',
    sourceId: 'Basic Electronics Course/BE0108.pdf',
    collection: 'Basic Electronics Course',
  };
  // Matches on the cleaned title even though the stored title has underscores.
  assert.equal(sourceMatchesQuery(source, 'series-parallel'), true);
  // Matches the citation id and the collection name too.
  assert.equal(sourceMatchesQuery(source, 'be0108.pdf'), true);
  assert.equal(sourceMatchesQuery(source, 'basic electronics'), true);
  // Case-insensitive.
  assert.equal(sourceMatchesQuery(source, 'STUDENTLAB'), true);
  // A non-match is a non-match.
  assert.equal(sourceMatchesQuery(source, 'hydraulics'), false);
  // An empty query matches everything so callers can filter unconditionally.
  assert.equal(sourceMatchesQuery(source, ''), true);
  assert.equal(sourceMatchesQuery(source, '   '), true);
});

test('groupSourcesByCollection still orders named collections first and pending before approved', () => {
  const groups = groupSourcesByCollection([
    { id: 'a', status: 'APPROVED' },
    { id: 'b', status: 'PENDING', collection: 'Lesson plans' },
    { id: 'c', status: 'APPROVED', collection: 'Lesson plans' },
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['Lesson plans', 'Other documents']);
  const lessons = groups.find((g) => g.name === 'Lesson plans');
  // Pending first inside a group.
  assert.deepEqual(lessons.sources.map((s) => s.id), ['b', 'c']);
  assert.equal(lessons.pending.length, 1);
});
