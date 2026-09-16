// /api/learning/sources/pdf -- Instructor PDF upload -> Quarry page-preserving source. The legacy /api/ingest parse seam is unchanged.
import { learningRoute } from '../../../../../lib/learning/http';
import { createSourceFromPdf } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = learningRoute({ roles: ['INSTRUCTOR'], body: 'form' }, ({ identity, ...input }) => createSourceFromPdf(identity, input));
