// Idempotent seed: a demo-ready TC 3-22.9 course, one instructor, one learner, a few
// attempts (including the confidently-wrong case), mastery rollups, and a due schedule.
// Re-runnable — everything upserts by a stable id/unique key.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Single source of truth shared with the app's "sample mode" fallback (lib/sample.js
// imports the same JSON). Plain JSON so this CommonJS seed and the ESM app agree.
const sampleCourse = require("../lib/sample.json");

async function main() {
  // --- users ---------------------------------------------------------------
  const instructor = await prisma.user.upsert({
    where: { externalId: "seed-instructor" },
    update: { name: "SSgt Instructor", role: "INSTRUCTOR" },
    create: { name: "SSgt Instructor", role: "INSTRUCTOR", externalId: "seed-instructor" },
  });

  const learner = await prisma.user.upsert({
    where: { externalId: "seed-learner" },
    update: { name: "Cpl Learner", role: "LEARNER" },
    create: { name: "Cpl Learner", role: "LEARNER", externalId: "seed-learner" },
  });

  // --- course tree ---------------------------------------------------------
  await prisma.course.upsert({
    where: { id: sampleCourse.id },
    update: { title: sampleCourse.title, sourceId: sampleCourse.sourceId },
    create: { id: sampleCourse.id, title: sampleCourse.title, sourceId: sampleCourse.sourceId },
  });

  for (const s of sampleCourse.sections) {
    await prisma.section.upsert({
      where: { id: s.id },
      update: { title: s.title, order: s.order, courseId: sampleCourse.id },
      create: { id: s.id, title: s.title, order: s.order, courseId: sampleCourse.id },
    });

    for (const it of s.items) {
      const data = {
        sectionId: s.id,
        kind: it.kind,
        stem: it.stem,
        options: it.options ?? undefined,
        answer: it.answer ?? undefined,
        rationale: it.rationale ?? undefined,
        citation: it.citation ?? undefined,
        support: it.support ?? undefined,
        status: it.status,
      };
      await prisma.item.upsert({ where: { id: it.id }, update: data, create: { id: it.id, ...data } });
    }
  }

  // --- attempts (the calibration signal) -----------------------------------
  // it-fund-3 (trigger control MC): confident + correct = mastered.
  // it-safety-2 (off safe MC): confident + WRONG = the confidently-wrong case.
  // it-zero-... none pending attempts. it-fund-1 lesson has no attempts.
  const attempts = [
    {
      id: "att-1",
      itemId: "it-fund-3",
      confidence: 3,
      answer: { choice: 1 },
      correct: true,
      gradedAgainst: { citation: "TC 3-22.9, Ch 3, Trigger Control, para 3-24, p.3-8" },
    },
    {
      id: "att-2",
      itemId: "it-safety-2",
      confidence: 3, // stated high confidence...
      answer: { choice: 0 },
      correct: false, // ...but wrong: confidently wrong -> priority re-teach
      gradedAgainst: { citation: "TC 3-22.9, Ch 2, Weapons Safety Rules, para 2-1, p.2-1" },
    },
    {
      id: "att-3",
      itemId: "it-fund-3",
      confidence: 1, // unsure...
      answer: { choice: 1 },
      correct: true, // ...but right: re-test sooner
      gradedAgainst: { citation: "TC 3-22.9, Ch 3, Trigger Control, para 3-24, p.3-8" },
    },
  ];

  for (const a of attempts) {
    const data = {
      itemId: a.itemId,
      learnerId: learner.id,
      confidence: a.confidence,
      answer: a.answer,
      correct: a.correct,
      gradedAgainst: a.gradedAgainst,
    };
    await prisma.attempt.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
  }

  // --- mastery rollups (per learner, per section title) ---------------------
  const mastery = [
    { section: "Safety & Weapon Handling", masteryPct: 0.55, calibrationGap: 0.4 }, // dragged down by the confidently-wrong miss
    { section: "Fundamentals of Marksmanship", masteryPct: 0.78, calibrationGap: 0.15 },
    { section: "Zeroing & Ballistics", masteryPct: 0.4, calibrationGap: null },
  ];
  for (const m of mastery) {
    await prisma.mastery.upsert({
      where: { learnerId_section: { learnerId: learner.id, section: m.section } },
      update: { masteryPct: m.masteryPct, calibrationGap: m.calibrationGap },
      create: { learnerId: learner.id, section: m.section, masteryPct: m.masteryPct, calibrationGap: m.calibrationGap },
    });
  }

  // --- schedule (due today) ------------------------------------------------
  const today = new Date();
  const schedules = [
    { itemId: "it-safety-2", dueAt: today, interval: 1 }, // shaky -> comes back now
    { itemId: "it-fund-3", dueAt: new Date(today.getTime() + 7 * 86400000), interval: 7 }, // mastered -> spaced out
  ];
  for (const sc of schedules) {
    await prisma.schedule.upsert({
      where: { itemId_learnerId: { itemId: sc.itemId, learnerId: learner.id } },
      update: { dueAt: sc.dueAt, interval: sc.interval },
      create: { itemId: sc.itemId, learnerId: learner.id, dueAt: sc.dueAt, interval: sc.interval },
    });
  }

  console.log("Seed complete:");
  console.log(`  instructor: ${instructor.name} (${instructor.id})`);
  console.log(`  learner:    ${learner.name} (${learner.id})`);
  console.log(`  course:     ${sampleCourse.title} [${sampleCourse.sourceId}]`);
  const pending = await prisma.item.count({ where: { status: "PENDING" } });
  console.log(`  items PENDING review: ${pending}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
