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
  // pdfjs-dist loads its worker from disk at runtime; bundling breaks that. The Cloud SQL
  // connector (google-auth) and pg are loaded lazily by lib/db.js; keep them unbundled too.
  serverExternalPackages: ['pdfjs-dist', '@google-cloud/cloud-sql-connector', '@prisma/adapter-pg', 'pg'],
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA || gitSha(),
  },
};
export default nextConfig;
