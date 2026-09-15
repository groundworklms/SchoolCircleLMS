---
name: GitHub push access
description: Difference between connector access and Git transport authentication.
---

A healthy GitHub connector and repository `push` permission do not prove that the integration can write Git objects or authenticate command-line Git.

**Why:** The connector could read repository metadata but Git-object writes returned HTTP 403, while command-line push separately failed authentication.

**How to apply:** Treat these as distinct authorization paths. Check Replit's current Git Providers documentation when Git transport access fails; do not repeatedly request connector reauthorization when its health check reports healthy.