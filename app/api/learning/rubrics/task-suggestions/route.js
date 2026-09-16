// /api/learning/rubrics/task-suggestions -- Fill the rubric task form from a source: Quarry's
// ingest-time extraction where the document carries task blocks, the model where it does not.
import { learningRoute } from '../../../../../lib/learning/http';
import { suggestRubricTasks } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => suggestRubricTasks(identity, input));
