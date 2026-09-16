# Generation provider (runtime configurable)

AI generation is the only course-authoring path, so which model answers is
operational configuration rather than a build artifact. An operator chooses it
in **Settings → Generation model** (`/prototype/instructor/settings`) and the
choice takes effect without a rollout.

Two shapes are supported, and the product's offline posture is the default:

| | Endpoint | API key | Setup needed |
|---|---|---|---|
| **Self-hosted (offline)** | any OpenAI-compatible `/v1` on your own network | none | `MODEL_SETTINGS_KEY` only |
| **Hosted API** | e.g. `https://openrouter.ai/api/v1` | required | `MODEL_SETTINGS_KEY` + `SETTINGS_ENCRYPTION_KEY` |

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

- **`MODEL_SETTINGS_KEY`** — shared operator passphrase, sent as the
  `x-model-settings-key` header. Required for every write. **Unset means the
  panel is read-only**: it fails closed rather than opening up.
- **`SETTINGS_ENCRYPTION_KEY`** — 32 bytes, base64 or hex
  (`openssl rand -base64 32`). Seals an operator-entered API key with
  AES-256-GCM before it is written. **Unset means an API key is refused**, with
  an actionable message; it is never stored in the clear. An endpoint that needs
  no key still saves.

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
| `PUT` | `{ baseUrl, modelId, apiKey?, expectedVersion? }` | passphrase |
| `DELETE` | stop using stored settings | passphrase |

`apiKey` semantics on `PUT`: a non-empty string sets a new key, `null` clears
it, and **omitting the field keeps the existing one**. `expectedVersion` is the
version the caller last read; a mismatch is `409 CONFLICT`, so two operators
editing at once cannot silently overwrite each other. Omitting it is
last-write-wins, which is right for a first save or a script.

Error codes: `SETTINGS_NOT_WRITABLE` (503, no passphrase configured),
`BAD_OPERATOR_KEY` (403), `SECRET_STORAGE_UNAVAILABLE` (503, no encryption
key), `BAD_REQUEST` (400, endpoint or model id rejected), `CONFLICT` (409).

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
