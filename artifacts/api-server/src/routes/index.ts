import { Router, type IRouter } from "express";
import healthRouter from "./health";
import capabilitiesRouter from "./capabilities";
import doctrineRouter from "./doctrine";
import generateRouter from "./generate";
import ingestRouter from "./ingest";
import planRouter from "./plan";
import coursesRouter from "./courses";
import feedbackRouter from "./feedback";

const router: IRouter = Router();

router.use(healthRouter);
router.use(capabilitiesRouter);
router.use(doctrineRouter);
router.use(generateRouter);
router.use(ingestRouter);
router.use(planRouter);
router.use("/courses", coursesRouter);
router.use(feedbackRouter);

export default router;
