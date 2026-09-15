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
  // pdfjs-dist loads its worker from disk at runtime; bundling breaks that.
  serverExternalPackages: ['pdfjs-dist'],
  env: {
    NEXT_PUBLIC_GIT_SHA: process.env.NEXT_PUBLIC_GIT_SHA || gitSha(),
  },
};
export default nextConfig;
