---
name: Artifact registration during rebase
description: Restoring a temporarily removed preview after replaying the workspace migration
---

Rebasing across the original workspace migration can temporarily remove a web
artifact directory. The artifact watcher may unregister its preview and workflow
even though later commits restore its manifest.

**Why:** The watcher observes intermediate filesystem states during Git replay,
not just the final rebased tree.

**How to apply:** Finish conflict resolution first. If the existing manifest is
restored but the artifact is absent from the inventory, validate and replace that
unchanged manifest through the artifact tooling. Do not create a duplicate app or
invent a replacement workflow.

Also pause active dev servers before replaying a framework restoration.

**Why:** Intermediate commits may temporarily remove the framework's ignore
rules; automatic conflict staging can then capture generated build caches even
when the final tree correctly ignores them.

**How to apply:** After replay, compare against the verified source tree and
untrack any accidentally staged runtime cache without deleting the live files.