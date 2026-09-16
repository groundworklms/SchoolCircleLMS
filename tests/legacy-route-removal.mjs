import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { selectMasterySession } from '../app/_learning/mastery-session.js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(relativePath) {
  const absolutePath = path.join(workspace, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(relativePath, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

function appSourceFiles() {
  return filesUnder('app').filter((file) => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file));
}

test('retired route trees contain no files', () => {
  assert.deepEqual(filesUnder('app/teach'), []);
  assert.deepEqual(filesUnder('app/learn'), []);
});

test('active app source contains no legacy route redirects or links', () => {
  const legacyRoute = /['"`](?:\/|%2F)(?:teach|learn)(?:[/?#%]|['"`])/;
  const matches = appSourceFiles().flatMap((file) => {
    const source = fs.readFileSync(path.join(workspace, file), 'utf8');
    return legacyRoute.test(source) ? [file] : [];
  });
  assert.deepEqual(matches, []);
});

test('mastery-session helper lives outside retired route trees', () => {
  const selected = selectMasterySession(
    [
      { id: 'legacy', status: 'ACTIVE', masteryPlanRevision: 'old' },
      { id: 'current', status: 'COMPLETE', masteryPlanRevision: 'current' },
    ],
    { status: 'APPROVED', revision: 'current' },
  );
  assert.equal(selected?.id, 'current');
});