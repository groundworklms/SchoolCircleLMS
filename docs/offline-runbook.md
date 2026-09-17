# Offline runbook — SchoolCircle on a laptop, grounded by the Orin, cable pulled

Bring SchoolCircle up **fully offline on this laptop** against the Jetson Orin running Anchor,
so that when the network cable is pulled the tutor still answers with citations and an operator
can still sign in. This is the presenter's checklist: commands, in order.

- **App runs on the laptop** (Next.js 15 / React 19). The board has ~354 MB free RAM and no Node,
  so it cannot run the app — only doctrine calls go to the board.
- **Doctrine runs on the Orin** at `http://192.168.55.1:8000` over the USB device-mode link.
- **The database runs on the laptop** (local Postgres in Docker). See the recommendation below.
- Related docs: [orin-offline-config.md](orin-offline-config.md) (the board bind),
  [offline-operator-auth.md](offline-operator-auth.md) (the auth seam),
  [offline-delivery-verification.md](offline-delivery-verification.md) (the evidence kit and its limits).

---

## Database decision: use (a) local Postgres via `docker-compose.yml`

**Recommendation: option (a) — the repo's existing `docker-compose.yml` (Postgres 16 on
`127.0.0.1:5432`).** Justification:

- **No schema change, no risk to main.** `prisma/schema.prisma` keeps `provider = "postgresql"`.
  The offline run only changes `DATABASE_URL` to point at the local container — exactly what the
  schema comment intends ("keep this provider/schema and change `DATABASE_URL`"). Nothing this
  runbook does can reach `migrate.yml` or the live Cloud SQL database.
- **The RAM cost lands where there is headroom.** Postgres 16-alpine is ~1 GB on the *laptop*, not
  the 354 MB board. Option (b) — a separate offline Prisma schema on a different provider (e.g.
  SQLite) — would save that ~1 GB but is *worse* here: Prisma generates one client from one schema,
  so an offline SQLite schema means regenerating the client against a different provider, which can
  silently bleed into the postgres path if anyone forgets to regenerate, and it forks the data model
  the app is tested against. Not worth it to save 1 GB on a laptop.
- **It satisfies "pull the cable."** The container is local; it has no network dependency. Once
  `docker compose up -d` has run and migrations are applied, the database is fully offline.

Trade-off accepted: **Docker must be running on the laptop.** If Docker is unavailable on the demo
machine, the fallback is a native local Postgres 16 listening on `127.0.0.1:5432` with the same
credentials — still option (a), same provider, same `DATABASE_URL`. Do **not** switch providers.

---

## One-time prep (do this BEFORE the demo, while you still have slack)

### 0. You are on the right branch/worktree

```sh
cd C:\projects\offline-stack        # branch fix/offline-stack; node_modules is linked
```

Dependencies are already installed (the linked `node_modules`). **Do not run `npm install`.**

### 1. Create your offline env file

```sh
cp .env.offline.example .env.offline
```

Fill the two placeholders in `.env.offline`:

```sh
# a >=32-char signing secret (paste the output into OFFLINE_AUTH_SECRET)
openssl rand -base64 48
```

Then mint at least one operator (next step) and paste the JSON array into `OFFLINE_AUTH_OPERATORS`.
Everything else in the template already has working values (`DOCTRINE_BASE_URL`,
`DATABASE_URL`, `AUTH_MODE`, the DB confirm vars).

### 2. Mint an operator passphrase

The passphrase is read from **stdin only** (never argv/env). Pick a subject, role, and display name:

```sh
printf '%s' 'correct horse battery staple' \
  | node scripts/offline/operator-passphrase.mjs sgt-okafor INSTRUCTOR 'SSgt Okafor'
```

This prints one JSON object (scrypt salt+hash — no plaintext). Collect one object per operator into
a JSON **array** and set it as `OFFLINE_AUTH_OPERATORS` in `.env.offline`, e.g.:

```
OFFLINE_AUTH_OPERATORS='[{"subject":"sgt-okafor","name":"SSgt Okafor","role":"INSTRUCTOR","passphrase":{"alg":"scrypt","salt":"...","hash":"...","N":16384,"r":8,"p":1,"keylen":32}}]'
```

`role` seeds a brand-new `User` row only; it can never promote an account that already exists.

### 3. Start the local database

```sh
docker compose up -d                 # Postgres 16 on 127.0.0.1:5432, from docker-compose.yml
```

Apply the schema (the guardrails read `SCHOOLCIRCLE_DB_ENV` and `DATABASE_TARGET_CONFIRM`, both set
in `.env.offline`). Export the env for this shell so the db script sees it:

```sh
set -a; . ./.env.offline; set +a          # bash/git-bash: load .env.offline into the shell
npm run db:deploy                          # applies prisma/migrations to the local DB
# optional demo content (only if ALLOW_DEMO_SEED=true in .env.offline):
#   npm run db:seed
```

> PowerShell equivalent for loading the env file: use `scripts/offline/start-offline.mjs` (it loads
> the file itself), or set the four db vars manually before `npm run db:deploy`.

### 4. (Human step) Decide dev vs. production build

- **`next dev` (recommended for the demo, no build):** the start script's default. Compiles routes
  on demand; no `next build`, so it never OOMs. Slightly slower first paint per route.
- **`next start` (smoother, but needs a build first):** run `npm run build` **yourself** on a moment
  with RAM headroom — it OOMs around 3 GB free, so this runbook and the start script never run it for
  you. Build with the offline env loaded (so `NEXT_PUBLIC_AUTH_MODE=offline` is inlined), then launch
  with `--start`.

---

## Launch (demo time)

```sh
node scripts/offline/start-offline.mjs               # loads .env.offline, preflights, runs `next dev`
# or, if you pre-built:
node scripts/offline/start-offline.mjs --start       # runs `next start` (requires an existing .next/)
```

The script (safe, never builds):
1. loads `.env.offline` into the child process,
2. validates `AUTH_MODE=offline`, a ≥32-char secret, a non-empty roster, `DOCTRINE_BASE_URL`,
   `DATABASE_URL`, `NEXT_PUBLIC_AUTH_MODE=offline` — **without printing any secret**,
3. preflights the Orin (`/api/health`) and the local Postgres port, failing with a fix if either is
   down (pass `--skip-checks` to launch anyway),
4. spawns `npm run dev` (or `npm start` with `--start`).

App: **http://localhost:3111**. In the app, confirm the doctrine engine points at the board —
either `DOCTRINE_BASE_URL` (already set) or **Settings → App → Doctrine engine →
`http://192.168.55.1:8000`** (a stored setting wins over the env var).

---

## Verify offline (the actual demo)

1. **With the network still up**, sign in as the operator (offline sign-in form; subject +
   passphrase) and ask the tutor a supported question, e.g. *"What is trigger control?"* — expect an
   answer with a **citation** (TC 3-22.9). Ask an out-of-corpus question, e.g. *"maximum range of a
   Javelin"* — expect a **refusal** ("I can't answer that from the doctrine I have on this device"),
   not a guess.
2. **Pull the network cable / disable Wi-Fi.** Keep the USB link to the Orin.
3. Sign out and **sign in again as the operator** — it still works (the session is signed and
   verified entirely on the laptop; no Google identity call).
4. Ask the tutor the supported question again — it still answers **with the same citation**. Ask the
   out-of-corpus question — it still refuses. That is the demo.

Quick raw check of the board without the app (read-only), any time:

```sh
curl http://192.168.55.1:8000/api/health          # {"ok":true, models:{generator,embeddings,reranker:true}}
curl http://192.168.55.1:8000/api/corpus           # 14 pubs / 4731 chunks
curl -X POST http://192.168.55.1:8000/api/ask -H 'content-type: application/json' \
  -d '{"question":"What is trigger control?"}'      # citations, abstained:false
```

---

## Findings

### The `/api/ask` contract (observed live from the Orin, 2026-09-17)

`lib/doctrine.js` `askDoctrine()` POSTs to **`<DOCTRINE_BASE_URL>/api/ask`** with
`Content-Type: application/json` and body `{"question": "<text>"}` — that is the *entire* request
(no auth, no other fields). Response is a 200 JSON object; the fields the app reads (and maps to
`{answer, abstained, abstainReason, citations, retrieved, topScore, latencyMs}`):

**Supported answer** (`abstained: false`):
```json
{
  "question": "What is trigger control?",
  "retrieved": 8,
  "top_rerank_score": 7.97,
  "abstained": false,
  "abstain_reason": null,
  "text": "Trigger control is the act of firing the weapon ... [1] ... [2] ... [4].",
  "citations": [
    {"n":1,"citation":"TC 3-22.9, (May 2016 (Change 3)), Ch 8, \"Trigger Control\", para 2, p.8-2","pub_id":"TC 3-22.9","page_printed":"8-2"}
  ],
  "sources": [ { "n":1, "citation":"...", "rerank_score":7.97 } ],
  "grounding": { "sentences":[ {"sentence":"...","support":0.95,"cited_sources":[1],"has_citation":true} ], "min_support":0.84, "unsupported":0 }
}
```

**Refusal** (`abstained: true`) — a **success** (HTTP 200), not an error:
```json
{ "question":"maximum range of a Javelin", "retrieved":8, "top_rerank_score":-3.1,
  "abstained":true, "abstain_reason":"low_retrieval_score", "citations":[],
  "text":"I can't answer that from the doctrine I have on this device...", "latency_s":1.33 }
```

The adapter surfaces `abstain_reason` on purpose — "not in the corpus" is a curriculum finding. It
maps `latency_s` → `latencyMs` and reads `citations` as-is (each carries `pub_id`, `page_printed`,
and a human `citation` string with publication/chapter/section/paragraph/printed-page). A 200 that is
not JSON, or a non-200, becomes a typed error (`DOCTRINE_BAD_RESPONSE` / `DOCTRINE_ERROR`) — the app
never silently falls back to an ungrounded model.

There is a **second, separate** board endpoint, `POST /api/ground` (`lib/student-grounding.js`), for
source-scoped student grounding — it exists on the board and returns
`{"contract":"schoolcircle-grounding-v1","abstained":...,"passages":[...]}`. The tutor demo above uses
`/api/ask`; the student-grounding journey is a separate path with its own prerequisites (see
`offline-delivery-verification.md`).

### The RAM reality (confirmed over SSH, 2026-09-17)

- **Board:** `free -m` → total 7619 MB, **available ~354 MB**. All five services up:
  `tutor-api`, `tutor-embed`, `tutor-gen` (gemma-4-E2B QAT Q4_0), `tutor-rerank`, `tutor-verify`.
  The bind drop-in is in place: `tutor-api` ExecStart carries `--host 192.168.55.1`, so Anchor
  listens on the USB interface (not loopback) — no tunnel needed. Confirmed reachable from this
  laptop; `/api/health` → ok, `/api/corpus` → 14 pubs / 4731 chunks.
- **Laptop:** carries the Next app + Docker Postgres (~1 GB). `next build` OOMs near ~3 GB free —
  left as a deliberate human step; `next dev` avoids it.

### Gaps between what the app needs at boot and what the offline path provides

- **Database is a hard prerequisite, and it is empty until you migrate.** Prisma connects lazily, so
  the process boots without a DB, but any page that queries (sign-in maps to a `User` row, the
  learner/instructor surfaces) needs Postgres up **and migrated** (`docker compose up -d` +
  `npm run db:deploy`). This is the one piece the start script checks but cannot do for you safely.
- **Firebase Auth is NOT required offline.** With `NEXT_PUBLIC_FIREBASE_*` unset, hosted login is
  disabled and the app stays open; the offline operator credential is the sign-in path. No cloud
  identity service is contacted. Leave the Firebase vars unset for the pulled-cable run.
- **No other cloud service is hard-required at boot.** Generation (`MODEL_*`), hosted student chat
  (`STUDENT_MODEL_ID`/`OPENAI_*`), and OpenRouter are all optional and degrade to 503/"unavailable"
  when unset — they do not block boot, sign-in, or the grounded tutor. On-device generation is the
  optional Level 2 in `orin-offline-config.md` (bind `tutor-gen` to the USB iface) and is **not**
  needed for the tutor-answers-with-a-citation demo.

### Complete list of env vars the offline run needs

Required: `DATABASE_URL`, `SCHOOLCIRCLE_DB_ENV`, `DATABASE_TARGET_CONFIRM` (migrations),
`DOCTRINE_BASE_URL`, `AUTH_MODE=offline`, `OFFLINE_AUTH_SECRET` (≥32 chars),
`OFFLINE_AUTH_OPERATORS` (non-empty roster), `NEXT_PUBLIC_AUTH_MODE=offline`.
Optional: `OFFLINE_AUTH_REALM` (default `local`), `OFFLINE_AUTH_SESSION_HOURS` (default 12),
`DOCTRINE_TIMEOUT_MS`, `ALLOW_DEMO_SEED`. Leave unset offline: all `NEXT_PUBLIC_FIREBASE_*`,
`MODEL_*`, `OPENAI_*`, `OPENROUTER_*`, `STUDENT_*`. Full template: `.env.offline.example`.

### What a human still must do by hand (cannot be scripted safely here)

1. **Fill secrets** in `.env.offline` (`OFFLINE_AUTH_SECRET`, `OFFLINE_AUTH_OPERATORS`).
2. **Start Docker + migrate the DB** (`docker compose up -d`; `npm run db:deploy`). Optionally seed.
3. **`next build`** if you want `next start` smoothness — OOMs on the constrained box, so it is a
   deliberate human step on a machine with RAM headroom, built with the offline env loaded.
4. **Board administration** (restart/ingest) still needs the SSH key; the *use* path needs none.

### What could NOT be verified in this prep task

- **The full app has not been booted offline here** — no `next build`/`next start`/`next dev` was run
  (RAM + non-destructive constraint), and `npm install` was not run. The start script's parse,
  validation, and preflight (Orin health + DB port) were exercised and pass; the actual Next launch
  and the browser sign-in/tutor flow were **not** exercised end-to-end.
- **The offline auth seam has never run against a real database on this path** — it is verified by
  unit tests and a build only (see `offline-operator-auth.md`). The `User` upsert on offline sign-in
  is unproven against live Postgres.
- **No pulled-cable delivery is claimed.** The `/api/ask` contract, board RAM, service state, and
  bind were verified live; the end-to-end "cable out, tutor still answers *in the app*" was not run
  here and must be confirmed by the presenter per the steps above.
- **`/api/ground` (student grounding) was reachable** but returned an abstain for a quick probe
  (source id not matched); the student-grounding journey was not validated and is out of scope for
  the tutor demo.
