import { PrismaClient } from "@prisma/client";

// Prisma client singleton (cached on globalThis in dev so hot-reload doesn't open
// a new pool on every change).
const g = globalThis;
export const prisma = g.__scPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__scPrisma = prisma;

// ---------------------------------------------------------------------------
// classGaps() — the instructor's class view is a QUERY, not a table.
//
// It groups attempts BY SECTION and NEVER selects learnerId, so an instructor
// sees where the *class* is weak but can never be handed one Marine's answers.
// This is the storage-layer twin of Sextant's aggregate guarantee.
//
// DO NOT REGRESS:
//   1. Never add a learnerId filter to this aggregate.
//   2. Never turn this aggregate into a per-student table.
// ---------------------------------------------------------------------------
export async function classGaps() {
  const rows = await prisma.attempt.findMany({
    // NOTE: learnerId is deliberately NOT selected.
    select: {
      correct: true,
      confidence: true,
      item: { select: { section: { select: { title: true } } } },
    },
  });

  const by = new Map();
  for (const r of rows) {
    const sec = r.item?.section?.title ?? "(unknown)";
    const b = by.get(sec) ?? { section: sec, attempts: 0, misses: 0, confidentlyWrong: 0 };
    b.attempts += 1;
    if (!r.correct) {
      b.misses += 1;
      if (r.confidence >= 2) b.confidentlyWrong += 1; // high confidence + wrong = the dangerous case
    }
    by.set(sec, b);
  }

  return [...by.values()].map((b) => ({
    ...b,
    missRate: b.attempts ? b.misses / b.attempts : 0,
  }));
}
