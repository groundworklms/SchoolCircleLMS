// /api/learning/courses -- Course drafts visible to the caller (learners: APPROVED only; instructors: plus their own).
import { learningRoute } from '../../../../lib/learning/http';
import { listCourses } from '../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => listCourses(identity, input));
