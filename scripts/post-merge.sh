#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm exec prisma db push --schema prisma/schema.prisma --skip-generate
