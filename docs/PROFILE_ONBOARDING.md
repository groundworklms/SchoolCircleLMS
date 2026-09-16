# Complete account onboarding

Authenticated users complete their name, role, service branch, pay grade, and
branch-specific rank. Civilian / not serving profiles have no pay grade or rank.
The same fields can be changed in Settings.

Roles are Student (`LEARNER`), Instructor (`INSTRUCTOR`), and Both (`BOTH`).
By explicit product-owner decision, selecting Instructor or Both grants
instructor access immediately after a successful save. This is self-service
access, not a verified instructor credential. Student selection removes that
access. All server authorization still uses the authenticated user's database
role; client-side navigation is not an authorization boundary.

The shared catalog covers the six U.S. armed-service branches, standard
enlisted/officer/warrant grades where applicable, and a civilian choice.
Existing legacy free-text ranks remain stored until the user saves a valid new
selection. Existing users missing the new fields complete onboarding again.

## Release requirement

Apply the additive `20260916000000_profile_onboarding` migration with the
approved migration process **before** deploying this code. It adds `BOTH` to
the role enum and nullable `branch` and `payGrade` columns; it does not erase
existing profiles or change existing users' roles.

No automatic migrations, demo seeds, cloud changes, or deployment are part of
installing or building this feature. Do not deploy code that selects the new
columns before the migration has been applied.

## Verification

- `npm run test:account-profile`: profile validation, ownership, role changes,
  async save/reload behavior, and catalog validation.
- `npm run test:db`: disposable native PostgreSQL only; verifies additive
  migrations, saved military and civilian profiles across reconnects, Both
  permissions, downgrade, and invalid requests leaving saved data unchanged.
- `npm run build`: Next.js production compilation.

These checks do not claim that the migration has been applied to a live cloud
database or that Firebase sign-in has been tested in production.