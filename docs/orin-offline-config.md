# Orin offline config — grounding from any laptop

How to get a grounded, fully offline tutor on **whichever laptop the Orin is plugged into**, with
no SSH key, no tunnel, and no network.

## Why this works

Anchor used to bind the Orin's loopback (`127.0.0.1:8000`), so a laptop could only reach it through
an SSH tunnel. It now binds the **USB device-mode interface** (`l4tbr0 = 192.168.55.1`) instead.

That is **not** `0.0.0.0`. The USB link is point-to-point to the single attached laptop — it is not
reachable from any real network, so the air-gap holds. It just removes the tunnel from the path.

```
laptop  ──USB device-mode──  Orin
  app ─────────────────────► http://192.168.55.1:8000   (Anchor: /api/ask, /api/health, /api/corpus)
```

## Level 1 — grounding offline (the demo path)

**Activate once** (needs the team sudo password; run from a laptop that has `~/.ssh/gameday_orin`):

```bash
ssh -t -i ~/.ssh/gameday_orin vanguard@192.168.55.1 'sudo systemctl restart tutor-api'
```

**Verify from any plugged-in laptop** — nothing else running, no tunnel:

```bash
curl http://192.168.55.1:8000/api/health     # {"ok":true, models: {...}}
curl http://192.168.55.1:8000/api/corpus     # the indexed publications
curl -X POST http://192.168.55.1:8000/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"What is trigger control?"}'          # expect citations, abstained:false
curl -X POST http://192.168.55.1:8000/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"maximum range of a Javelin"}'        # expect abstained:true
```

**Point the app at it** — set the doctrine endpoint to `http://192.168.55.1:8000`
(`DOCTRINE_BASE_URL` in `.env.local`, or the Orin option in Settings once that ships).

Pull the network cable at this point and everything above still answers. That is the demo.

## Moving the Orin to a different laptop

Unplug, plug into the other laptop, done — the bind travels with the device. The new laptop needs
only the app and `DOCTRINE_BASE_URL=http://192.168.55.1:8000`. No key, no tunnel, no re-config.

> The SSH key is still required for *administration* (restarting services, ingest), not for use.

## Level 2 — generation offline too (optional)

Level 1 gives grounded answers. If the **app** should also generate course drafts/rubrics from the
Orin's on-device model, `tutor-gen` must be reachable as well. These two changes are **coupled** —
apply both together or Anchor loses its own generator:

```bash
# 1. bind llama-server to the USB interface
sudo mkdir -p /etc/systemd/system/tutor-gen.d
sudo tee /etc/systemd/system/tutor-gen.d/bind-usb.conf >/dev/null <<'EOF'
[Service]
ExecStart=
ExecStart=/opt/tutor/llama.cpp/build/bin/llama-server -m /opt/tutor/models/gemma-4-E2B_q4_0-it.gguf \
  -ngl 999 --host 192.168.55.1 --port 8080 -c 4096 -b 1024 -ub 512 --parallel 1 \
  --reasoning off --reasoning-budget 0
EOF

# 2. point Anchor at the new address (config is vanguard-owned, no sudo needed to edit)
#    /opt/tutor/config/default.yaml  ->  model.base_url: http://192.168.55.1:8080/v1

# 3. restart both, in this order
sudo systemctl daemon-reload
sudo systemctl restart tutor-gen tutor-api
```

Then the app can use `MODEL_BASE_URL=http://192.168.55.1:8080/v1` with the served model id — the
whole loop (generate → ground → deliver) runs on the board with the network pulled and $0 per call.

**Leave `tutor-embed` (8081), `tutor-rerank` (8082) and `tutor-verify` (8083) on loopback.** Anchor
calls them locally on the Orin; exposing them buys nothing and widens the surface.

## Revert

```bash
cp /opt/tutor/config/default.yaml.bak_prebind /opt/tutor/config/default.yaml   # restores 127.0.0.1
sudo systemctl restart tutor-api
# Level 2: sudo rm -rf /etc/systemd/system/tutor-gen.d && sudo systemctl daemon-reload \
#          && sudo systemctl restart tutor-gen
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `192.168.55.1` won't ping | cable not in the device-mode port, or the board is still booting | reseat the USB cable; wait for the link |
| ping works, `:8000` refused | `tutor-api` not restarted since the bind change | run the Level 1 activate command |
| tutor answers but `source = fts` | Anchor fell back to lexical search | check `tutor-embed`/`tutor-rerank` are active |
| everything refuses | the corpus is not what you think | `curl http://192.168.55.1:8000/api/corpus` |
