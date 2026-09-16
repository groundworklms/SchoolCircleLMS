/*
 * /api/learning/model-settings -- the generation provider, chosen at runtime.
 *
 * GET   instructors read the redacted configuration and what is actually active.
 * POST  claim the operator passphrase when the deployment has none yet.
 * PUT   replace the endpoint/model/key. Requires the operator passphrase.
 * DELETE stop using stored settings and fall back to the environment. Same gate.
 *
 * Why the extra gate: this value decides where approved POI and source text get
 * sent. Role alone is not enough, because every allowlisted instructor would
 * then be able to redirect all generation to an endpoint of their choosing.
 * The passphrase is sent as x-model-settings-key. It comes from
 * MODEL_SETTINGS_KEY when a deployment pins one, or from a hash claimed through
 * POST otherwise -- so enabling the panel needs no secret and no rollout, which
 * is the whole point of configuring the provider at runtime.
 *
 * The response never contains the API key -- only whether one is set and a
 * masked hint of its last four characters.
 */
import { learningRoute } from '../../../../lib/learning/http.js';
import { providerStatus } from '../../../../lib/model.js';
import {
  changeNeedsOperator,
  claimOperatorPassphrase,
  disableModelSettings,
  operatorPassphraseConfigured,
  operatorPassphraseReason,
  primeModelSettings,
  publicModelSettings,
  saveModelSettings,
  verifyOperatorPassphrase,
} from '../../../../lib/model-settings.js';

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
 *
 * "No passphrase configured" is a distinct, actionable state rather than a
 * plain refusal: POST claims one. It is still not a way in -- a claim needs the
 * same authenticated instructor role as everything else here.
 */
function requireOperator(request) {
  if (!operatorPassphraseConfigured()) {
    const error = new Error(operatorPassphraseReason());
    error.code = 'PASSPHRASE_NOT_SET';
    error.status = 409;
    throw error;
  }
  const provided = request.headers?.get?.('x-model-settings-key') || '';
  if (!verifyOperatorPassphrase(provided)) {
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

/**
 * Claim the operator passphrase on a deployment that has none. Deliberately not
 * a way to *change* an existing one: rotating it is a configuration action, so
 * a leaked session cannot lock the real operator out.
 */
export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  async ({ identity, body }) => {
    await claimOperatorPassphrase({
      passphrase: body.passphrase,
      updatedBy: identity.id,
    });
    return settingsResponse(await currentView());
  },
);

export const PUT = learningRoute(
  { roles: ['INSTRUCTOR'] },
  async ({ identity, body, request }) => {
    const settings = await primeModelSettings();
    // Choosing a model on the endpoint already in force is an ordinary
    // instructor action. Changing the endpoint, or supplying a credential, is
    // what the operator passphrase guards.
    if (changeNeedsOperator(body, settings, process.env.MODEL_BASE_URL)) {
      requireOperator(request);
    }
    await saveModelSettings({
      baseUrl: body.baseUrl || settings?.baseUrl || process.env.MODEL_BASE_URL,
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
