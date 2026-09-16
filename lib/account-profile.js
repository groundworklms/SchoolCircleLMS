import { requireIdentity } from './auth.js';
import { db } from './db.js';
import {
  PROFILE_ROLES,
  SERVICE_BRANCHES,
  getPayGrades,
  getRanks,
} from './profile-options.js';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const select = {
  id: true, name: true, rank: true, branch: true, payGrade: true, profileCompletedAt: true,
  role: true, externalId: true,
};
const editableFields = ['name', 'rank', 'role', 'branch', 'payGrade'];
const editableFieldSet = new Set(editableFields);

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function optionValues(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => (typeof option === 'string' ? option : option?.value))
    .filter((value) => typeof value === 'string');
}

function cleanText(value, field, max) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw badRequest(`${field} must be text of at most ${max} characters without control characters.`);
  }
  return value.trim();
}

function cleanOption(value, field) {
  return cleanText(value, field, 80);
}

function requireOption(value, field, options) {
  const allowed = optionValues(options);
  if (!allowed.includes(value)) {
    throw badRequest(`${field} is not a valid profile option.`);
  }
  return value;
}

export function validateAccountProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('A complete account profile is required.');
  }
  if (Object.keys(body).some((key) => !editableFieldSet.has(key))) {
    throw badRequest('Only name, rank, role, branch, and payGrade can be edited.');
  }
  if (editableFields.some((key) => !Object.hasOwn(body, key))) {
    throw badRequest('A complete account profile is required.');
  }

  const name = cleanText(body.name, 'Display name', 80);
  if (!name) throw badRequest('Display name is required.');

  const role = requireOption(
    cleanOption(body.role, 'Role'),
    'Role',
    PROFILE_ROLES,
  );
  const branch = requireOption(
    cleanOption(body.branch, 'Branch'),
    'Branch',
    SERVICE_BRANCHES,
  );
  const civilian = branch === 'CIVILIAN';

  const rank = body.rank == null ? null : cleanText(body.rank, 'Rank', 40);
  const payGrade = body.payGrade == null
    ? null
    : cleanOption(body.payGrade, 'Pay grade');

  if (civilian) {
    if (rank !== null || payGrade !== null) {
      throw badRequest('CIVILIAN profiles must have a null pay grade and rank.');
    }
  } else {
    if (!payGrade) throw badRequest('Pay grade is required for a service branch.');
    requireOption(payGrade, 'Pay grade', getPayGrades(branch));
    if (!rank) throw badRequest('Rank is required for a service branch.');
    requireOption(rank, 'Rank', getRanks(branch, payGrade));
  }

  return { name, rank, role, branch, payGrade };
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