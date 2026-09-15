# Replit configuration after the Next.js migration

The active product is the React/Vite web artifact plus the Express API artifact.
The upstream Next.js sources and Firebase App Hosting configuration are archived
under `.migration-backup/` for comparison; they are not a second running app.
The current upstream gameday instructions remain available under
`.migration-backup/docs/gameday/`.

## Routes

- `/`: public landing page.
- `/login`: email/password login, account creation, and Google sign-in.
- `/plan`: the original live planning board.
- `/prototype` and nested routes: student/instructor app, gated by Firebase
  **when Firebase is configured**.
- `/api/*`: the shared Express service. Existing course, doctrine, capability,
  plan, generation, and ingestion contracts are preserved.

## Firebase

Set these public Firebase web-app settings in the web build environment:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_STORAGE_BUCKET` (optional)
- `VITE_FIREBASE_MESSAGING_SENDER_ID` (optional)

Use the same Firebase project as the existing app. Vite embeds these public
web-client settings at build time; a change requires a new web build.
Do not use service-account credentials or private keys in a `VITE_` variable.
The upstream `NEXT_PUBLIC_FIREBASE_*` settings need these new names.
Enable the relevant email/password and Google providers in Firebase Authentication,
and add the intended preview/production hosts to Firebase's authorized domains.

Without complete Firebase configuration, the app preserves upstream's
**no-lockout demo mode**: the prototype is accessible and login explains that
authentication is not configured. This is not a production authorization mode.
The existing Firebase guard is a browser navigation gate only; Express course
reads retain the upstream public-read contract and the APPROVED-only filter.
No new API authorization policy is implied by this migration.

## Grounding and model services

`DOCTRINE_BASE_URL` is an optional API-server setting pointing to a reachable
Anchor service. The server sends `{question}` to its `/api/ask` endpoint.
`DOCTRINE_TIMEOUT_MS` controls the request timeout. An abstention remains a valid
HTTP 200 response, while unavailable services are reported explicitly.

The archived Firebase hosting file contains an upstream temporary tunnel
configuration. Replit does not load it, and the migration does not assume that
tunnel remains active. Configure a current, reachable service endpoint separately.
Without one, Ask-the-doctrine honestly reports that grounding is unavailable.

Generation uses optional `MODEL_BASE_URL`, `MODEL_ID`, and `MODEL_API_KEY`.
Keep service credentials in server-side secrets, never in browser environment
variables. Neither the port nor its tests substitute mock results for live
generation/grounding responses.

## Database

Prisma owns the existing Course → Section → Item schema through `DATABASE_URL`.
Install generates the Prisma client. For an empty development database, apply
`pnpm exec prisma db push --schema prisma/schema.prisma`, then
`pnpm run db:seed`. The seed preserves the original TC 3-22.9 cited items and
is idempotent. Do not accept destructive schema changes or push the unused
Drizzle scaffold over these tables.

No production database, Firebase provider setting, or external service was
changed as part of the rebase.