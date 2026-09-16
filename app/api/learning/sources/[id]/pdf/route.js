// /api/learning/sources/:id/pdf -- Authenticated inline original PDF bytes.
import { learningRoute } from '../../../../../../lib/learning/http.js';
import {
  attachSourcePdfRecord,
  getSourcePdf,
} from '../../../../../../lib/learning/core.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = learningRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => getSourcePdf(identity, input),
);
export const POST = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'form' },
  ({ identity, ...input }) => attachSourcePdfRecord(identity, input),
);