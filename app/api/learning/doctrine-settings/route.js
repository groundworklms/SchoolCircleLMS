/*
 * /api/learning/doctrine-settings -- the Anchor endpoint, chosen at runtime.
 *
 * GET    instructors read the configured address, where it came from, and
 *        whether it is answering right now.
 * POST   detect: sweep the addresses the Orin can be at and report each one.
 * PUT    set the address.
 * DELETE clear it and fall back to DOCTRINE_BASE_URL.
 *
 * Why there is no operator passphrase here, unlike the model provider: that one
 * decides where approved source text gets SENT, so an arbitrary endpoint is an
 * exfiltration path. This adapter only ever sends a question and reads back
 * citations, and the realistic values are a board on a USB cable. An
 * authenticated instructor is the right gate; adding a passphrase would mean a
 * deployment secret stands between an instructor and the board they just
 * plugged in, which is exactly the friction runtime configuration removes.
 */
import { learningRoute } from '../../../../lib/learning/http.js';
import { doctrineProvider } from '../../../../lib/doctrine.js';
import { detectDoctrineEndpoints } from '../../../../lib/doctrine-detect.js';
import {
  disableDoctrineSettings,
  primeDoctrineSettings,
  publicDoctrineSettings,
  saveDoctrineSettings,
} from '../../../../lib/doctrine-settings.js';

export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

async function currentView() {
  const settings = await primeDoctrineSettings();
  return publicDoctrineSettings(settings, doctrineProvider());
}

function settingsResponse(settings, extra) {
  // A Response rather than `{ json }` because learningRoute only forwards
  // headers for raw bodies, and no-store matters on a configuration read.
  return Response.json({ settings, ...(extra || {}) }, { headers: HEADERS });
}

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async () => settingsResponse(await currentView()),
);

/**
 * Detect. Reports every candidate rather than only the winner, so "it is not
 * finding the Orin" is diagnosable -- the instructor can see whether the USB
 * address refused, timed out, or answered with the wrong corpus.
 */
export const POST = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async () => {
    const view = await currentView();
    const detected = await detectDoctrineEndpoints(view.active?.baseUrl || view.baseUrl);
    return settingsResponse(view, { detected });
  },
);

export const PUT = learningRoute(
  { roles: ['INSTRUCTOR'] },
  async ({ identity, body }) => {
    await saveDoctrineSettings({
      baseUrl: body.baseUrl,
      // The version the panel last read, so two instructors editing at once get
      // a 409 instead of one silently overwriting the other.
      expectedVersion: Object.prototype.hasOwnProperty.call(body, 'expectedVersion')
        ? body.expectedVersion
        : undefined,
      updatedBy: identity.id,
    });
    return settingsResponse(await currentView());
  },
);

export const DELETE = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async ({ identity }) => {
    await disableDoctrineSettings({ updatedBy: identity.id });
    return settingsResponse(await currentView());
  },
);
