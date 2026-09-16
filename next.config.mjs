import { execSync } from 'node:child_process';

// Short commit hash baked into the client so the feedback widget can tag
// issues with the build they came from. Falls back quietly outside a checkout.
function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // App Hosting builds with output: 'standalone'. NEXT_STANDALONE=1 reproduces
  // that packaging locally, which is the only way to see what the file tracer
  // actually copied before a missing dependency reaches the deploy.
  output: process.env.NEXT_STANDALONE ? 'standalone' : undefined,
  // pdfjs-dist loads its worker from disk at runtime; bundling breaks that. The
  // arsenal packages are plain ESM loaded by name at the call boundary
  // (lib/arsenal-core.js) and firebase-admin verifies ID tokens server-side --
  // all are left to Node's resolver rather than bundled.
  serverExternalPackages: [
    'pdfjs-dist',
    'firebase-admin',
    'cadence',
    'cartridge',
    'coursewright',
    'hotwash',
    'quarry',
    'rubricon',
    'sextant',
    'sourcerer',
    'understudy',
    'waypoint',
    'whetstone',
    // Cloud SQL connector (google-auth) and pg are loaded lazily by lib/db.js.
    '@google-cloud/cloud-sql-connector',
    '@prisma/adapter-pg',
    'pg',
  ],
  // Five of the arsenal repos -- coursewright, quarry, rubricon, sourcerer and
  // whetstone -- are reachable ONLY through the runtime `import()` in
  // lib/arsenal-core.js and lib/learning/core.js, which the bundler cannot see,
  // and the entry above tells Next not to bundle them. Nothing in the module
  // graph pointed at them, so Next's file tracer left them out of the
  // standalone build App Hosting deploys, and the first PDF ingest died with
  //   Cannot find package 'quarry' imported from .next/standalone/...
  // The other six survived only because lib/arsenal-evidence.js imports them
  // statically. Trace all eleven in, so whether a repo ships never depends on
  // which seam happens to reach it. Their two dependencies (quarry ->
  // pdfjs-dist, cartridge -> jszip) come along with those static imports.
  // test/arsenal-packaging.test.mjs keeps this list and package.json in step.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/{cadence,cartridge,coursewright,hotwash,quarry,rubricon,sextant,sourcerer,understudy,waypoint,whetstone}/**/*',
      // pdf.mjs reaches its worker through a runtime import() the tracer cannot
      // follow either, so the standalone build got pdf.mjs and nothing to run
      // it: "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs".
      // That breaks every PDF path -- Quarry ingest and the /api/ingest POI
      // parser in lib/poi-parser.js alike.
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
  },
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA || gitSha(),
  },
};
export default nextConfig;
