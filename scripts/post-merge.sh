#!/bin/bash
set -euo pipefail
CI=true pnpm install --frozen-lockfile
# Generate code only. Schema changes require a separately approved migration.
pnpm run db:generate
