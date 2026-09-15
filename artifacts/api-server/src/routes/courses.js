import { Router } from 'express';
import { db } from '../lib/db.js';

// Read model for learner-facing screens. Only human-ratified items reach a student;
// the APPROVED filter lives in the Prisma query rather than in the UI.
const router = Router();
const itemProjection = {
  id: true,
  kind: true,
  stem: true,
  options: true,
  answer: true,
  rationale: true,
  citation: true,
  support: true,
  status: true,
};

const sectionInclude = {
  orderBy: { order: 'asc' },
  include: {
    items: {
      where: { status: 'APPROVED' },
      orderBy: { createdAt: 'asc' },
      select: itemProjection,
    },
  },
};

router.get('/courses', async (_req, res) => {
  try {
    const courses = await db.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: { sections: sectionInclude },
    });
    res.json({ courses });
  } catch (error) {
    console.error('[courses]', error?.message || error);
    res.status(500).json({ error: error?.message || String(error), code: 'DB_ERROR' });
  }
});

router.get('/courses/:id', async (req, res) => {
  try {
    const course = await db.course.findUnique({
      where: { id: req.params.id },
      include: { sections: sectionInclude },
    });
    if (!course) {
      res.status(404).json({ error: 'course not found' });
      return;
    }
    res.json({ course });
  } catch (error) {
    console.error('[courses/:id]', error?.message || error);
    res.status(500).json({ error: error?.message || String(error), code: 'DB_ERROR' });
  }
});

export default router;