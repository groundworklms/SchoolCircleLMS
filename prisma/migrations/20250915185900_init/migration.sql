-- Baseline for the imported SchoolCircle Prisma schema.
-- Environments that already contain these tables should baseline this migration
-- with `prisma migrate resolve --applied 20250915185900_init` instead of
-- attempting to recreate them. This migration is safe for an empty dev DB.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "Role" AS ENUM ('INSTRUCTOR', 'LEARNER');
CREATE TYPE "ItemKind" AS ENUM ('LESSON', 'QUESTION', 'SCENARIO');
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'LEARNER',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "stem" TEXT NOT NULL,
    "options" JSONB,
    "answer" JSONB,
    "rationale" TEXT,
    "citation" JSONB,
    "support" DOUBLE PRECISION,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "answer" JSONB NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "gradedAgainst" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Mastery" (
    "id" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "masteryPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calibrationGap" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Mastery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");
CREATE INDEX "Section_courseId_idx" ON "Section"("courseId");
CREATE INDEX "Item_sectionId_status_idx" ON "Item"("sectionId", "status");
CREATE INDEX "Attempt_learnerId_itemId_idx" ON "Attempt"("learnerId", "itemId");
CREATE INDEX "Attempt_itemId_idx" ON "Attempt"("itemId");
CREATE UNIQUE INDEX "Mastery_learnerId_section_key" ON "Mastery"("learnerId", "section");
CREATE INDEX "Schedule_learnerId_dueAt_idx" ON "Schedule"("learnerId", "dueAt");
CREATE UNIQUE INDEX "Schedule_itemId_learnerId_key" ON "Schedule"("itemId", "learnerId");

ALTER TABLE "Section"
  ADD CONSTRAINT "Section_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Item"
  ADD CONSTRAINT "Item_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt"
  ADD CONSTRAINT "Attempt_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt"
  ADD CONSTRAINT "Attempt_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mastery"
  ADD CONSTRAINT "Mastery_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_learnerId_fkey"
  FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;