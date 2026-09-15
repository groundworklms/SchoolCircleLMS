# SchoolCircle project constraints

## Keep Next.js

SchoolCircle must remain the original **Next.js** application. Do not replace it
with Vite, migrate it into a separate frontend/API monorepo, or introduce a
parallel application framework unless the user explicitly authorizes that change.

The team is developing the same GitHub repository concurrently. A framework port
creates incompatible work and merge conflicts. Preserve the upstream application
structure and limit Replit compatibility changes to workspace configuration.

Make changes on a feature branch and submit a pull request into `main`.
Do not commit/push directly to `main`, merge, or publish without explicit approval.