import { execSync } from 'node:child_process';

// Keep the build identifier available to the feedback widget without requiring a
// client-side git implementation. Deployments that set it explicitly win.
function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return '';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // These packages either load native/dynamic modules or expose server-only
  // adapters. Keeping them out of the Next bundle preserves their original
  // runtime behavior (and keeps pdfjs' worker available at runtime).
  serverExternalPackages: [
    'pdfjs-dist',
    '@prisma/client',
    'prisma',
    'firebase-admin',
    'openid-client',
    'multer',
    'pino',
    'pino-http',
    'cookie-parser',
    'cors',
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
  ],
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA || gitSha(),
  },
};

export default nextConfig;