/*
 * /api/learning/doctrine-health -- does the configured Anchor actually answer?
 *
 * Deliberately separate from /api/learning/doctrine-settings, which reads
 * configuration only. Two reasons, both operational:
 *
 *   1. Configuration must paint instantly. Settings -> Doctrine engine has to
 *      show the address it is pointed at even when that address is a black
 *      hole, so the read that fetches it must never wait on a network probe.
 *   2. A probe is a live measurement with a short life. It is re-run on demand
 *      ("Check again") rather than cached into a settings payload, because the
 *      whole failure this exists to prevent was a stale green.
 *
 * The probe itself is bounded inside lib/doctrine-detect.js and never throws,
 * so the worst case here is a fast, honest "not answering".
 */
import { learningRoute } from '../../../../lib/learning/http.js';
import { doctrineProvider } from '../../../../lib/doctrine.js';
import { checkDoctrineHealth } from '../../../../lib/doctrine-detect.js';
import { primeDoctrineSettings } from '../../../../lib/doctrine-settings.js';

export const runtime = 'nodejs';

// A measurement of right now is never worth caching, and Vary keeps one
// instructor's reading out of another's cache entry.
const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async () => {
    // Prime first: a stored address set in Settings wins over DOCTRINE_BASE_URL,
    // and probing the environment's address while the app grounds against the
    // stored one would report health for an endpoint nothing uses.
    await primeDoctrineSettings();
    const health = await checkDoctrineHealth(doctrineProvider());
    return Response.json({ health }, { headers: HEADERS });
  },
);
