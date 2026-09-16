// The arsenal repos are loaded by name through a runtime import() the bundler
// cannot see, so nothing in the module graph points at them. Next's file tracer
// therefore ships exactly what next.config.mjs names -- a repo added to
// package.json but not to that list builds clean and then fails in the deployed
// standalone bundle with "Cannot find package '<name>'". These assertions turn
// that silent packaging gap into a failing test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import nextConfig from '../next.config.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const arsenalRepos = Object.entries(pkg.dependencies)
  .filter(([, spec]) => spec.startsWith('github:groundworklms/'))
  .map(([name]) => name)
  .sort();

const tracedGlobs = Object.values(nextConfig.outputFileTracingIncludes ?? {}).flat();

// './node_modules/{a,b}/**/*' and './node_modules/a/**/*' both name packages.
const tracedPackages = new Set(
  tracedGlobs.flatMap((glob) => {
    const match = /^\.\/node_modules\/(?:\{([^}]+)\}|([^/]+))\//.exec(glob);
    if (!match) return [];
    return match[1] ? match[1].split(',') : [match[2]];
  }),
);

test('every arsenal repo is left to Node\'s resolver rather than bundled', () => {
  assert.ok(arsenalRepos.length >= 11, `expected the arsenal repos, found ${arsenalRepos.length}`);
  for (const name of arsenalRepos) {
    assert.ok(
      nextConfig.serverExternalPackages.includes(name),
      `${name} is missing from serverExternalPackages in next.config.mjs`,
    );
  }
});

test('every arsenal repo is traced into the standalone build', () => {
  for (const name of arsenalRepos) {
    assert.ok(
      tracedPackages.has(name),
      `${name} is missing from outputFileTracingIncludes in next.config.mjs, so the `
        + 'standalone build App Hosting deploys will not contain it',
    );
  }
});

test('the pdfjs worker is traced alongside pdfjs itself', () => {
  // pdf.mjs reaches its worker through a runtime import() the tracer cannot
  // follow; without the worker every PDF path fails at parse time.
  assert.ok(
    tracedGlobs.some((glob) => glob.includes('pdf.worker.mjs')),
    'pdfjs-dist/legacy/build/pdf.worker.mjs is missing from outputFileTracingIncludes',
  );
});
