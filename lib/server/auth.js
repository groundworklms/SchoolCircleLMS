import { db } from './db.js';
import { authReadiness } from './auth-boundary.js';

/**
 * Resolve only identity attached by trusted server middleware.  There is no
 * fallback to x-user, x-role, a query value, or a body value.
 */
export async function resolveIdentity(req) {
  const candidate = req.user || req.auth?.user || req.authUser;
  if (!candidate || typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return null;
  }

  // Roles are authoritative in Prisma, not in a browser-controlled object. A
  // verified session may carry the database id, or an external OIDC subject.
  const user = await db.user.findFirst({
    where: {
      OR: [{ id: candidate.id }, { externalId: candidate.id }],
    },
    select: { id: true, name: true, role: true, externalId: true },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    externalId: user.externalId,
  };
}

export function requireIdentity() {
  return async (req, res, next) => {
    try {
      const identity = await resolveIdentity(req);
      if (!identity) {
        res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
          auth: authReadiness(),
        });
        return;
      }
      req.learningIdentity = identity;
      next();
    } catch (error) {
      // A database/auth boundary failure must not turn into an anonymous user.
      res.status(503).json({
        error: 'Identity service unavailable',
        code: 'AUTH_UNAVAILABLE',
      });
    }
  };
}

export function requireRole(role) {
  const expected = String(role).toUpperCase();
  return [
    requireIdentity(),
    (req, res, next) => {
      if (req.learningIdentity?.role !== expected) {
        res.status(403).json({
          error: `${expected.toLowerCase()} role required`,
          code: 'FORBIDDEN',
        });
        return;
      }
      next();
    },
  ];
}

export function requireAnyRole(...roles) {
  const expected = new Set(roles.map((role) => String(role).toUpperCase()));
  return [
    requireIdentity(),
    (req, res, next) => {
      if (!expected.has(req.learningIdentity?.role)) {
        res.status(403).json({
          error: 'An authorized learning role is required',
          code: 'FORBIDDEN',
        });
        return;
      }
      next();
    },
  ];
}

export function currentIdentity(req) {
  return req.learningIdentity || null;
}

/**
 * Compatibility middleware for the evidence router factory. It exposes the
 * same verified database identity as req.user only after resolveIdentity has
 * succeeded; it never parses a client header.
 */
export async function requireEvidenceUser(req, res, next) {
  try {
    const identity = await resolveIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      return;
    }
    req.learningIdentity = identity;
    req.user = identity;
    next();
  } catch {
    res.status(503).json({ error: 'Identity service unavailable', code: 'AUTH_UNAVAILABLE' });
  }
}

export async function requireEvidenceInstructor(req, res, next) {
  await requireEvidenceUser(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }
    if (req.learningIdentity?.role !== 'INSTRUCTOR') {
      res.status(403).json({ error: 'instructor role required', code: 'FORBIDDEN' });
      return;
    }
    next();
  });
}