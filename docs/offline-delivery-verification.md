# Offline delivery verification kit

## Current conclusion

**Preparation only; no Orin or network-pulled delivery success is claimed.**
Authorized hardware access, the private access procedure, local model readiness,
and the installed public corpus have not been supplied or tested in this task.
Any connected cloud-model run is not offline evidence.
No cloud model or OpenRouter key is needed by this kit.

The portable runner uses only Node 20+ built-ins. Copy `scripts/offline/verify.mjs`
to the authorized operator workstation; no installation, database migration,
SSH operation, service restart, or app configuration change is performed.
Question requests may appear in the target's normal logs: use only approved
public or synthetic questions. The kit does not create or delete learning data.

## What is actually checked

| Path / capability | Meaning and limit |
|---|---|
| Direct target `/api/health`, `/api/ask` | HTTP reachability followed by actual cited/refused inference requests. Health alone is insufficient. |
| SchoolCircle `/api/doctrine` GET | `ready` is configuration, **not** reachable Anchor or working inference. |
| SchoolCircle `/api/doctrine` POST | Authenticated proxy transport, independently exercised. Requires the current Firebase ID token; this is not the learning-evidence session credential. |
| Local cited fallback | Reported unavailable/unverified. The current native doctrine route returns 502/503 on failure; the historical `/api/ask` FTS fallback is not present here. Do not route this check to `/api/learning` to compensate: that can invoke a configured cloud model. |
| Text, speech, images, video | Not invoked. Registry readiness is configuration (or a browser fallback), not measured availability. A separate local text model and local assets are prerequisites for any broader offline learning/authoring claim. |

The native adapter (`lib/doctrine.js`)
consumes raw Anchor `{text, abstained, abstain_reason, citations,
top_rerank_score, latency_s}` and expose `{answer, abstained, abstainReason,
citations, topScore, latencyMs}`. The older example in
`04-grounding-and-anchor.md` must not be mistaken for the raw wire shape.
The runner checks direct Anchor and the native proxy independently and fails visibly on shape drift.
Refusal is a successful HTTP 200 with a reason and no citations.
Cited success requires inline markers resolving to numbered publication/page
locators. **This checks structure, not truth or entailment.** An operator must
open each cited paragraph and confirm the answer is supported.

`transport` identifies the requested path, not the actual compute host.
Returned `source` labels (Anchor, FTS, cloud) are assertions, not provenance
proof. The current proxy does not forward such a label. Verify its upstream
privately and record a sanitized operator attestation. Unknown source is never
silently relabeled as Anchor. No report can set `offlineSuccess: true`.
The aggregate `cloudGeneration: not-established` deliberately makes no
no-cloud claim, including when individual responses assert a source.

## Operator prerequisites (external blockers until confirmed)

- Explicit owner authorization for the Orin, workstation, corpus and a short
  network interruption; a recovery path that does not depend on the pulled link.
- Device powered and physically connected; approved private SSH/tunnel access.
   Obtain the current procedure from the owner. Do not reuse archived access details.
- Anchor retrieval, generation, embedding, reranking and verification services
  inspected in **one authorized remote session**. Record only role and
  active/inactive state. HHEM can fail open: unavailable verification must be
  recorded as degraded even if cited answers pass.
- Publicly releasable corpus already installed; privately inspect its manifest,
  publication editions and paragraph/page availability. Record only an
  owner-approved public manifest/version identifier in shared evidence.
- Locally running SchoolCircle, local database, required assets and local
   inference dependencies. A cloud-hosted app cannot demonstrate complete
  disconnected delivery just because the Orin works offline.
- A valid signed-in test operator session before isolation. Token refresh or
  online auth dependencies may block the proxy offline; report that limitation,
   do not bypass auth. Supply the existing Firebase ID token using a secure
   environment/secret manager as `OFFLINE_FIREBASE_ID_TOKEN`. Never put its
   value in shell commands/history, fixtures, reports, screenshots or chat.
- Verify privately that the proxy's doctrine upstream is the intended local
  Anchor tunnel and that all inference services use installed local weights.
  The runner restricts targets to loopback/private IPs and rejects redirects,
  but this does **not** establish that those services avoid cloud inference.
  Block external egress independently for the network-pulled phase.
   Token-bearing proxy requests require HTTPS or a loopback HTTP tunnel;
   plaintext HTTP to a private LAN address is rejected before any requests.
   Use the normal TLS trust chain; never disable certificate verification.

## Running

Create a private JSON file **outside the repository** (all values below are
examples for local forwarding, not deployment settings):

```json
{
  "authorizedLocalOnly": true,
  "phase": "normal",
  "direct": "http://127.0.0.1:8000",
  "proxy": "http://127.0.0.1:3111",
  "supportedQuestion": "What does the approved public corpus say about friction?",
  "refusalQuestion": "What is the fictional password of the nonexistent purple observatory?"
}
```

Replace questions with two owner-approved cases: one known supported by the
installed public corpus, one unambiguously unsupported. Keep them identical
across phases. `authorizedLocalOnly` is an operator attestation, not a network
measurement. Omit a target to record a missing-target blocker. URLs may include
an app base path. Hostnames other than localhost and public URLs are rejected;
use an authorized local tunnel, never weaken the check to reach production.

```sh
node scripts/offline/verify.mjs /private/preflight.json > /private/normal.json
```

Without `OFFLINE_FIREBASE_ID_TOKEN`, direct probes still run and proxy inference
is recorded as authentication-required. Only this explicit credential environment
variable is read; no dotenv files are loaded. Report output excludes targets, questions, answers,
citations, tokens and raw error messages. Review even sanitized reports before
sharing under [the data-handling rules](gameday/DATA-HANDLING.md).

Exit codes: `0` means both required transports returned structurally cited
success and refusal; `2` means a missing capability or failed behavioral check;
`1` means invalid input or a runner failure. Expected tunnel-loss failures still
exit `2`. A `0` is never an offline certification. Requests are sequential,
35 seconds maximum each and 256 KiB maximum per response (six requests at most).

## Single-session evidence checklist

Do not disconnect anything from this script. The authorized operator controls
each interruption, records its UTC time, and keeps one remote ops session open.

1. **Normal:** inspect service roles, corpus and local-model provenance privately.
   Run with `phase: normal`. Confirm both cited answers against the actual
   paragraphs, and confirm the refusal is appropriate. Record whether proxy
   responses are reachable independently of direct Anchor.
2. **Network pulled:** disconnect WAN/uplink or apply the owner's approved egress
   isolation to workstation **and** Orin, retaining the local device link and
   tunnel. Confirm no alternate Wi-Fi/cellular/VPN route remains. Record the
   isolation method and a sanitized independent egress check, not IPs or network
   diagrams. Run a new invocation with `phase: network-pulled`. Observe local
   inference activity for these requests; do not substitute a previous/cached
   result. A visible cloud response or unverifiable local compute blocks the claim.
   Exercise the approved learning content in the local browser separately;
   this kit does not establish that the full learner journey survives isolation.
3. **Tunnel loss:** while WAN remains isolated, stop only the operator-owned
   tunnel. Run with `phase: tunnel-loss`. Direct forwarding should be unreachable
   and the proxy should fail explicitly (normally 502; 503 if unconfigured).
   No source should silently switch to cloud. FTS is not expected from the
   current doctrine route. If available on another reviewed build, separately
   record its actual path, response contract and valid local citations.
4. **Recovery:** reopen the same authorized tunnel without changing endpoints,
   models, keys or service configuration. Keep WAN isolated. Run with
   `phase: recovered`; both cited success and refusal must return again.
   Only after evidence collection restore the original network state.
5. **Review:** save the four sanitized JSON reports, reviewed UTC event sequence,
   public software/corpus version identifiers, per-role service availability,
   local-weight/compute and egress-isolation attestations, citation support
   pass/fail per phase, browser observation summary, and all blockers. Never
   include learner data, controlled publications, raw terminal dumps, URLs,
   tunnel addresses or tokens. Label model/FTS/browser checks not run as such.

Accept a **narrow direct-Anchor network-pulled claim** only after supported and
refusal checks pass during independently confirmed isolation, local compute and
corpus provenance are attested, and citations are reviewed. A proxy delivery
claim additionally requires proxy checks and its dependency/auth evidence.
Full SchoolCircle offline delivery requires the separately verified browser
journey and all its local dependencies. Do not generalize one claim into another.

## Deterministic verification (no hardware / cloud)

```sh
npm install
npm run build
npm test
npm run test:doctrine-auth
node --test scripts/offline/verify.test.mjs
```

Run these commands in a native upstream checkout. `npm run dev` and
`npm start` serve on port 3111; the latter requires a successful build.
Installation generates the Prisma client, but these commands do not run
migrations or seeds. Missing required configuration is a blocker, not a pass.

The harness tests use synthetic loopback HTTP fixtures and the native doctrine
adapter. The proxy fixture is a controlled HTTP seam, not a Firebase login
or a running Next route. The separate upstream doctrine-auth tests cover the
route's authentication boundary with mocks, not real provider connectivity.
The harness covers source labels, cited success/refusal, malformed responses,
unavailability, recovery, endpoint restrictions and sanitized output.
Fixture success proves kit behavior, **not** live connectivity, real Firebase
offline authentication, or Orin readiness. Live connectivity requires authorized
operator runs; hardware proof additionally requires the independent network-pulled
evidence above. All of those remain unverified until actually performed. No app workflow
restart is needed because this kit changes no running application code.