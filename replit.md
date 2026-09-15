# SchoolCircle LMS

SchoolCircle is a grounded learning-management workspace with a live hackathon planning board and interactive instructor/student prototype.

## Run & Operate

- `pnpm --filter @workspace/schoolcircle-lms run dev` — run the Vite web app (managed workflow port)
- `pnpm --filter @workspace/api-server run dev` — run the API server (managed workflow port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/schoolcircle-lms run typecheck` — typecheck the web artifact
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API artifact
- The web app calls the shared API through `/api`; the API exposes the plan board, capability status, doctrine, generation, and POI ingestion endpoints.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + wouter
- API: Express 5 with the imported provider adapters and PDF parser
- Build: Vite for the web artifact, esbuild for the API bundle

## Where things live

- `artifacts/schoolcircle-lms/` — React/Vite landing page at `/`, Firebase login at `/login`, planning board at `/plan`, and `/prototype` flows
- `artifacts/api-server/` — Express routes under `/api`
- `PLAN.md` — live markdown source rendered by the `/plan` board
- `prisma/schema.prisma` — Prisma data model for the original Course → Section → Item read API; `prisma/seed.js` preserves the imported TC 3-22.9 cited content.
- `.migration-backup/` — imported Next.js source and hosting configuration retained for reference, including newer upstream features

## Architecture decisions

- The frontend is fully client-rendered and uses wouter so the original URL-backed prototype navigation works on refresh.
- The shared API artifact owns the former Next.js route handlers; the browser keeps the original `/api/...` contracts.
- The planning board reads `PLAN.md` through the API so polling and no-cache behavior work behind the Replit proxy.
- Optional doctrine/model integrations remain environment-driven and report unavailable providers honestly.
- Cited course reads use Prisma and `DATABASE_URL`. Keep the original Prisma schema rather than pushing the empty scaffold Drizzle schema against these tables.
- Lesson citations are strictly section-scoped: an empty section must not display another chapter's claims. Seeded citations are imported content, not newly verified by a live Anchor service.
- Firebase Auth is the upstream browser-session gate for `/prototype`; it is not API authorization. When Firebase is unconfigured, the upstream no-lockout demo behavior is preserved.
- Firebase App Hosting's Next.js configuration is archived in `.migration-backup/apphosting.yaml`; it is not the run configuration for this Vite/Express port. Replit uses the two artifact service configurations.

## Product

- Public landing page, Firebase email/password and Google sign-in, and protected prototype routes when configured.
- Live multi-column hackathon planning board with Markdown rendering and display controls.
- Student and instructor prototype flows for courses, lessons, discussions, progress, live sessions, and curriculum authoring.
- API-backed capability status, grounded doctrine questions, study-aid generation, and POI PDF ingestion.
- Global Ask-the-doctrine and QA-report widgets, including optional direct GitHub issue filing with retained-draft fallback when unconfigured.

## User preferences

_No project-specific preferences recorded._

## Gotchas

- Run web build commands with workflow-provided `PORT` and `BASE_PATH`; managed artifact workflows supply them automatically.
- `MODEL_BASE_URL` and `DOCTRINE_BASE_URL` are optional; their absence disables generation or grounding rather than breaking the rest of the app.
- Firebase settings use `VITE_FIREBASE_*` variables at web build time; see `docs/replit-configuration.md`. Upstream Firebase hosting variables are not automatically imported into Replit.
- The temporary Anchor tunnel in the archived hosting config is not a stable service URL. Set a reachable `DOCTRINE_BASE_URL` for this environment; do not assume the archived tunnel is still live.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
