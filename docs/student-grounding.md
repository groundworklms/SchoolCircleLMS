# Grounded student chat

Student turns use the following required stages:

1. Authenticate the caller and resolve the persisted course's approved sources
   server-side. Client-supplied source lists and history are not authority.
2. Anchor selects evidence only from supplied authorized passages through
   `POST /api/ground`, contract `schoolcircle-grounding-v1`.
3. Sourcerer generates and strictly verifies a cited answer using hosted OpenAI.
4. Understudy `scoreCase` judges that exact answer against its cited evidence;
   `checkGrounding` adds a deterministic vocabulary-overlap guard. The latter is
   not a semantic proof and does not replace Sourcerer's strict verification.
5. Persist the caller-owned turn and stage outcomes before returning it.

There is no global-corpus, scripted, or model-only fallback. Unsupported evidence
produces a normal refusal with no citations. Required service failures produce
sanitized service errors, not a claim that the course lacks the answer.

## Anchor companion

Companion changes are proposed at
https://github.com/groundworklms/anchor/pull/1. They are **not deployed**.

The scoped endpoint accepts `{question, passages:[{id,text,source}]}` and returns
`{abstained, passages:[{id,text,source}], contract:"schoolcircle-grounding-v1"}`.
It reranks only caller-supplied text, without querying the global index or
generating an answer. Returned IDs, text and source labels must exactly match
the authorized request. SchoolCircle rejects expansion or altered provenance.
Legacy `/api/ask` does not implement this boundary and is not a substitute.

The caller owns authentication and source authorization. Protect the Anchor
service network as appropriate; do not expose its unrelated corpus-wide APIs
as learner-authorized retrieval.

## Hosted OpenAI configuration

Set server-side `OPENAI_API_KEY` and an explicit `STUDENT_MODEL_ID` to configure
student chat without changing instructor generation choices. The endpoint is
fixed to `https://api.openai.com/v1`. Alternatively, existing shared settings
are eligible only when explicitly configured for that official endpoint and
an exact model ID. A dedicated student selection never inherits another
provider's credential.

The adapter checks the exact ID against the authenticated OpenAI `/models`
catalog before generation. Requests use JSON-object output mode. Catalog
membership alone does not prove completion/output-mode capability; an actual
completion must succeed. Unsupported requests fail without model substitution.
Credentials, provider response bodies and unnecessary learner identity fields
are not returned or included in model prompts.

## Private local model fallback

Hosted OpenAI (the explicit GPT 6 Astra selection) remains the primary student
model. An operator may additionally configure
`STUDENT_LOCAL_BASE_URL`, `STUDENT_LOCAL_MODEL_ID`, and optionally
`STUDENT_LOCAL_API_KEY` for an OpenAI-compatible server on localhost or a
private network. The local URL must be HTTP(S), private/localhost, and contain
no credentials, query, or fragment. Its exact served model ID is required and
is checked through that server's `/models` catalog; do not guess an ID from a
GGUF filename.

If no `STUDENT_LOCAL_*` variables are set, the original shared model selection
from Settings or `MODEL_BASE_URL` / `MODEL_ID` is reused when it is ready and
points to a literal private IP or exact `localhost`. Its own endpoint credential
is used, never the student OpenAI credential. Partial local overrides fail
explicitly rather than borrowing the rest of the shared configuration. Other
hostnames and HTTP redirects are rejected.

On a hosted **network/timeout** failure only, SchoolCircle retries the entire
turn once local-only: Anchor, strict Sourcerer, and Understudy all run again.
The 110-second whole-turn deadline reserves 30 seconds for hosted work and 75
seconds for that local attempt; local catalog and per-call bounds are 5 and 15
seconds respectively.
It never mixes model stages. Authentication failures, rate limits, malformed
responses, unavailable model IDs, model refusals, and grounding refusals do
not trigger fallback. A local endpoint or catalog failure is an explicit local
model failure, not another fallback.

For a deliberately air-gapped installation with no hosted student
configuration at all, a complete local configuration is selected as primary.
If a hosted selection exists but is missing its credential, it fails explicitly
and does not silently downgrade. Returned/persisted stage metadata reports only
`model.path` (`hosted` or `local`) and whether that local path was a fallback;
it does not disclose local endpoint topology or credentials.

The Orin guide's `http://192.168.55.1:8080/v1` is an eligible local-server
address, but the guide documents only the model filename, not its API model ID.
Discover the ID from the local `/models` response before setting
`STUDENT_LOCAL_MODEL_ID`. This server fallback cannot make a cloud-hosted
SchoolCircle browser session work offline: authentication, application/data
services, and the scoped Anchor `/api/ground` endpoint must also be reachable
locally.

The requested name is **GPT 6 Astra**. The pre-existing `gpt-6-astra` occurrence
was only a test fixture. After the user supplied the server-side credential,
an authenticated OpenAI catalog check confirmed `gpt-6-astra`, and a live
chat-completion probe successfully returned the requested JSON object using
that exact model, `max_completion_tokens`, and `response_format: json_object`.
`STUDENT_MODEL_ID` is now explicitly set to `gpt-6-astra`; instructor settings
were not changed. The model ID was selected from the live catalog, not inferred
from the fixture.

## Verification and activation status

Deterministic tests exercise package orchestration, actual candidate judgment,
citations, refusals, provenance tampering, missing configuration and provider
failures. Run `npm run test:student-grounding`, `npm run test:doctrine-auth`,
`npm test`, `npm run test:model`, and `npm run build`.

The workspace now has the user-supplied `OPENAI_API_KEY` and verified
`STUDENT_MODEL_ID`. A credential stored in another deployment has not been
inspected or copied. `DOCTRINE_BASE_URL` remains unset, and the companion PR
has not been deployed. Full live student-answer verification has therefore
**not** occurred: the successful OpenAI compatibility probe is not a grounded
student turn. Activation requires an available Anchor deployment implementing
the scoped contract. No deployment, database migration or main-branch push is
part of this change.