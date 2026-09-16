#!/usr/bin/env bash
# One-shot readiness check for the Orin + Anchor stack. Run this first each day.
#   ops/orin-check.sh
# Uses a SINGLE ssh connection — the USB device-mode link times out under many
# rapid separate connections, so everything runs in one remote shell.
set -uo pipefail
ORIN=vanguard@192.168.55.1
KEY="${ORIN_SSH_KEY:-$HOME/.ssh/gameday_orin}"

echo "== link =="
if ping -n 1 192.168.55.1 >/dev/null 2>&1 || ping -c 1 -W 2 192.168.55.1 >/dev/null 2>&1; then
  echo "  ✓ 192.168.55.1 reachable (USB device-mode)"
else
  echo "  ✗ Orin not reachable — is the USB cable connected and the board powered?"; exit 1
fi

ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$ORIN" 'bash -s' <<'REMOTE'
echo "== services =="
for u in tutor-api tutor-gen tutor-embed tutor-rerank tutor-verify; do
  printf "  %-14s %s\n" "$u" "$(systemctl is-active $u 2>/dev/null)"
done
echo "== health =="
echo -n "  "; curl -s --max-time 4 http://192.168.55.1:8000/api/health; echo
echo "== corpus (expect TC 3-22.9 among the pubs) =="
curl -s --max-time 4 http://192.168.55.1:8000/api/corpus | tr ',' '\n' | grep -i "3-22.9" | head -1 | sed 's/^/  /' || echo "  (could not read corpus)"
REMOTE

echo "== done =="
echo "  If the tutor shows source = fts, the tunnel dropped — re-run ops/tunnel.sh."
