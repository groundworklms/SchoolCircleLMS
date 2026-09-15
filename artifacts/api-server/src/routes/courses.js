import { Router } from 'express';
import { db } from '../lib/db.js';
import { currentIdentity, requireAnyRole } from '../lib/auth.js';

// Read model for learner-facing screens. Identity and role checks happen in
// this route after the app's verified auth boundary, rather than in a direct
// handler that could accidentally expose the raw model.
const router = Router();
const learnerItemProjection = {
  id: true,
  kind: true,
  stem: true,
  options: true,
  citation: true,
  support: true,
  status: true,
};

const instructorItemProjection = {
  ...learnerItemProjection,
  answer: true,
  rationale: true,
};

const authenticated = requireAnyRole('LEARNER', 'INSTRUCTOR');

function sectionInclude(identity) {
  const instructor = identity.role === 'INSTRUCTOR';
  return {
    orderBy: { order: 'asc' },
    include: {
      items: {
        where: instructor ? {} : { status: 'APPROVED' },
        orderBy: { createdAt: 'asc' },
        select: instructor ? instructorItemProjection : learnerItemProjection,
      },
    },
  };
}

router.get('/courses', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const courses = await db.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: { sections: sectionInclude(identity) },
    });
    res.json({ courses });
  } catch (error) {
    console.error('[courses]', error?.message || error);
    res.status(500).json({ error: error?.message || String(error), code: 'DB_ERROR' });
  }
});

router.get('/courses/:id', ...authenticated, async (req, res) => {
  try {
    const identity = currentIdentity(req);
    const course = await db.course.findUnique({
      where: { id: req.params.id },
      include: { sections: sectionInclude(identity) },
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