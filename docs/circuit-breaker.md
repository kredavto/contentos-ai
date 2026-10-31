# AI provider circuit breakers

The long-lived OpenAI Responses adapter used by the worker now admits calls through
a process-local CLOSED → OPEN → HALF_OPEN → CLOSED circuit. No request is retried
by the breaker; OpenAI SDK retries remain disabled and its explicit 90-second
timeout and caller abort signal remain in force.

Five counted failures within a 10-minute window (long enough to include five serial 90-second timeouts), without an intervening successful
call, open the circuit for 30 seconds. During that cooldown requests fail with the
existing secret-free `PROVIDER_UNAVAILABLE` error before invoking the SDK. After
cooldown exactly one caller becomes a half-open probe; competing callers fail
fast. A successful probe closes the circuit, while a counted failure starts a new
cooldown. Network/SDK connection errors and HTTP 408, 429 and 5xx count. Credential
errors, other request rejections and caller cancellations do not count. A neutral
half-open result releases the probe slot without pretending recovery or extending
the expired cooldown. State generations prevent already-admitted older operations
from closing an opened circuit or reopening a recovered circuit. They still
return their original result so metered usage is not lost.

## Scope and limits

- State belongs to one provider object. The current worker constructs that object
  once and reuses it across jobs and workflows. A new object/process starts closed.
- This is not a distributed breaker. Multiple worker processes independently admit
  their own requests and probes; already-admitted calls are not cancelled. A
  fleet-wide concurrency/rate budget is separate work.
- OpenAI text generation, image generation and Whisper caption transcription are
  covered independently. HeyGen is covered per client (see the request-scoped BYOK
  limitation below). Do not mark specification §134 production-complete.
- Existing explicit fallback routes and durable job/credit handling are unchanged.
  The breaker does not replay uncertain remote writes, create automatic fallback
  credentials or fabricate successful output.
- No live provider call, production configuration or deployment was performed.

## Verification (2026-10-27)

On source materialized from PR #2 head `e990542`, the focused circuit and existing
AI suites passed **30 tests in two files**. Providers, AI and types package
TypeScript checks and changed-file ESLint passed. Coverage includes cooldown
boundaries, single-probe concurrency, stale concurrent successes/failures,
failure-window expiry, successful-call reset, neutral probes, invalid settings,
HTTP error classification, network failures, aborts and existing structured-output
usage/error contracts. This focused cloud checkout is not a full-project test run;
repository CI, production build/browser regression and live acceptance remain
separate gates.

The text-only checkpoint `ec8be649` subsequently passed full repository CI:
**859 tests across 120 files, all 37 Chromium scenarios, migrations, TypeScript,
ESLint and production build**, run
https://github.com/kredavto/contentos-ai/actions/runs/40579906079.

## Image and caption extension

Image generation uses the same five-failure/30-second-cooldown policy, with a
20-minute failure window to accommodate five serial 210-second timeouts. Caption
transcription retains the 10-minute window and 90-second SDK timeout. Each
long-lived worker adapter has independent state; opening an image circuit does
not trip text generation or transcription. Neither adapter retries requests.

Image admission wraps the entire bounded response read/validation. Network errors,
uncertain HTTP responses, malformed image responses and rate limits count, but
caller cancellation does not. A previously dispatched image still reports
`RECONCILIATION_REQUIRED` with `definitiveRejection:false`, even when that failure
opens the circuit. Only circuit rejection **before dispatch** reports
`PROVIDER_UNAVAILABLE` with `definitiveRejection:true`; the existing worker can
release that request's reservation without replaying earlier uncertain requests.
Caption admission uses the SDK transport-error classification from text
generation, preserves segment validation, and logs `CIRCUIT_OPEN` for denied calls.
Its pre-dispatch denial returns definitive `RATE_LIMITED`, not a retryable
`PROVIDER_UNAVAILABLE`: retrying after the persisted caption state becomes
`REJECTED` would otherwise cause unnecessary reconciliation on the next attempt.
As with text generation, malformed HTTP-200 caption output remains a validation
error rather than a transport-outage signal; it does not trip this circuit.

Focused extension verification: **65 tests in five files**, including original
image/raster/caption contracts and both breaker suites, passed. Providers and
focused-checkout test TypeScript, changed-file ESLint and whitespace checks passed.
This extension requires a new full CI run; the successful checkpoint above does
not establish regression acceptance for later commits.

## HeyGen extension and worker-state regression

Each `HeyGenClient` now has independent process-local admission. Counted failures
are the adapter's existing unavailable outcomes (network/HTTP 408, 409, 429 and
5xx). Caller cancellations, definitive credential/request errors and malformed
successful responses do not count. Existing 30-second timeout, validated response
schema, idempotency headers and absence of implicit retries are unchanged.

An admitted request retains its original uncertain/non-definitive outcome even
when it opens the circuit. A blocked POST is a definitive local `RATE_LIMITED`
denial; blocked GET/DELETE operations remain non-definitive
`PROVIDER_UNAVAILABLE`, since an existing remote resource may still need polling
or deletion. The repository's existing unknown-submission guard must preserve
older uncertainty even if a later attempt is denied locally.

Server-configured worker clients are long-lived. The initial HeyGen checkpoint
used per-client state only; the scoped BYOK extension below retains health across
request/job clients. Key-verification clients remain isolated.

Final focused validation for this extension: **91 tests in seven suites**;
full-workspace/test TypeScript, ESLint and production build passed. Added PostgreSQL worker tests
for fresh-denial refunds, prior-unknown reservation retention and caption denial
without false reconciliation. Those two new database cases were not run locally
(PostgreSQL is unavailable); they require the latest commit's full CI. No live
provider call or production readiness is claimed.

The OpenAI image/caption checkpoint `d1b56a4` passed full CI (879 tests in 121 files, all 37 Chromium scenarios, migrations, typecheck, lint and build):
https://github.com/kredavto/contentos-ai/actions/runs/40582710462.
This result does not validate the later HeyGen/caption worker-state changes.


## Scoped BYOK admission

Full acceptance of the preceding HeyGen/worker checkpoint `449efe9` passed:
**897 tests in 122 files and all 37 Chromium scenarios**, migrations, TypeScript,
ESLint and build ([CI run](https://github.com/kredavto/contentos-ai/actions/runs/40585397865)).
That checkpoint does not validate the scoped registry extension below.

Avatar, video and voice-catalog factories now share process-local health by the
**resolved database row's tenant ID, provider-key ID and revision**. Authorization,
plan eligibility, consent, revocation/revision checks and credential decryption
still occur on their existing paths before client construction. Registry lookup
never grants authority. A scoped client rejects a mismatched operation tenant
before admission or transport. Rotation uses a distinct revision; server keys and
read-only key-verification requests remain separate. A successful catalog call
can close the same provider-wide credential circuit used by avatar/video calls;
this is not independent per-endpoint health verification.

The registry stores canonical non-secret identities, counters and monotonic times,
not credentials, credential hashes, clients, requests, errors or operation
closures. A gate resolves the current entry on every invocation, so a retained
client cannot revive a stale breaker after healthy-entry expiry. Defaults are at
most 2,048 entries globally and 64 per tenant. Only CLOSED entries idle for 30
minutes with no admitted request in flight expire. OPEN/HALF_OPEN entries are
never discarded merely because cooldown elapsed or capacity is needed. Capacity
exhaustion denies before dispatch using the same safe method-specific mapping as
an open circuit; it never falls back to an untracked request.

Tradeoffs: abandoned failed credential revisions can retain capacity until a
successful probe or process restart. Registry state does not survive restart or
coordinate web/worker replicas; there is no distributed circuit, durable incident
history or administrative reset endpoint. This does not replace database rate
limits, authorization or uncertainty reconciliation. No provider was called live.
Validation of this extension is recorded in its draft PR; pending CI is not a pass.

Scoped-extension local validation: **97 tests in seven provider suites**, full
workspace/test TypeScript, ESLint and production build passed. Two existing
PostgreSQL integration scenarios now assert that avatar, video and catalog
factories receive the resolved row identity; these require exact-commit CI.
Independent review found no blocking identity, eviction or uncertainty defects.
