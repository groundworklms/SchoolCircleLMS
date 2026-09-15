# SchoolCircle

Imported SchoolCircle learning platform and hackathon planning board.

## Run & Operate

- User-provided preview address: `https://schoolcircle.tannerwhite.net`. Its routing to this workspace has not been verified; do not assume it reflects local changes automatically.
- Use managed workflows `artifacts/schoolcircle: web` and `artifacts/api-server: API Server` for preview; they provide the required ports and routing.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- The imported Prisma schema is preserved; no database conversion or schema push was performed.
- Live integrations retain their original configuration: `MODEL_BASE_URL`, `MODEL_ID`, optional `MODEL_API_KEY`, and `DOCTRINE_BASE_URL`. Without them the original explicit unavailable states remain.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Imported DB support: Prisma + PostgreSQL; unused Drizzle workspace scaffold retained
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite frontend and esbuild ESM API bundle

## Where things live

- `artifacts/schoolcircle/src/`: imported board and prototype; original CSS retained.
- `artifacts/api-server/src/`: Express adapters and unchanged imported backend libraries.
- `artifacts/api-server/prisma/schema.prisma`: imported database schema.
- `PLAN.md`, `docs/`: original planning content and documentation.
- `.migration-backup/`: untouched imported source for comparison.

## Architecture decisions

- Keep the migration narrow so collaborators can reconcile ongoing GitHub changes; do not replace source logic with generated clients or redesign components.
- Use the full twelve-repository ecosystem described in `docs/05-arsenal-contracts.md` when extending SchoolCircle. Reuse each companion's existing capability rather than recreating it in the host. Verify actual source exports and versions before wiring integrations; documentation or ingested reference material alone does not establish runtime integration. Keep grounding/citation behavior intact.

## Product

- `/`: merged SchoolCircle landing page; `/plan`: live markdown planning board. `GET /api/plan` remains the board API, not Cadence.
- `/prototype` and its existing nested routes: student and instructor learning-platform prototype.
- `/learn` and `/teach`: API-backed learning and instructor workflows; model-backed operations explicitly report unavailable until their providers are configured.
- Merged Firebase sign-in is preserved, with ID tokens verified server-side and roles read from Prisma. Replit OIDC remains an alternative. Public Firebase client configuration comes from environment settings; no client may assign an instructor role.
- Temporary hosted-model verification is user-approved for public test material only. Keep it separate from production/self-hosted provider settings and remove temporary verification configuration afterward; hosted evidence does not prove offline Orin operation.

## User preferences

- Git work must stay on `replit/port`. Do not commit or push to the GitHub remote's main branch.
- Before considering integration work done, rebase `replit/port` onto the latest merged `origin/main`, reconcile the ported paths, and recheck affected behavior. Do not push to `main` without explicit approval.
- Keep this port current with GitHub `origin/main` (user-confirmed: merged team changes only): fetch and compare before further implementation or preparing a push. Do not incorporate collaborators' unmerged feature branches. Reconcile source changes into the ported paths rather than blindly pulling the Next.js layout over the workspace. This is a development workflow, not automatic background synchronization.
- Preserve the imported routes, styling, and grounding/citation logic exactly; collaborators are actively editing the hackathon source on GitHub. Limit migration changes to runtime adapters and workspace wiring.

## Gotchas

- The prototype's original scripted demo data is intentional. Live generation/grounding must not be silently simulated when services are unavailable.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
