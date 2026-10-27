# OpenAI circuit breakers

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
  covered independently. HeyGen and other provider adapters are not covered. Do
  not mark all of specification §134 production-complete.
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
As with text generation, malformed HTTP-200 caption output remains a validation
error rather than a transport-outage signal; it does not trip this circuit.

Focused extension verification: **65 tests in five files**, including original
image/raster/caption contracts and both breaker suites, passed. Providers and
focused-checkout test TypeScript, changed-file ESLint and whitespace checks passed.
This extension requires a new full CI run; the successful checkpoint above does
not establish regression acceptance for later commits.
