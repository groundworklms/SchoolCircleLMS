---
name: GitHub push access
description: Difference between connector access and Git transport authentication.
---

A healthy GitHub connector and repository `push` permission do not prove that the integration can write Git objects or authenticate command-line Git.

**Why:** The connector could read repository metadata but Git-object writes returned HTTP 403, while command-line push separately failed authentication.

**How to apply:** Treat these as distinct authorization paths. Check Replit's current Git Providers documentation when Git transport access fails; do not repeatedly request connector reauthorization when its health check reports healthy.

When transferring local Git objects through the connector's GitHub API, reuse
objects that already exist remotely instead of recreating historical commits.
Verify each newly created object's SHA before updating a branch ref.

**Why:** Recreating a historical commit with normalized UTC author/committer
timestamps changes its hash even when the file tree and message are identical.
The original GitHub commit can instead be referenced directly.

**How to apply:** Check remote commit/tree existence by SHA, upload missing
objects, verify the expected remote branch tip before changing it, and verify
the final local and remote SHAs match. Never treat content equality alone as
commit equality.