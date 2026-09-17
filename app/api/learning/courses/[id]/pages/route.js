// /api/learning/courses/:id/pages -- write grounded lesson pages for a saved
// course (owner only). New drafts get pages during generation; this is for
// courses drafted before that pass existed. Model calls run per section, so
// the route can take a minute or more on a long course.
import { learningRoute } from '../../../../../../lib/learning/http';
import { expandCoursePagesRecord } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => expandCoursePagesRecord(identity, input),
);
