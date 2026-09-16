// /api/learning/courses/:id/mastery-plan -- Generate one instructor-owned
// pending Whetstone plan for an approved related source.
import { learningRoute } from '../../../../../../lib/learning/http';
import { generateMasteryPlan } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => generateMasteryPlan(identity, input),
);