/*
 * /api/learning/model-settings/models -- what the configured endpoint serves,
 * and a one-token check that the credential works.
 *
 * GET  list model ids (optionally for an endpoint being typed, before saving).
 * POST send the smallest possible completion to prove auth and the model id.
 *
 * Both require the operator passphrase, for the same reason a save does: they
 * take an operator-supplied URL and make the server call it with the
 * deployment's credential. Without the gate, any instructor could point this at
 * a host they control and read the Authorization header off their own endpoint.
 *
 * The credential is resolved server-side and is never echoed back, nor is the
 * upstream error body -- only a status-derived summary.
 */
import { learningRoute } from '../../../../../lib/learning/http.js';
import { listModels, testConnection } from '../../../../../lib/model-catalog.js';
import {
  operatorPassphraseConfigured,
  operatorPassphraseReason,
  verifyOperatorPassphrase,
} from '../../../../../lib/model-settings.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function requireOperator(request) {
  if (!operatorPassphraseConfigured()) {
    const error = new Error(operatorPassphraseReason());
    error.code = 'PASSPHRASE_NOT_SET';
    error.status = 409;
    throw error;
  }
  if (!verifyOperatorPassphrase(request.headers?.get?.('x-model-settings-key') || '')) {
    const error = new Error('That operator passphrase is not correct.');
    error.code = 'BAD_OPERATOR_KEY';
    error.status = 403;
    throw error;
  }
}

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  async ({ query, request }) => {
    // Listing what the already-configured endpoint serves is how an instructor
    // picks a model, so it needs no passphrase. Pointing this at a DIFFERENT
    // endpoint would make the server call it with the deployment credential,
    // which does.
    if (query.baseUrl) requireOperator(request);
    const result = await listModels({ baseUrl: query.baseUrl, chatOnly: query.all !== '1' });
    return Response.json(result, { headers: HEADERS });
  },
);

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  async ({ body, request }) => {
    if (body.baseUrl) requireOperator(request);
    const result = await testConnection({
      baseUrl: body.baseUrl,
      modelId: body.modelId,
    });
    return Response.json(result, { headers: HEADERS });
  },
);
