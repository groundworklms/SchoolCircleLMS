import { requireAnyRole } from '../../../lib/auth.js';
import { db } from '../../../lib/db.js';
import {
  projectDeliveryCourse,
  selectCurrentDeliveryCourses,
} from '../../../lib/learning/delivery.js';

// Authenticated read model for learner-facing screens (lesson reader first).
// Generated approvals may have immutable replacement Course rows; only the
// current delivery row for each approved root is listed.
export const runtime = 'nodejs';

const HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

function itemSelect(full) {
  return {
    id: true,
    kind: true,
    stem: true,
    options: true,
    citation: true,
    status: true,
    ...(full ? { answer: true, rationale: true, support: true } : {}),
  };
}

function courseInclude(full) {
  return {
    sections: {
      orderBy: { order: 'asc' },
      include: {
        items: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'asc' },
          select: itemSelect(full),
        },
      },
    },
  };
}

function errorResponse(error) {
  const status = Number.isInteger(error?.status)
    ? error.status
    : error?.code === 'AUTH_REQUIRED' ? 401
      : error?.code === 'FORBIDDEN' ? 403
        : 500;
  return Response.json(
    {
      error: status >= 500 ? 'Course delivery is temporarily unavailable.' : error?.message,
      code: error?.code || 'DB_ERROR',
      ...(error?.auth ? { auth: error.auth } : {}),
    },
    { status, headers: HEADERS },
  );
}

export async function GET(request) {
  try {
    const identity = await requireAnyRole(request, ['LEARNER', 'INSTRUCTOR']);
    const full = identity.role === 'INSTRUCTOR' || identity.role === 'BOTH';
    const [courses, approvals] = await Promise.all([
      db.course.findMany({
        orderBy: { createdAt: 'asc' },
        include: courseInclude(full),
      }),
      db.learningRecord.findMany({
        where: { type: 'COURSE_DRAFT', status: 'APPROVED' },
      }),
    ]);
    const current = selectCurrentDeliveryCourses(courses, approvals)
      .map((course) => projectDeliveryCourse(course, { learner: !full }));
    return Response.json({ courses: current }, { headers: HEADERS });
  } catch (error) {
    if (error?.status >= 500) console.error('[courses]', error.message);
    return errorResponse(error);
  }
}