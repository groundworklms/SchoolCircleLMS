// /api/learning/rubrics/generate -- Rubricon rubric from a task + source, validated and traceability-checked. Stays PENDING.
import { learningRoute } from '../../../../../lib/learning/http';
import { generateRubricRecord } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => generateRubricRecord(identity, input));
