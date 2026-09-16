// /api/learning/courses/draft -- Coursewright draft from selected sources through the configured model. Stays PENDING.
import { learningRoute } from '../../../../../lib/learning/http';
import { draftCourseRecord } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => draftCourseRecord(identity, input));
