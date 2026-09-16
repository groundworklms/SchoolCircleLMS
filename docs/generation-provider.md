# Generation provider (runtime configurable)

AI generation is the only course-authoring path, so which model answers is
operational configuration rather than a build artifact. An operator chooses it
in **Settings → Generation model** (`/prototype/instructor/settings`) and the
choice takes effect without a rollout.

Two shapes are supported, and the product's offline posture is the default:

| | Endpoint | API key | Setup needed |
|---|---|---|---|
| **Self-hosted (offline)** | any OpenAI-compatible `/v1` on your own network | none | nothing |
| **Hosted, key in Secret Manager** | e.g. `https://api.openai.com/v1` | `MODEL_API_KEY` or `OPENAI_API_KEY` | nothing |
| **Hosted, key typed in the panel** | any | entered in Settings | `SETTINGS_ENCRYPTION_KEY` |

The middle row is the recommended setup for a hosted provider: the credential
stays in Secret Manager where it already lives, and only the *model* is chosen
in the UI. `SETTINGS_ENCRYPTION_KEY` is then unnecessary — it exists only for
someone who wants to type a key into the panel instead.

`MODEL_API_KEY` is the variable the transport reads, and `OPENAI_API_KEY` is
accepted as a fallback name so a deployment already holding its credential
under that conventional name needs no second copy. In `apphosting.yaml`,
`secret:` names the Secret Manager entry and `variable:` names the environment
variable it lands in, so an existing `OPENAI_API_KEY` secret can feed
`MODEL_API_KEY` directly.

## Picking a model

Typing a model id from memory is guesswork, so the panel asks the endpoint what
it actually serves (`GET {baseUrl}/models`) and offers those for selection, then
**Test this model** sends a one-token completion to prove the credential and the
model id both work before anyone relies on them. Both calls are server-side with
the resolved credential, require the operator passphrase, and return neither the
key nor the endpoint's raw error body — an upstream 401 body can echo request
details, so only a status-derived summary comes back.

The token-limit parameter is not uniform: some servers accept only `max_tokens`
and newer hosted models accept only `max_completion_tokens`, rejecting the
other. Since the endpoint and model are operator-chosen, the transport sends
`max_tokens` and retries once with the other spelling if the endpoint rejects
specifically that parameter, rather than keeping a table of which host wants
which.

## Precedence

1. **Stored settings**, when enabled and complete, win.
2. **`MODEL_BASE_URL` + `MODEL_ID`** are the bootstrap — the fallback before an
   operator has chosen anything, and how a locked-down deployment ships
   pre-configured.
3. Neither ⇒ generation reports an explicit `503 NO_PROVIDER`. There is no mock
   and no silent cloud fallback.

Whichever won is reported as `source: 'settings' | 'env' | null` on the provider
status (`GET /api/generate`, `GET /api/learning/status`, and the Settings panel),
so "I changed it and nothing happened" is diagnosable rather than mysterious.

"Stop using these settings" disables the stored row and falls back to the
environment. It also drops the stored credential rather than parking a live key
in a disabled row.

## The two deployment secrets

Both are one-time. Once set, the endpoint, model id and API key change freely
from the UI.

- **`MODEL_SETTINGS_KEY`** — pins the operator passphrase from configuration.
  **Optional.** When unset, the first authenticated instructor sets one from the
  panel itself (`POST`, stored as a scrypt hash), so enabling the panel needs no
  secret and no rollout. Hashing rather than sealing is what makes that possible
  — it needs no encryption key. Claiming is refused once a passphrase exists by
  either route, so a leaked session cannot lock the real operator out, and a
  pinned value always wins. Set this if you would rather the passphrase not be
  settable from the UI at all.
- **`SETTINGS_ENCRYPTION_KEY`** — 32 bytes, base64 or hex
  (`openssl rand -base64 32`). Seals an API key *typed into the panel* with
  AES-256-GCM before it is written. **Optional**, and unnecessary when the key
  comes from Secret Manager. Unset means a typed API key is refused with an
  actionable message; it is never stored in the clear. Endpoints that need no
  key, and endpoints whose key comes from configuration, are unaffected.

Rotating `SETTINGS_ENCRYPTION_KEY` makes an existing stored key unreadable.
That degrades to an explicit "re-enter the key" reason on the provider status,
not to an unauthenticated request against a hosted API.

## Why a passphrase and not just the instructor role

This value decides **where approved POI and source text get sent**. Role alone
is not a sufficient gate, because every allowlisted instructor could then
redirect all generation to an endpoint of their choosing. The passphrase makes
choosing a destination an authorized operator action. It is the same
shared-secret pattern the feedback widget uses for `FEEDBACK_KEY`, except that
this one fails closed when unconfigured.

Private and loopback endpoints are deliberately **allowed** — the offline
posture *is* a self-hosted endpoint on the local network — so the passphrase is
what stands in for a URL allowlist. Credentials embedded in the endpoint URL,
query strings, and non-HTTP schemes are refused.

## Handling of the API key

- Sealed with AES-256-GCM before it reaches the database; the ciphertext,
  nonce, tag and a masked `****last4` hint are stored, never the plaintext.
- Never returned to a client. The Settings panel receives only `hasApiKey` and
  the hint, which is why "leave blank to keep" is the actual behaviour rather
  than a convenience.
- Kept out of the provider status object entirely. The transport resolves it
  through a separate seam (`textProviderCredential()`), so a secret has no path
  into any JSON response even if a new route serializes the status.
- Never logged. Decryption failure returns "no credential", which surfaces as
  an explicit 503.

## API

`/api/learning/model-settings`, instructor role required on all three.

| | | |
|---|---|---|
| `GET` | read the redacted configuration and what is active | no passphrase |
| `POST` | `{ passphrase }` — claim the operator passphrase when none is set | n/a |
| `PUT` | `{ baseUrl, modelId, apiKey?, expectedVersion? }` | passphrase |
| `DELETE` | stop using stored settings | passphrase |

`/api/learning/model-settings/models`, instructor role and passphrase on both:

| | | |
|---|---|---|
| `GET` | `?baseUrl=` — model ids the endpoint serves | passphrase |
| `POST` | `{ baseUrl?, modelId? }` — one-token connection test | passphrase |

These require the passphrase for the same reason a save does: they take an
operator-supplied URL and make the server call it with the deployment's
credential. Ungated, any instructor could point them at a host they control and
read the `Authorization` header off their own endpoint.

`apiKey` semantics on `PUT`: a non-empty string sets a new key, `null` clears
it, and **omitting the field keeps the existing one**. `expectedVersion` is the
version the caller last read; a mismatch is `409 CONFLICT`, so two operators
editing at once cannot silently overwrite each other. Omitting it is
last-write-wins, which is right for a first save or a script.

Error codes: `PASSPHRASE_NOT_SET` (409, none claimed yet — an actionable state,
which is why the panel offers to set one rather than greying itself out),
`PASSPHRASE_ALREADY_SET` / `PASSPHRASE_PINNED` (409, claim refused),
`BAD_OPERATOR_KEY` (403), `SECRET_STORAGE_UNAVAILABLE` (503, no encryption key
for a typed key), `BAD_REQUEST` (400, endpoint or model id rejected),
`MODEL_UNAVAILABLE` (502, the endpoint refused or could not be reached),
`CONFLICT` (409, stale `expectedVersion`).

## Storage

One `LearningRecord` row, `id = "system-model-settings"`,
`type = "SYSTEM_MODEL_SETTINGS"`, `status = ACTIVE | DISABLED`. `type` and
`status` are plain strings on that table, so **this needs no migration**.

The row is deployment-wide configuration, not per-user, so a single snapshot
cached for 10 seconds and shared by concurrent requests is correct here. It is
primed once per request by `primeModelSettings()` in `lib/learning/http.js`,
which keeps `textProvider()` synchronous for its many call sites. A write
invalidates the cache immediately; a database read failure keeps serving the
last known value and logs once, so an unreachable settings row cannot take down
generation the environment can already serve.
