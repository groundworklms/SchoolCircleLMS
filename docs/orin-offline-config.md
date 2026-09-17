# Orin offline config — grounding from any laptop

How to get grounded answers — and on-device generation — from **Anchor on the Orin**, on whichever
laptop the board is plugged into, with no SSH key, no tunnel and no network.

**Scope.** This document is about making *Anchor* offline, which is done and verified (both levels
below are applied). It is **not** a claim that SchoolCircle runs offline: the app's own sign-in
still goes to Firebase Auth over the internet. Anchor offline is the provable result; keep the two
separate when describing this to anyone.

## Why this works

Anchor used to bind the Orin's loopback (`127.0.0.1:8000`), so a laptop could only reach it through
an SSH tunnel. It now binds the **USB device-mode interface** (`l4tbr0 = 192.168.55.1`) instead.

> **Where the bind actually comes from.** Not the YAML. `server.host` in
> `/opt/tutor/config/default.yaml` is decorative — `main.py` never reads it. The real control is the
> `--host` CLI flag (`main.py`: `ap.add_argument("--host", default="127.0.0.1")`, consumed by
> `uvicorn.run(app, host=args.host, ...)`). The systemd unit did not pass it, so it defaulted to
> loopback. **Already applied** via a drop-in — note the directory must be `<unit>.service.d`, not
> `<unit>.d`, or systemd silently ignores it:
>
> ```
> /etc/systemd/system/tutor-api.service.d/bind-usb.conf
> [Service]
> ExecStart=
> ExecStart=/usr/bin/python3 /opt/tutor/api/main.py --db ... --items ... --host 192.168.55.1
> ```
>
> Revert: `sudo rm -rf /etc/systemd/system/tutor-api.service.d && sudo systemctl daemon-reload &&
> sudo systemctl restart tutor-api`

That is **not** `0.0.0.0`. The USB link is point-to-point to the single attached laptop — it is not
reachable from any real network, so the air-gap holds. It just removes the tunnel from the path.

```
laptop  ──USB device-mode──  Orin
  app ─────────────────────► http://192.168.55.1:8000   (Anchor: /api/ask, /api/health, /api/corpus)
```

## Level 1 — grounding offline (the demo path)

**Already applied and verified** (16 Sep 2026): the drop-in above is in place and Anchor listens on
`192.168.55.1:8000`. Confirmed from a laptop with the SSH tunnel killed — health ok, 14 publications
/ 4,731 chunks, a cited answer from TC 3-22.9, and a correct refusal on an out-of-corpus question.
Nothing below needs running again unless the Orin is reimaged.

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

**Point the app at it** — set the doctrine endpoint to `http://192.168.55.1:8000`, either as
`DOCTRINE_BASE_URL` in `.env.local` or in **Settings → Doctrine engine**, which has shipped: it
takes an address at runtime, stores it, and the stored value wins over the environment variable.
Its **Find the Orin** button sweeps this address for you — but the sweep runs on the *server*, so it
only finds the board when SchoolCircle is running on this same laptop. A hosted deployment cannot
route to a USB address and has to be given a tunnel instead (see `apphosting.yaml`).

Pull the network cable at this point and **Anchor** still answers — health, corpus, citations and
refusals, all from the board. That is the demo, and it is worth being precise about its edge:
SchoolCircle's own sign-in still needs Firebase Auth, so "Anchor is offline" is the claim, not
"SchoolCircle is offline". See the note under Level 2.

## Moving the Orin to a different laptop

Unplug, plug into the other laptop, done — the bind travels with the device. The new laptop needs
only the app and `DOCTRINE_BASE_URL=http://192.168.55.1:8000`. No key, no tunnel, no re-config.

> The SSH key is still required for *administration* (restarting services, ingest), not for use.

## Level 2 — generation offline too — **APPLIED AND VERIFIED 16 Sep 2026**

Level 1 gives grounded answers. Level 2 also exposes the Orin's on-device generator so the **app**
can generate course drafts/rubrics from it. **This is no longer optional or pending — it is applied
on the board now.** What follows is the record of what was done and how it was checked; do not run
it again unless the Orin is reimaged.

### What is in place

| Thing | Value | Verified |
|---|---|---|
| llama-server address | `http://192.168.55.1:8080/v1` | `/v1/models` answers |
| Served model id | `/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf` | read from `/v1/models` |
| Anchor | `http://192.168.55.1:8000` | `/api/health` ok, all three models loaded |
| Corpus | **4,731 chunks across 14 publications** | `/api/corpus` |
| `tutor-gen`, `tutor-api` | both `active` | `systemctl` |
| Anchor's own generation | still works after the rebind | cited answer returned in 8.5 s |

The drop-in applied was `/etc/systemd/system/tutor-gen.service.d/bind-usb.conf`, rebinding
ExecStart from `--host 127.0.0.1` to `--host 192.168.55.1`, plus `model.base_url` in
`/opt/tutor/config/default.yaml` repointed to `http://192.168.55.1:8080/v1`, then `daemon-reload`
and `systemctl restart tutor-gen tutor-api`.

**A backup of the pre-change config exists at `/opt/tutor/config/default.yaml.bak-prelevel2`.**

Measured on the corpus, from a laptop with **no tunnel**: the 14 publications are MCDP 1, 1-0, 1-1,
1-2, 1-3, 2, 3, 5, 6, 7, MCWP 3-11.3, MCWP 5-10, TC 3-22.9, TCCC. `/api/ground` returns 200 and
honours contract `schoolcircle-grounding-v1`. `/api/ask` returned a cited answer with
paragraph-level locators, and correctly refused an out-of-corpus question with `abstained: true`,
`abstain_reason: low_retrieval_score`.

> Note for anyone reconciling numbers: `/api/corpus` reports `total_chunks: 4731` and lists 14
> entries in `documents`, but its `index_meta.corpus_documents` field says `13`. The `documents`
> array is the authoritative list; the `index_meta` counter is stale build metadata. Quote 14.

### What was applied (for reference / after a reimage)

These two changes are **coupled** — apply both together or Anchor loses its own generator:

```bash
# 1. bind llama-server to the USB interface
sudo mkdir -p /etc/systemd/system/tutor-gen.service.d
sudo tee /etc/systemd/system/tutor-gen.service.d/bind-usb.conf >/dev/null <<'EOF'
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

Then the app can use `MODEL_BASE_URL=http://192.168.55.1:8080/v1` with the served model id, at $0
per call, for **a locally running SchoolCircle on the laptop the board is plugged into**.

**What this does and does not buy — read before repeating it to anyone.** What is proven is that
**Anchor runs fully offline**: grounding, retrieval, refusal and on-device generation all answer
from the board with the network cable out. That is a real, demonstrable result and it is the demo.

It does **not** make *SchoolCircle* offline-capable, and the two must not be conflated.
SchoolCircle's own loop still signs in through Firebase Authentication, which is a Google endpoint
on the internet; an auth path that works without Google is being built separately and is not done.
So with the network pulled, Anchor keeps answering but SchoolCircle cannot get a user logged in.
Claim the first, never the second. This is also why none of these addresses belongs in a hosted
deployment's config: a cloud-hosted browser session cannot be made offline by pointing a
server-side fallback at a USB address it cannot route to.

**Leave `tutor-embed` (8081), `tutor-rerank` (8082) and `tutor-verify` (8083) on loopback.** Anchor
calls them locally on the Orin; exposing them buys nothing and widens the surface.

### Optional: student-chat local model

Student chat keeps its hosted GPT 6 Astra selection as primary. For a locally
running SchoolCircle installation, its bounded offline retry is configured
separately from generation:

```bash
STUDENT_LOCAL_BASE_URL=http://192.168.55.1:8080/v1
STUDENT_LOCAL_MODEL_ID=/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf
# STUDENT_LOCAL_API_KEY=<only if llama-server was configured to require one>
```

**The model id is known — it is the literal string
`/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf`.** That is verbatim what
`http://192.168.55.1:8080/v1/models` returns as `data[0].id` (confirmed 16 Sep
2026); llama-server names the model by the full path it was loaded from. An
earlier revision of this file warned against inferring the id from the
`gemma-4-E2B_q4_0-it.gguf` filename. That warning was right for the wrong
reason and is now superseded: the filename alone is indeed **not** the id — the
id is the whole absolute path, leading slash and `.gguf` extension included.
Re-read `/v1/models` after any reimage or model swap rather than trusting this
line.

> ### Git Bash trap — `STUDENT_LOCAL_MODEL_UNAVAILABLE`
>
> On Windows, setting this in **Git Bash** silently corrupts it. MSYS path
> conversion sees a value starting with `/` and rewrites it to a Windows path:
>
> ```
> $ STUDENT_LOCAL_MODEL_ID=/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf
> $ echo $STUDENT_LOCAL_MODEL_ID
> C:/Program Files/Git/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf
> ```
>
> The mangled value then fails the adapter's exact-match check against the
> catalogue and the model is reported as `STUDENT_LOCAL_MODEL_UNAVAILABLE` —
> which looks like an unreachable board, not a quoting bug. The fix:
>
> ```bash
> MSYS_NO_PATHCONV=1 STUDENT_LOCAL_MODEL_ID=/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf
> ```
>
> Or export it from a `.env.local` file / PowerShell / WSL, none of which rewrite
> the path. Always `echo` the variable back before blaming the Orin.

The student adapter permits only private/localhost HTTP(S) URLs with no URL
credentials, query, or fragment, and never reuses `OPENAI_API_KEY` for this
endpoint. It retries only an unreachable/timed-out hosted transport, once, by
rerunning the full scoped Anchor → strict Sourcerer → Understudy pipeline
local-only. The whole turn is bounded to 110 seconds (30 seconds hosted, then
75 seconds local); local catalog and model calls are bounded to 5 and 15
seconds. Refusals, auth/rate-limit responses, malformed output, and missing
models do not trigger it.

Do not set these Orin addresses in Replit or expect this server fallback to
make a cloud-hosted browser session offline. The SchoolCircle app/auth/data
services and scoped Anchor `/api/ground` must themselves be locally reachable
to the browser and server for an air-gapped student turn.

## Revert

Both levels are currently APPLIED, so both blocks below are live instructions, not hypotheticals.
Level 2 has one extra step Level 1 does not: the generator drop-in is **coupled** to Anchor's
`model.base_url`, so removing the drop-in without restoring the config leaves Anchor pointing at an
address nothing listens on and its generation fails. Restore both, in this order.

```bash
# --- Level 2 first (it is the coupled one). Restore the config from the backup
#     taken before the change, then drop the generator's bind override.
sudo cp /opt/tutor/config/default.yaml.bak-prelevel2 /opt/tutor/config/default.yaml
sudo rm -rf /etc/systemd/system/tutor-gen.service.d
sudo systemctl daemon-reload && sudo systemctl restart tutor-gen tutor-api
# Check: curl http://127.0.0.1:8080/v1/models   (from the Orin; 192.168.55.1:8080 should now refuse)
#        then ask Anchor a question and confirm it still answers with citations.

# --- Level 1 (the bind comes from the drop-in, NOT the YAML):
sudo rm -rf /etc/systemd/system/tutor-api.service.d
sudo systemctl daemon-reload && sudo systemctl restart tutor-api
```

If the backup is missing, the change to restore by hand is
`model.base_url: http://192.168.55.1:8080/v1` → `http://127.0.0.1:8080/v1`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `192.168.55.1` won't ping | cable not in the device-mode port, or the board is still booting | reseat the USB cable; wait for the link |
| ping works, `:8000` refused | `tutor-api` not restarted since the bind change | run the Level 1 activate command |
| tutor answers but `source = fts` | Anchor fell back to lexical search | check `tutor-embed`/`tutor-rerank` are active |
| everything refuses | the corpus is not what you think | `curl http://192.168.55.1:8000/api/corpus` — expect 4,731 chunks / 14 publications |
| `:8080` refused but `:8000` fine | the Level 2 generator drop-in was removed or `tutor-gen` is down | `systemctl status tutor-gen`; re-apply the Level 2 drop-in |
| `STUDENT_LOCAL_MODEL_UNAVAILABLE` | the model id does not exact-match, usually Git Bash path mangling | `echo $STUDENT_LOCAL_MODEL_ID`; use `MSYS_NO_PATHCONV=1` (see the trap above) |
| Anchor reachable but its own generation fails | `model.base_url` and the `tutor-gen` bind disagree — the two Level 2 changes are coupled | make both point at the same address, then `systemctl restart tutor-gen tutor-api` |
| hosted site says `Not answering · <some tunnel>` | the tunnel is dead; quick tunnels rename on every restart | paste the current hostname into Settings → Doctrine engine (no redeploy needed) |
