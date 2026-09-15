-- Additive boundary for persisted integration payloads.
CREATE TABLE "LearningRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearningRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningRecord_ownerId_type_idx"
    ON "LearningRecord"("ownerId", "type");
CREATE INDEX "LearningRecord_type_status_idx"
    ON "LearningRecord"("type", "status");