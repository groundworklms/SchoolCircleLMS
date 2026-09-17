import { learnerScopedIdentity, requireAnyRole } from '../../../lib/auth.js';
import { asksForLearnerView } from '../../../lib/learner-view.js';
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

function deliveryStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code === 'AUTH_REQUIRED') return 401;
  if (error?.code === 'FORBIDDEN') return 403;
  return 500;
}

function errorResponse(error, label) {
  const status = deliveryStatus(error);
  // Log against the status actually being returned. A Prisma or connection
  // failure carries no `status` of its own, so guarding the log on
  // `error.status >= 500` dropped every genuine server error -- exactly the
  // class of failure that took the app down in #69.
  if (status >= 500) console.error(label, error?.message);
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
    const verified = await requireAnyRole(request, ['LEARNER', 'INSTRUCTOR']);
    // A request from a learner surface is answered as a learner: the student
    // preview is there to show what a learner gets, and an instructor reading
    // it with answer keys and rationales attached is not that.
    const identity = asksForLearnerView(request) ? learnerScopedIdentity(verified) : verified;
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
    return errorResponse(error, '[courses]');
  }
}
