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
echo "== corpus (expect 14 publications / 4731 chunks, TC 3-22.9 among them) =="
CORPUS=$(curl -s --max-time 4 http://192.168.55.1:8000/api/corpus)
if [ -z "$CORPUS" ]; then
  echo "  (could not read corpus)"
else
  echo "$CORPUS" | grep -i -o "TC 3-22.9" | head -1 | sed 's/^/  found /'
  # The chunk total is the cheap way to catch a reflashed or half-ingested
  # board: "it answered" does not distinguish a loaded index from an empty one.
  if echo "$CORPUS" | grep -q '"total_chunks":[ ]*4731'; then
    echo "  OK  chunk count matches the verified corpus (4731 / 14 pubs)"
  else
    echo "  !!  chunk count is NOT 4731 - this is not the index that was verified"
  fi
fi
REMOTE

echo "== done =="
# There is NO Postgres-FTS fallback in this application -- "source = fts" is a
# state the app cannot produce, so an operator told to watch for it is watching
# for nothing. If Anchor is unreachable the grounded turn FAILS and says so.
echo "  If grounding fails, Anchor is unreachable - check the address in"
echo "  Settings -> Doctrine engine (http://192.168.55.1:8000 over USB)."
echo "  No tunnel is needed for the local path: Anchor binds the USB interface"
echo "  directly. ops/tunnel.sh is only for reaching it from elsewhere."
