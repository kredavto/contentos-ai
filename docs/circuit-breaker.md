# OpenAI text-generation circuit breaker

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
- OpenAI text generation only: image, speech, HeyGen and other provider adapters are
  not covered. Do not mark all of specification §134 production-complete.
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
