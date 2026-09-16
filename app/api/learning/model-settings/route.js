/*
 * /api/learning/model-settings -- the generation provider, chosen at runtime.
 *
 * GET   instructors read the redacted configuration and what is actually active.
 * PUT   replace the endpoint/model/key. Requires the operator passphrase.
 * DELETE stop using stored settings and fall back to the environment. Same gate.
 *
 * Why the extra gate: this value decides where approved POI and source text get
 * sent. Role alone is not enough, because every allowlisted instructor would
 * then be able to redirect all generation to an endpoint of their choosing.
 * The passphrase (MODEL_SETTINGS_KEY, sent as x-model-settings-key) is the same
 * shared-operator-secret pattern the feedback widget already uses, and it fails
 * closed: with no passphrase configured, writes are refused outright.
 *
 * The response never contains the API key -- only whether one is set and a
 * masked hint of its last four characters.
 */
import { learningRoute } from '../../../../lib/learning/http.js';
import { providerStatus } from '../../../../lib/model.js';
import {
  disableModelSettings,
  operatorPassphraseConfigured,
  operatorPassphraseReason,
  primeModelSettings,
  publicModelSettings,
  saveModelSettings,
} from '../../../../lib/model-settings.js';
import { secretEquals } from '../../../../lib/settings-crypto.js';

export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function forbidden(message, code = 'FORBIDDEN') {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  return error;
}

/**
 * Authorize a write. Checked before the body is looked at, so a request without
 * the passphrase cannot report whether its payload would have been valid.
 */
function requireOperator(request) {
  if (!operatorPassphraseConfigured()) {
    const error = new Error(operatorPassphraseReason());
    error.code = 'SETTINGS_NOT_WRITABLE';
    error.status = 503;
    throw error;
  }
  const provided = request.headers?.get?.('x-model-settings-key') || '';
  if (!secretEquals(provided, process.env.MODEL_SETTINGS_KEY.trim())) {
    throw forbidden('That operator passphrase is not correct.', 'BAD_OPERATOR_KEY');
  }
}

async function currentView() {
  const settings = await primeModelSettings();
  return publicModelSettings(settings, providerStatus());
}

function settingsResponse(settings) {
  // Returned as a Response rather than `{ json }` because learningRoute's
  // result shape only forwards headers for raw bodies, and no-store matters on
  // a configuration read.
  return Response.json({ settings }, { headers: HEADERS });
}

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async () => settingsResponse(await currentView()),
);

export const PUT = learningRoute(
  { roles: ['INSTRUCTOR'] },
  async ({ identity, body, request }) => {
    requireOperator(request);
    await saveModelSettings({
      baseUrl: body.baseUrl,
      modelId: body.modelId,
      // Absent key = keep whatever is stored; explicit null or '' = clear it.
      // The UI never receives the key, so it cannot send one back unchanged.
      apiKey: Object.prototype.hasOwnProperty.call(body, 'apiKey') ? body.apiKey : undefined,
      // The version the panel last read, so two operators editing at once get
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
  async ({ identity, request }) => {
    requireOperator(request);
    await disableModelSettings({ updatedBy: identity.id });
    return settingsResponse(await currentView());
  },
);
