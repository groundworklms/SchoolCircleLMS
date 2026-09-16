-- Additive only: keep all existing identities, names, roles and learning relations.
-- NULL completion prompts existing users to confirm their preferred name.
ALTER TABLE "User"
  ADD COLUMN "rank" VARCHAR(40),
  ADD COLUMN "profileCompletedAt" TIMESTAMP(3);