import { requireIdentity } from './auth.js';
import { db } from './db.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const select = {
  id: true, name: true, rank: true, profileCompletedAt: true,
  role: true, externalId: true,
};
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function validateAccountProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['name', 'rank'].includes(key))) {
    throw badRequest('Only name and rank can be edited.');
  }
  const clean = (value, field, max) => {
    if (typeof value !== 'string' || value.length > max ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
      throw badRequest(`${field} must be text of at most ${max} characters without control characters.`);
    }
    return value.trim();
  };
  const name = clean(body.name, 'Display name', 80);
  if (!name) throw badRequest('Display name is required.');
  const rank = body.rank == null ? null : clean(body.rank, 'Rank', 40) || null;
  return { name, rank };
}

// Dependencies are injectable for isolated tests; production always uses verified identity.
export function accountProfileHandlers({ identityFor = requireIdentity, users = db.user } = {}) {
  const handle = (write) => async (request) => {
    try {
      const identity = await identityFor(request);
      if (!identity) return Response.json({ error: 'Authentication required' }, { status: 401, headers });
      let user = identity;
      if (write) {
        let body;
        try { body = await request.json(); } catch { throw badRequest('Invalid JSON.'); }
        const data = validateAccountProfile(body);
        const saved = await users.update({
          where: { id: identity.id },
          data: { ...data, profileCompletedAt: new Date() },
          select,
        });
        user = { ...identity, ...saved };
      }
      return Response.json({ user }, { headers });
    } catch (error) {
      const status = [400, 401, 403].includes(error.status) ? error.status : 503;
      const message = status === 503 ? 'Account service unavailable. Please retry.' :
        status === 400 ? error.message : 'Authentication required. Please sign in again.';
      return Response.json({ error: message }, { status, headers });
    }
  };
  return { GET: handle(false), PATCH: handle(true) };
}