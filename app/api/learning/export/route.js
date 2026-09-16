// /api/learning/export -- Cartridge SCORM 1.2/2004 zip of an APPROVED course, validated before it is sent.
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().exportScorm(identity, input));
