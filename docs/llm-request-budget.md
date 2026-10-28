# LLM request-byte admission

The OpenAI Responses adapter rejects request bodies exceeding **256 KiB of
serialized UTF-8 JSON**, including model, system/user messages, output JSON
schema and the fixed request envelope. Admission occurs before circuit accounting
or SDK/network dispatch. A rejected request produces only `INVALID_INPUT`; its
content and serialization error are not logged or returned. Empty model
configuration retains `CONFIGURATION_REQUIRED`.

The adapter creates a detached plain-JSON snapshot before asynchronous dispatch.
It does not validate one mutable object and then send a different serialization.
Cyclic/non-JSON values, serialization hooks, serialization-visible accessors and excessive nesting
(depth greater than 64) are rejected rather than invoking custom serialization.
The exact accepted snapshot is passed to the SDK. Content is never truncated,
summarized or silently removed to make it fit: that could change evidence or
brand restrictions. Large but individually valid Brand Brain/performance
snapshots can therefore fail admission and need a smaller source context.

The existing maximum output of 12,000 tokens, SDK retry count zero and 90-second
transport timeout are unchanged. The orchestrator still permits at most three
calls with an overall 240-second deadline. Every actual provider usage result
continues to be recorded; unknown monetary cost remains null.

## Scope and remaining work

This is a transport-body byte ceiling, **not an exact token count, model-specific
context fit, per-workflow cost estimate or subscription-plan policy**. Headers and
SDK transport metadata are not included. The guard runs at provider dispatch,
not before job enqueue/reservation; existing job failure/release behavior applies
to local invalid input. Credit reservation and plan entitlement checks remain in
their existing domain/database paths. The separate unpublished plan-limit patch
has not been recreated or overwritten. Other provider categories are unaffected.

No live or paid LLM request was made. Focused mocked-transport tests and full
TypeScript/lint/build results must be recorded below before local acceptance;
full database/browser CI remains separate and requires publication authorization.

Focused local verification: **38 tests across three suites passed** and were
independently repeated. Tests cover exact/over byte boundary, UTF-8 and escaping,
all current workflow schemas, non-JSON/deep/cyclic input, snapshot mutation,
zero transport on rejection and unchanged output/usage/error behavior.

Full local workspace/test TypeScript, ESLint and production build passed. The
all-tests command exited successfully with **372 passed / 533 skipped** (71
passing / 52 skipped files). PostgreSQL/Redis-dependent integration suites are
unavailable locally; this is not full CI acceptance. Exact-commit database and
browser CI remains pending authorized publication.
