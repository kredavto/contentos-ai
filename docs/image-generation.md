# Image generation integration

Implemented: provider-neutral input/result types, a real OpenAI Images adapter, an offline file fixture, explicit server configuration and a raster normalization boundary. **Not yet an end-user feature:** no image database table, worker dispatch, ledger policy, API, approval/download/delete flow or Image Studio is wired. Existing uploads and video covers retain their behavior and byte limits. Do not connect a route directly to the adapter.

The adapter uses the official [Images generation endpoint](https://developers.openai.com/api/reference/resources/images/methods/generate), checked on 2026-10-12. One request asks for one opaque PNG at medium quality, with one of three product dimensions: 1024×1024, 1024×1536 or 1536×1024. Prompt length is at most 4,000 characters. The operator explicitly selects an allowlisted GPT Image model; no fallback silently changes the model or price. Documented GPT Image outputs are base64, so response URLs are never fetched. A diagnostic `x-request-id`, when present and valid, is recorded as a request reference; it is not a retrievable image id. Missing token usage and monetary cost remain null.

Transport is fixed to the official HTTPS origin, rejects redirects, has a 210-second timeout and performs no automatic retries. The HTTP JSON body and decoded image both have limits (24 MiB decoded image). Responses require exactly one canonical-base64 PNG with the requested dimensions. Correlation ids are validated before becoming headers. Raw provider errors, prompts, bodies and credentials are not returned in domain errors.

Known 4xx rejection (excluding ambiguous 408/409) is marked definitive; 401/403 report configuration required and 429 reports rate limiting. Network failure, cancellation after dispatch, 5xx, redirects, malformed output and unexpected media are **RECONCILIATION_REQUIRED**. A pre-aborted operation never sends a request. The remote endpoint is not assumed idempotent. An idempotency key in OperationContext does not make it safe to replay a request.

Before any private storage write, `normalizeGeneratedImage` must fully decode the raster, validate exact dimensions, reject animation/corruption/excessive pixels, strip source metadata and re-encode JPEG within the existing 3 MiB storage bound. Header validation in the adapter alone is insufficient. Uploads still reject inputs over 3 MiB; generated inputs have a separate 24 MiB bound.

Required next vertical slice:

- Persist actor-bound immutable intent and the chosen provider/model; authorize current tenant membership and enforce quota before reserving credits under the tenant lock.
- Claim a fenced lease and persist SUBMITTING before the sole remote call. A stale SUBMITTING lease must never trigger a blind new generation.
- Persist metering and uncertainty; atomically capture once only for a validated stored result. Define auditable reconciliation/refund behavior for missing output and preserve unknown external expense.
- Store normalized files under deterministic tenant-scoped keys; recover or clean orphaned writes after crashes. Recheck authorization before storage/completion and fence deletion against active workers.
- Expose role-separated review/approval, signed preview/download and durable deletion in Image Studio. Keep fixture output visibly marked as demo. Add full PostgreSQL and browser coverage before enabling the feature.

Tests use injected HTTP transports and local rasters only. No live OpenAI request or charge has been made. Changing environment settings alone does not start image jobs.
