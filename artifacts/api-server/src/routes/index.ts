import { Router, type IRouter } from "express";
import healthRouter from "./health";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import capabilitiesRouter from "./capabilities.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import doctrineRouter from "./doctrine.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import generateRouter from "./generate.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import ingestRouter from "./ingest.js";
// @ts-expect-error Legacy route module is intentionally kept as JavaScript for parity.
import planRouter from "./plan.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(capabilitiesRouter);
router.use(doctrineRouter);
router.use(generateRouter);
router.use(ingestRouter);
router.use(planRouter);

export default router;
