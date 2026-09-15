---
name: Package tool configuration drift
description: Package installation may introduce unrelated environment configuration changes.
---

Review `.replit` after using the package installation tooling, even when the
requested change concerns only JavaScript dependencies.

**Why:** A dependency installation introduced an explicit Nix channel override
where none existed. The user subsequently reported a Nix failure; the exact Nix
error was unavailable, so causation was not established.

**How to apply:** Keep the existing working toolchain configuration unless a
change is necessary and verified. Use validated configuration tooling to remove
unrequested overrides; confirm setup and the app separately rather than assuming
a successful package install proves the environment is healthy.