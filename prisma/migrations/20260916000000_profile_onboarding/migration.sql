-- Additive profile onboarding fields and the combined learner/instructor role.
-- Existing users retain their current names, roles and relations until they
-- explicitly complete the profile.
ALTER TYPE "Role" ADD VALUE 'BOTH';

ALTER TABLE "User"
  ADD COLUMN "branch" TEXT,
  ADD COLUMN "payGrade" TEXT;
