import { Router } from './router.js';
import { authBoundary, authRouter } from './auth-boundary.js';
import { requireEvidenceInstructor, requireEvidenceUser } from './auth.js';
import { createLearningEvidenceStore } from './db.js';
import { askJSON, providerStatus } from './model.js';
import capabilitiesRouter from './routes/capabilities.js';
import coursesRouter from './routes/courses.js';
import doctrineRouter from './routes/doctrine.js';
import generateRouter from './routes/generate.js';
import ingestRouter from './routes/ingest.js';
import learningRouter from './routes/learning.js';
import createEvidenceRouter from './routes/learning-evidence.js';
import planRouter from './routes/plan.js';

const registry = Router();

// Keep the legacy API contracts under /api while running them through a
// native Next Request/Response adapter. authBoundary is deliberately global:
// auth/user and every role-protected learning endpoint see the same verified
// session, and cookie mutations retain the CSRF check.
registry.use(authRouter);
registry.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});
registry.use(capabilitiesRouter);
registry.use(coursesRouter);
registry.use(doctrineRouter);
registry.use(generateRouter);
registry.use(ingestRouter);
registry.use(planRouter);
registry.use('/learning', learningRouter);

const evidenceModel = providerStatus().ready
  ? async ({ system, user, schema }) => {
      const result = await askJSON({
        system,
        prompt: user,
        schema: schema || { type: 'object', additionalProperties: true },
      });
      return result.data;
    }
  : undefined;

registry.use(
  createEvidenceRouter({
    requireUser: requireEvidenceUser,
    requireInstructor: requireEvidenceInstructor,
    store: createLearningEvidenceStore(),
    model: evidenceModel,
  }),
);

export { authBoundary, registry };
export default registry;