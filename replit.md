# SchoolCircle

SchoolCircle is a single Next.js 15 application. The root app is the only serving runtime:
the restored landing, authentication, planning board, prototype, learning, teaching, and API
route-handler surfaces all run through the Next server.

## Run & operate

- User-provided preview address: `https://schoolcircle.tannerwhite.net`. Its routing to this workspace has not been verified; local changes are not proof of an update there.

- `pnpm run dev` starts `next dev` on `0.0.0.0` using `$PORT` (default `3000`).
- `pnpm run build` runs the root Next production build.
- `pnpm run start` starts the built Next server on `0.0.0.0` using `$PORT` (default `3000`).
- `pnpm run typecheck` runs the root TypeScript check.
- `pnpm run test:api` runs the API contract/auth tests owned by the API lane.
- `pnpm run db:generate` generates Prisma Client from `prisma/schema.prisma`; it does not
  alter the database.

Do not start a second web or API service. Do not migrate, push, or replace the existing
Postgres database as part of the root app wiring. The Prisma schema and migration history are
the extended artifacts in `artifacts/api-server/prisma`, mirrored under `prisma/` for the root
Next runtime.

## Stack and boundaries

### Explicit development AI testing

OpenRouter is permitted for user-authorized development tests using non-sensitive
sample material. Select its URL and model explicitly in development configuration;
a stored key alone must never enable a cloud fallback. Keep OpenRouter credentials
restricted to its HTTPS origin unless a separate endpoint-specific key is configured.
This exception does not change the self-hosted/offline production goal or authorize
cloud processing of real training documents.

- **SchoolCircle stays on Next.js. Do not migrate it to Vite or replace its original framework.**

- PostgreSQL through Prisma 6; no schema conversion or destructive migration.
- Firebase web auth uses `NEXT_PUBLIC_FIREBASE_*` for local public configuration and
  `/api/auth/firebase-config` for runtime public configuration mapped from the existing secure
  deployment variables. Server routes verify bearer tokens; clients never assign roles.
- Root shared grounding/model/provider adapters are restored from `.migration-backup`.
- `app/api` and `lib/server` are owned by the native API lane.
- `app/learn`, `app/teach`, and `app/_learning` are owned by the learning UI lane.
- The original `/prototype`, landing/auth shell, `/plan` reader, styles, and merged feedback
  widgets remain unchanged in behavior. The lesson reader and feedback workflow remain wired.

## Wiring-only acceptance

Acceptance is integration wiring, not a redesign:

1. The root process is Next.js and binds the Replit-provided port.
2. The original root pages and prototype remain reachable.
3. Existing feedback and lesson-reader flows are preserved.
4. API route handlers use verified bearer auth and approved-content boundaries.
5. Firebase public configuration contains no server secrets and resolves through the runtime
   config endpoint when build-time `NEXT_PUBLIC_*` values are absent.
6. Existing companion adapters remain pinned and are externalized from the Next server bundle
   when they require dynamic filesystem/CJS behavior.

## Git and handoff boundaries

- Keep Git work on `replit/port`; never push to or merge into GitHub `main` without explicit approval.
- Synchronize only merged `origin/main` work, not collaborators' unmerged feature branches.
- Reconcile upstream changes without replacing Next.js, and recheck affected behavior before handoff.
- The user is handling the existing PR separately. Do not create another PR or update the existing one for this restoration.
- Live model verification is deferred under the accepted wiring-only scope. Missing providers must return explicit unavailable states, not simulated outputs.
- Human approval and human-only proctoring remain required; integration adapters must not bypass them.

## Documentation pointers

- For gameday claims, use `docs/gameday/EVIDENCE-MATRIX.md` and `RANGE-CARD.md`.
  Keep historical hardware results separate from current development evidence;
  Thompson retains QA/run-of-show ownership. No published, offline or LMS acceptance
  follows from a local API or fixture pass.
- `README.md`, `PLAN.md`, and `docs/` retain the project specification and planning material.
- `prisma/schema.prisma` and `artifacts/api-server/prisma/` are the database contract.
- `.migration-backup/` is retained as the source archive for restored original modules.

Keep the original grounded rule: every answer cites its source or the system refuses; nothing
unreviewed reaches a learner.