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
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA || gitSha(),
  },
};
export default nextConfig;
