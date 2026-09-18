// /api/learning/courses/:id/rubrics -- Write one BARS rubric per taught
// objective against a saved course. Runs during generation; this endpoint is
// how a pass that failed, or a course drafted before rubrics existed, gets
// them. Only the objectives with no rubric yet are written.
import { learningRoute } from '../../../../../../lib/learning/http';
import { buildCourseRubricsRecord } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => buildCourseRubricsRecord(identity, input),
);
