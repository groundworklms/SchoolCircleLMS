---
name: Source restoration fidelity
description: Preserve exact upstream source when undoing a framework migration
---

When restoring original application files, copy the verified upstream contents
verbatim, then make only the explicit compatibility changes. Check the restored
tree against the source, not just whether the build passes.

**Why:** Builds validate runnable code, not fidelity to existing behavior.
Abbreviated replacements can compile while silently omitting working features.

**How to apply:** Keep the original source as the authority. Compare hashes or
diffs for pages, styles, and data; do not accept a successful build or a
restoration summary as proof that existing features were preserved.

During a paused rebase, compare the working tree directly with the upstream
reference (`git diff origin/main -- <paths>`), not a triple-dot comparison with
HEAD.

**Why:** HEAD excludes the commit currently being resolved; a merge-base diff
can report already restored files as deleted and obscure the actual conflicts.

**How to apply:** Audit the resolved tree before continuing, preserving upstream
UI and security fixes alongside explicit local runtime adaptations.