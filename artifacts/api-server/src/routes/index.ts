import { Router, type IRouter } from "express";
import healthRouter from "./health";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import capabilitiesRouter from "./capabilities.js";
// @ts-expect-error Feedback route intentionally remains JavaScript to match the
// upstream Next handler's implementation.
import feedbackRouter from "./feedback.js";
// @ts-expect-error Courses read model intentionally remains JavaScript to match
// the upstream Next handlers' implementation.
import coursesRouter from "./courses.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import doctrineRouter from "./doctrine.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import generateRouter from "./generate.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import ingestRouter from "./ingest.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import planRouter from "./plan.js";
// @ts-expect-error Core integration route intentionally remains JavaScript.
import learningRouter from "./learning.js";
// @ts-expect-error Evidence adapters are maintained as a focused module by the
// downstream analytics/evidence integration.
import createEvidenceRouter from "./learning-evidence.js";
import {
  requireEvidenceInstructor,
  requireEvidenceUser,
// @ts-ignore Auth helpers remain a JavaScript integration seam.
} from "../lib/auth.js";
// @ts-expect-error Replit OIDC/session routes remain a JavaScript integration seam.
import { authRouter } from "../lib/auth-boundary.js";
// @ts-expect-error Prisma adapter remains a JavaScript integration seam.
import { createLearningEvidenceStore } from "../lib/db.js";
// @ts-expect-error Model adapter remains a JavaScript integration seam.
import { askJSON, providerStatus } from "../lib/model.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(feedbackRouter);
router.use(coursesRouter);
// Browser OIDC endpoints are mounted below /api by app.ts.  The middleware
// in app.ts runs before this router, so /auth/user also sees the verified
// Prisma-backed session identity.
router.use(authRouter);
router.use(capabilitiesRouter);
router.use(doctrineRouter);
router.use(generateRouter);
router.use(ingestRouter);
router.use(planRouter);
// Keep all SchoolCircle learning APIs under the stable prefix.  GET /api/plan
// above remains the planning board and is deliberately not replaced by Cadence.
router.use("/learning", learningRouter);
// The evidence router owns its `/learning/...` paths; mounting it at the API
// root keeps the public prefix exactly `/api/learning/...` (not duplicated).
// Understudy/Hotwash receive the same configured provider as the core adapters;
// no provider means explicit Understudy unavailability.
const evidenceModel = providerStatus().ready
  ? async ({
      system,
      user,
      schema,
    }: {
      system: string;
      user: string;
      schema?: Record<string, unknown>;
    }) => {
      const result = await askJSON({
        system,
        prompt: user,
        schema: schema || { type: "object", additionalProperties: true },
      });
      return result.data;
    }
  : undefined;
router.use(
  createEvidenceRouter({
    requireUser: requireEvidenceUser,
    requireInstructor: requireEvidenceInstructor,
    store: createLearningEvidenceStore(),
    model: evidenceModel,
  }),
);

export default router;
