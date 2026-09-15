import { db } from '../../../../lib/db';

// One course with its sections and APPROVED items (LESSON/QUESTION/SCENARIO), each carrying its
// paragraph-level Anchor citation. Same ratified-only guarantee as the list route.
export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const course = await db.course.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: {
            items: {
              where: { status: 'APPROVED' },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true, kind: true, stem: true, options: true, answer: true,
                rationale: true, citation: true, support: true, status: true,
              },
            },
          },
        },
      },
    });
    if (!course) return Response.json({ error: 'course not found' }, { status: 404 });
    return Response.json({ course });
  } catch (err) {
    console.error('[courses/:id]', err.message);
    return Response.json({ error: err.message, code: 'DB_ERROR' }, { status: 500 });
  }
}
