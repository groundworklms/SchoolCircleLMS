import { db } from '../../../lib/db';

// Read model for the learner-facing screens (lesson reader first). Returns courses with their
// sections and ONLY the items a human has ratified -- Item.status === 'APPROVED'. Nothing PENDING
// reaches a student, and that guarantee lives in the query (the `where`), not in the UI.
export const runtime = 'nodejs';

export async function GET() {
  try {
    const courses = await db.course.findMany({
      orderBy: { createdAt: 'asc' },
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
    return Response.json({ courses });
  } catch (err) {
    console.error('[courses]', err.message);
    return Response.json({ error: err.message, code: 'DB_ERROR' }, { status: 500 });
  }
}
