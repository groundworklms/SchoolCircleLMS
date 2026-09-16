// /api/learning/sources/:id -- One source with its page text and passages (owner, or anyone once APPROVED).
//
// PATCH renames it; DELETE removes it, but refuses while any course still
// cites it, because a source is the grounding behind those citations. Both are
// owner-only and instructor-only: the read is shared, the writes are not.
import { learningRoute } from '../../../../../lib/learning/http';
import { deleteSource, getSource, renameSource } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getSource(identity, input));

export const PATCH = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => renameSource(identity, input),
);

export const DELETE = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => deleteSource(identity, input),
);
