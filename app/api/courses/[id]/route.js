import { requireAnyRole } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import {
  approvedReleaseIds,
  projectDeliveryCourse,
  selectedDeliveryId,
} from '../../../../lib/learning/delivery.js';

// Authenticated generated-course delivery. A root id resolves to the current
// immutable release; `?releaseId=` explicitly pins an approved historical
// release. Learners never receive typed answer keys or rationales.
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

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload
    : {};
}

export async function GET(request, { params }) {
  try {
    const identity = await requireAnyRole(request, ['LEARNER', 'INSTRUCTOR']);
    const full = identity.role === 'INSTRUCTOR' || identity.role === 'BOTH';
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const requestedReleaseId = query.get('releaseId') || query.get('release');
    const root = await db.learningRecord.findUnique({ where: { id } });
    let selectedId = id;
    let approvedRoot = root;

    if (root) {
      if (root.type !== 'COURSE_DRAFT' || root.status !== 'APPROVED') {
        return Response.json({ error: 'course not found', code: 'NOT_FOUND' }, {
          status: 404,
          headers: HEADERS,
        });
      }
      selectedId = selectedDeliveryId(root, requestedReleaseId);
      if (!selectedId) {
        return Response.json({ error: 'release not found', code: 'NOT_FOUND' }, {
          status: 404,
          headers: HEADERS,
        });
      }
    } else {
      // A list response exposes the immutable delivery id. Resolve that id
      // back to an approved root before allowing a direct release read.
      const approvals = await db.learningRecord.findMany({
        where: { type: 'COURSE_DRAFT', status: 'APPROVED' },
      });
      approvedRoot = approvals.find((record) => approvedReleaseIds(record).includes(id)) || null;
      if (!approvedRoot && requestedReleaseId && requestedReleaseId !== id) {
        return Response.json({ error: 'course not found', code: 'NOT_FOUND' }, {
          status: 404,
          headers: HEADERS,
        });
      }
      // Unlinked legacy typed courses remain readable, as in the list endpoint.
      // They have no generated release history and cannot select another ID.
      selectedId = approvedRoot ? selectedDeliveryId(approvedRoot, id) : id;
    }

    const course = await db.course.findUnique({
      where: { id: selectedId },
      include: courseInclude(full),
    });
    if (!course) {
      return Response.json({ error: 'course not found', code: 'NOT_FOUND' }, {
        status: 404,
        headers: HEADERS,
      });
    }
    return Response.json(
      {
        course: projectDeliveryCourse(course, { learner: !full }),
        releaseId: selectedId,
        rootCourseId: approvedRoot?.id || id,
        availableReleaseIds: full ? (approvedRoot ? approvedReleaseIds(approvedRoot) : [id]) : undefined,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error?.status >= 500) console.error('[courses/:id]', error.message);
    return errorResponse(error);
  }
}