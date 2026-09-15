#!/usr/bin/env bash
# Open the SSH tunnel so the workstation app can reach Anchor's API on the Orin.
# Anchor binds to the Orin's loopback (127.0.0.1:8000); this forwards the workstation's :8000 to it.
# Run in one terminal (Ctrl-C to stop), then set DOCTRINE_BASE_URL=http://localhost:8000 in the app .env.
#   ops/tunnel.sh
set -euo pipefail
KEY="${ORIN_SSH_KEY:-$HOME/.ssh/gameday_orin}"
echo "Tunneling localhost:8000 → orin-vanguard:8000 (Anchor). Ctrl-C to stop."
exec ssh -i "$KEY" -N -L 8000:127.0.0.1:8000 vanguard@192.168.55.1
