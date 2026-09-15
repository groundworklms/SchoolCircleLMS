---
name: Vercel import migration
description: Migration helper behavior for imported Next.js apps in the pnpm workspace scaffold.
---

The frontend copy helper is optimized for Vite-style `src/` or `client/src/` imports. For an imported Next.js app whose source lives under `app/`, run the helper with the explicit client directory first, then port the `app/` tree into the web artifact while replacing Next-only routing and server APIs.

**Why:** The helper's autodetection correctly reports no client directory for a Next.js `app/` tree, and its explicit `app` mode only emits a warning because it looks for `app/src`.

**How to apply:** Treat the helper as the scaffold/setup step for Next.js imports, not as a complete source copy. Preserve the imported tree in `.migration-backup/`, and migrate API routes into the shared Express artifact.