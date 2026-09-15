import { Router, type IRouter } from "express";
import { prisma } from "../lib/prisma";

const router: IRouter = Router();

const itemSelect = {
  id: true,
  kind: true,
  stem: true,
  options: true,
  answer: true,
  rationale: true,
  citation: true,
  support: true,
  status: true,
} as const;

const sectionsInclude = {
  orderBy: { order: "asc" as const },
  include: {
    items: {
      // This is intentionally part of the Prisma query, rather than an in-memory filter.
      where: { status: "APPROVED" as const },
      orderBy: { createdAt: "asc" as const },
      select: itemSelect,
    },
  },
} as const;

router.get("/", async (_req, res) => {
  try {
    const courses = await prisma.course.findMany({
      orderBy: { createdAt: "asc" },
      include: { sections: sectionsInclude },
    });

    res.json({ courses });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message, code: "DB_ERROR" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: { sections: sectionsInclude },
    });

    if (!course) {
      res.status(404).json({ error: "course not found" });
      return;
    }

    res.json({ course });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message, code: "DB_ERROR" });
  }
});

export default router;