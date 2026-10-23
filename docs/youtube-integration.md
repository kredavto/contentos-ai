# YouTube integration

## Current implementation and verification boundary

The server adapter implements OAuth authorization-code exchange with state/PKCE, offline token refresh, revocation, channel inspection, assignable category lookup, resumable video initiation/upload/probing, processing status and custom thumbnails. Every request has a timeout and bounded response; it does not retry internally or follow redirects. Session locations are restricted to the documented Google upload endpoint. Errors/logs omit credentials, codes, upload locations and raw provider payloads. Upload acceptance is distinct from completed video processing. Expired sessions require reconciliation; they do not automatically create a replacement upload.

Migration 0058 adds session-bound, expiring, single-use OAuth attempts. State is hashed, the PKCE verifier is encrypted, and consuming the state removes the stored verifier before remote exchange. Callback completion rechecks session/account/role, brand scope and connection revision. New connections cannot silently overwrite an existing channel; reconnect requires an explicit connection and revision and must return the same remote channel. Credentials use the existing tenant/brand/connection-scoped authenticated encryption vault. Ordinary access-token renewal keeps the credential generation stable; a new grant increments it and cancels pending operations using the previous grant.

Authenticated API routes:

- `GET /api/organizations/:tenant/brands/:brand/youtube`: redacted channels and configuration readiness.
- `POST` to the same path: start OAuth, optionally with `connectionId` and `revision` for reconnect. Cookie mutations require same-origin requests and rate limiting.
- `POST /api/organizations/:tenant/brands/:brand/youtube/:connection/check`: check the grant, refreshing expired access tokens.
- `GET /api/social/youtube/callback`: state- and session-bound callback; rejects duplicate sensitive query parameters, sends no-referrer/no-store responses, and redirects only to the authorized brand's integrations view.
- Existing social disconnect/rewrap routes also apply to YouTube credentials.

Local disconnect removes the stored grant and blocks pending sends. It does not revoke the entire Google application's grant: Google revocation can affect other connections using the same Google account/client. The adapter exposes revocation for an explicit account-wide workflow. A deleted session cascades removal of its pending OAuth attempts; expired attempts are also pruned when that user starts another connection in the tenant.

The interface shows configuration-required when credentials or the vault are missing, separates YouTube from Telegram channel settings and protects read-only users. No client secret, token or upload session is returned to the browser. Browser fixtures use synthetic connection rows; live Google login/upload has not been verified. The durable publishing worker is implemented and locally verified; the YouTube publishing UI is still pending, so the existing Telegram publication selector excludes YouTube until that flow is connected.

## Configuration

Create a Google OAuth **Web application** client for the intended project and enable the YouTube Data API. Configure the exact authorized redirect URI as `APP_URL` plus `/api/social/youtube/callback`. The callback is server-side and is not an arbitrary browser-provided URL. Store these settings in the runtime secret store, not in Git or browser code:

```text
YOUTUBE_ENABLED=true
YOUTUBE_CLIENT_ID=<web client id>
YOUTUBE_CLIENT_SECRET=<client secret>
```

The existing credential encryption keyring and active key ID must also be configured. The adapter requests `youtube.upload` and `youtube.readonly`; it validates granted scopes and requires offline access. Application OAuth consent/testing/verification settings and the authorized test channel must be confirmed in the actual Google project. `CONFIGURED` means the local server settings exist, not that Google production approval or live acceptance has been proven.

## Bounded source reads

`RangeStorageProvider` and the production S3 adapter now expose `inspectObject` and `getRange` for the upcoming worker. Inspection requires a nonempty object of at most 256 MiB and a strong ETag. Each range is at most 8 MiB and sends both `Range` and `If-Match`. The adapter verifies HTTP 206, exact Content-Range/Content-Length, the unchanged ETag and the actual streamed byte count before returning bytes. Foreign tenant keys, traversal, invalid boundaries and weak validators are rejected before transport. Responses that ignore ranges or identify a different object are rejected, and the SDK remains configured for one attempt. These methods do not yet send any YouTube publication.

## Persisted approval and upload checkpoints

Migration 0059 adds `youtube_uploads`, tied to a publication job with a composite tenant foreign key. Its database checks constrain phases, source size, acknowledged offsets, channel/video identities and retry counters. A trigger prevents changing source identity, reducing acknowledged progress, replacing a known remote video ID, deleting evidence or mutating a completed checkpoint.

`PublishingRepository.approve` can persist a YouTube-specific immutable snapshot of metadata, source size and optional cover identity/revision. Both YouTube and Telegram video snapshots additionally pin the video stage revision and approval timestamp; reapproving a render at the same key/size cannot silently reuse a prior publication approval. Older queued video snapshots without these fields fail closed and require a newly reviewed calendar revision. It still requires a currently approved video, current subject consent and manager approval. The public publishing service remains configured for its existing provider until the YouTube worker and UI are wired. The Telegram dispatcher and claim method explicitly exclude YouTube jobs.

`YouTubeUploadRepository` provides tenant-scoped leases using PostgreSQL time, current-role/grant/source/consent rechecks, a persisted STARTING marker before initiation, encrypted-session storage, monotonic acknowledgements, processing/thumbnail/visibility gates, bounded retry delays and completion recording. Upload progress does not consume the preparation retry budget. Lost initiation/thumbnail acknowledgement, expired sessions, retry exhaustion or the one-day processing horizon require reconciliation. A late acknowledgement from the unchanged original lease may preserve evidence but does not requeue a reconciled job; a replaced lease cannot overwrite the replacement worker's state. Recording an already-issued remote result intentionally does not discard it because permission was revoked in flight; all subsequent remote work must pass `prepare` again.

Integration acceptance for this repository is recorded in IMPLEMENTATION_STATUS.md. Worker orchestration and queue wiring have now been implemented and locally verified. The redacted progress API and publishing form remain pending. No public YouTube send capability is enabled solely by adding the table/repository.

## Publication invariants

Keep the common publication identity, approved calendar revision, audit and publication result. Persist provider-specific upload state separately with a tenant-scoped job foreign key. Store the upload-session URL encrypted, expected source length, acknowledged offset, remote video ID and current phase. Approval freezes title/description/category/privacy, made-for-kids and synthetic-media declarations plus the approved video/cover identities.

The worker must persist `STARTING` before initiating a remote session and persist the returned session before sending media. A lost initiation response requires reconciliation. Once a session exists, each resumed delivery probes that session first and sends only bytes the server has not acknowledged. An expired session never blindly starts another video. Remote video identity must match the grant channel; upload completion then advances to processing/thumbnail verification without starting another upload. Retain the remote ID when processing or thumbnails fail so recovery can act on that video.

Use bounded polling, backoff, stable queue IDs and database leases, with a separate retry budget from ordinary upload progress. Recheck current permissions, credential generation, source approval and subject consent before each remote write. Access-token refresh is distinct from reconnect; refresh must not invalidate every pending publication. Disconnect/revocation stops further automatic work and preserves evidence of a potentially completed remote operation for reconciliation. Do not report a private or rejected video as a successful public publication. Unsupported per-video comment controls must be explicit in the UI.

## Official sources inspected 2026-10-19

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server): authorization endpoint, offline grants, scope validation, token lifetimes, refresh and revocation.
- [Google PKCE parameters](https://developers.google.com/identity/protocols/oauth2/native-app): verifier bounds and S256 construction; live acceptance with the configured web client remains to be checked.
- [Resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol): persist session URI, probe with an empty PUT, interpret 308/Range, resume only acknowledged offsets, handle expiration.
- [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [video resource](https://developers.google.com/youtube/v3/docs/videos), [videos.list](https://developers.google.com/youtube/v3/docs/videos/list): metadata, declarations, video identity and processing state.
- [channels.list](https://developers.google.com/youtube/v3/docs/channels/list): inspect the grant's channel without guessing a destination.
- [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set): authenticated custom thumbnail uploads.
- [videos.update](https://developers.google.com/youtube/v3/docs/videos/update): changing privacy later requires additional scope; this adapter does not silently request that broader access.

The inspected upload documentation differs from older quota/private-upload descriptions. No historical quota cost or blanket private-only audit restriction is hardcoded. Actual quota and OAuth review/access must be verified against the project's current Google configuration.

### Worker recovery design

The existing common publication states can remain unchanged: a YouTube upload stays `SUBMITTING` while a separate checkpoint records `STARTING`, `UPLOADING`, `PROCESSING`, `THUMBNAIL` or `VERIFYING`. This keeps calendar freezing and the distinction between remote work and completed publication intact. The Telegram dispatcher/claim path must explicitly exclude YouTube before its worker is enabled. A YouTube claim needs its own checkpoint-aware lease and retry accounting; successful byte progress must not exhaust the existing three-attempt preparation limit.

Create the checkpoint and enter `SUBMITTING` in the transaction immediately before initiation. An expired lease with only `STARTING` is uncertain and requires reconciliation. With a persisted session, a new lease probes the same session; a worker that lost its lease cannot persist a later result over the replacement owner. Store source length and ETag before initiation, and use version-bound S3 reads for every chunk. Persist the returned remote video ID before processing or thumbnail steps. Polling and source reads do not authorize a new upload session.

Pending scheduled/preparing jobs can retain existing cancellation semantics. Once remote work has started, disconnect or consent revocation must prevent further writes and preserve the remote session/video evidence as `RECONCILIATION`; a local cancellation must not claim that a remote video was removed. The user-facing result must distinguish an uploaded-but-unverified video from a confirmed publication. No automatic remote deletion or broader Google scope is implicit in reconnect/disconnect.

The pending worker must call `prepare` again immediately before each remote write, including after a potentially slow source read. Transfer errors with a persisted session may be reconciled by probing that same session before any resend. A missing initiation response has no such recoverable session identity and remains a reconciliation case. Safe automatic retry after a **definitively rejected** initiation uses an explicit recorded rejection/retry transition; it is never inferred from a generic transport error or by resetting STARTING blindly.

## Worker orchestration (locally verified)

`YouTubePublishingProcessor` executes one bounded delivery at a time. It persists initiation/session state before sending bytes, probes the session on every resumed transfer, reads at most 8 MiB using the pinned source ETag, and rechecks permissions/consent after source reads. An uncertain chunk response is followed by a probe of the same session; it never initiates another video. Processing and requested visibility must be confirmed before publication is recorded. A thumbnail write is marked before execution and an unknown outcome requires reconciliation.

Only a verified `ProviderRequestError.definitiveRejection` with a retryable code can use the recorded rejected-initiation path. The checkpoint stays STARTING with an explicit rejection marker while the parent job returns to SCHEDULED; retry clears the marker atomically before a new request. Initiation retries share the three-attempt preparation budget and preserve source identity. Unknown initiation results cannot enter that path.

The worker queue is `contentos-youtube-publishing`, with stable job IDs, database-backed dispatch, bounded BullMQ retries, a two-minute delivery signal and three-minute database leases. It participates in health checks and graceful shutdown. OAuth access renewal preserves grant generation, resolves competing renewal writes by reading the committed current token, and rejects changed/revoked grants. Credential JSON parsing produces a safe typed error rather than including decrypted content in exceptions. Public API routes never return the worker access token.

The public publishing API/UI now exposes YouTube approval, category selection, explicit declarations, safe upload progress and reconciliation guidance. Full local acceptance passed 552 tests and four Chrome scenarios, including actual browser-to-worker publication with a test-only external YouTube simulator. No live Google upload has been verified.

### Next analytics boundary

The remaining publication-metrics workflow should use the existing normalized nullable metrics model and immutable observations rather than treating unavailable fields as zero. The official [videos.list reference](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), checked 2026-10-19, exposes the `statistics` part alongside `snippet`; the adapter must verify both the expected video and its owning channel before accepting observations. This API read is separate from expanded YouTube Analytics reporting and must not imply support for retention, reach or watch-time reports. Durable request identity, current-role/grant checks, safe retries, API source labeling and an actual browser-to-worker test remain to be implemented.

### Publication acceptance harness

`YOUTUBE_TEST_MODE=true` is a server-only CI flag accepted only with runtime `NODE_ENV=test`. It selects a resumable external-service simulator for publishing and categories; the OAuth connection factory remains the real Google adapter. The constructor independently checks the runtime environment with `Reflect.get` because Next.js folds direct NODE_ENV property reads into build-time constants. Focused tests reject production/development activation and inconsistent factory/runtime settings. Publication responses carry a demo marker and suppress remote links, and the UI explicitly says Google is not called. This flag is not part of normal deployment configuration.

Run local browser acceptance with installed Chrome using `PLAYWRIGHT_CHANNEL=chrome pnpm test:local --recovery --e2e tests/e2e/youtube-publishing.spec.ts tests/e2e/youtube.spec.ts tests/e2e/onboarding.spec.ts` (pnpm 10.30.3). The harness creates disposable PostgreSQL/Redis/media services and uses real application routes, repositories, queue dispatch, worker processing and S3 transport; only external YouTube responses are simulated. The new publishing test seeds an explicitly synthetic approved source and current consent, and covers form declarations, confirmation invalidation, preview, narrow viewport, repeated approval, Origin checks, final upload checkpoint, credential redaction and viewer permissions. Passing this harness does not prove Google app approval or live-channel publishing.

Final local publication acceptance (2026-10-19): 552 tests in 79 files, four Chrome scenarios, typecheck/lint/build and PostgreSQL restore verification passed. See `IMPLEMENTATION_STATUS.md` for measured results and remaining scope.

### Publication statistics adapter (2026-10-22)

The real YouTube provider now implements `YouTubeStatisticsProvider.statistics` using the official `videos.list` endpoint with `snippet,statistics` and a restricted fields projection. It requires matching video/channel IDs. An absent video returns null; missing counts stay null. Only views, likes and comments map into normalized metrics. Deprecated favoriteCount is never treated as saves, and reach, watch time, shares, clicks and other unavailable fields remain unknown. Counts are validated decimal strings within the normalized model's 10^12 bound; malformed or out-of-range values fail safely. Observations are cumulative provider counters at the local read time, not period totals, unique viewers or verified watch-duration measurements.

The existing bounded transport supplies manual redirects, safe error mapping and one remote attempt. No token appears in URLs or returned metrics. Official references checked on 2026-10-22: [videos.list](https://developers.google.com/youtube/v3/docs/videos/list) and [video statistics fields](https://developers.google.com/youtube/data/reference/rest/v3/videos).

This adapter is not yet a user-visible automatic analytics workflow. Persisted immutable observations, authorization/grant rechecks, scheduling, retries, API/UI and browser acceptance remain required. No live Google request was made.

### Immutable metric persistence

Migration 0060 allows API-origin records in the existing publication history. `AnalyticsRepository.recordYouTube` is an internal boundary; the public manual-entry route cannot choose API provenance. It locks the tenant, rechecks the requester role and publication brand, validates the video's channel against the active connection and credential generation, and writes an immutable snapshot once per actor-bound intent. Different metrics under the same key are rejected. API and manual source labels remain distinct in current and historical views. Demo references cannot masquerade as API data.

The observation schema permits only views, likes and comments to be non-null. Times before publication or after server time are rejected. Future workers must retain one immutable observation across a persistence retry, call this completion boundary after the remote read, and persist task completion atomically with (or reconcile it against) the returned observation identity. A scheduler and automatic refresh UI are not yet connected.

### Durable publication statistics requests

The publication analytics service now requests a database task through `POST .../publication-analytics` using only a publication UUID and idempotency key. Clients cannot submit API counters. `GET` exposes safe task states and configuration readiness. The separate `contentos-publication-analytics` BullMQ consumer obtains current OAuth access, reads the provider once per attempt and atomically commits the immutable API observation and success state. It rechecks role, brand, channel and credential generation at execution and completion; read retries use exponential backoff, a maximum of three attempts, 120-second fenced leases and a 24-hour job age limit. Requests are limited to one pending job and one request per minute per publication, with 25 active tasks per tenant.

The analytics UI exposes on-demand cumulative views/likes/comments refresh and polls one shared task overview while work is pending. This is on-demand refresh, not periodic synchronization. Missing videos cancel with NOT_FOUND, unknown counters remain null, and unsupported statistics remain unknown. Google configuration and real channel authorization are still required. The publishing CI simulator is rejected as a source for API observations; browser acceptance currently verifies its unavailable-statistics state, while synthetic provider fixtures exercise queue completion in integration tests. Live Google and full browser-to-worker statistics acceptance remain outstanding.

Local acceptance of this queue slice passed on 2026-10-22: 561 tests, typechecks, lint, production build and the Chrome publication/configuration-state scenario. Successful statistics completion, stale deliveries, retry exhaustion and mid-request role/grant revocation are covered at the repository/processor boundary. The browser's refresh-success path and live Google acceptance remain explicitly pending.

### End-to-end statistics simulator

Migration 0062 extends provenance with DEMO. The explicit test-only YouTube provider now supports statistics for its completed upload sessions, enabling browser-to-worker acceptance without external credentials. The publication and connection demo markers must match the persisted task source and configured processor source. Real API observations cannot be saved from demo references, and demo tasks cannot consume real references. Public requests cannot choose their source. UI summaries/history display DEMO rather than API for simulated values. OAuth is never simulated; the existing runtime NODE_ENV guards prohibit this provider in production/development.

The previous publishing-only limitation is superseded by this test implementation. Live Google acceptance and periodic statistics synchronization remain separate work.

End-to-end statistics acceptance passed locally on 2026-10-22: the Chrome publication test verifies a successful metric refresh through the real API/queue/worker/database path, with an explicit test-only external YouTube provider. Current/history UI shows DEMO, one observation survives repeated submission, unsupported counters remain null, zero remains visible, and request source spoofing and missing Origin are rejected. All 561 tests, typechecks, lint and production build passed. Live Google acceptance remains unverified.

### Operator diagnostics

The administration console now offers publishing tasks, publishing reconciliation cases and publication analytics tasks. SUPPORT/ADMIN platform authorization is separate from tenant roles, rechecked on every request, and reads are audited. Tenant filters and bounded cursor pagination apply. YouTube diagnostics expose phase, acknowledged byte counts, known video ID, checkpoint revision, retries/errors and whether an encrypted upload session exists. The session itself, tokens and content snapshots are never returned. These are persisted local facts, not a fresh Google verification. This read-only screen does not restart uploads or resolve uncertain outcomes; safe operator resolution remains required.

### Verified resolution boundary

`YouTubeResolutionService` is an internal core boundary for a current platform ADMIN to confirm a known remote result. Input contains tenant/job UUIDs, expected checkpoint revision, ticket and idempotency UUID; the caller cannot supply a replacement remote video ID or privacy. The service reads the existing video through the provider and the repository atomically rechecks authorization, source/consent/grant generation, revision, READY status, channel, video identity and approved privacy before saving a resolution receipt and publication. Verification evidence must be no older than 60 seconds. The service samples PostgreSQL time during preparation before the remote read and uses that timestamp at completion, conservatively bounding the whole observation. Freshness is evaluated against the same database clock; application clock skew cannot make a fresh read appear future-dated. Direct future-dated and stale evidence remains rejected. Missing videos and unknown thumbnail outcomes remain RECONCILIATION. Only VERIFYING or cover-free PROCESSING checkpoints are eligible. No upload/write method is used.

The immutable receipt in migration 0063 serializes actor/request identity and uniquely identifies the resolved job. Repeated successful intent returns the prior receipt without repeating the provider read; an altered intent conflicts. The recorded publication time is the confirmation time, not a claim that the provider's original upload happened at that instant. Public operator API/form and full browser acceptance are still pending for this boundary.

Local verification of the resolution boundary passed: 564 tests, typechecks, lint and production build. Success is tested for known cover-free PROCESSING and VERIFYING checkpoints, with concurrent idempotent requests producing one publication/immutable receipt. Tests also reject stale identity/revision/evidence, changed privacy/channel/source, unauthorized/revoked operator access, withdrawn consent and uncertain thumbnails. This verifies core/repository behavior against a synthetic provider, not a public API or browser resolution workflow.

### Operator request queue and form

`POST /api/admin/youtube-resolution` accepts the revision-bound resolution input and returns a task identity. The mutation uses session authentication, Origin checks, shared/user-specific throttles and current PLATFORM ADMIN authorization. `GET /api/admin/youtube-resolution/tasks` returns at most 20 safe status rows for the selected tenant/job to authorized platform operators. The administrator form is available in the publication-reconciliation category; SUPPORT cannot submit. Configuration readiness is displayed explicitly.

`contentos-youtube-resolution` runs the read-only verification in the worker alongside its provider instance. The task has a stable queue identity, bounded retry/expiry, fenced leases and immutable terminal evidence. Publication/receipt/task success is atomic; duplicate requests and recovered deliveries cannot create a second publication. Migrations 0064–0065 preserve task intent and tenant-scoped receipt relationships. Unknown thumbnail/initiation outcomes still require separate handling; the form never starts a replacement upload.

Queued operator acceptance passed locally on 2026-10-22: 565 tests, typechecks, lint, production build and the Chrome upload → paused VERIFYING checkpoint → ADMIN resolution → published result → statistics chain. Browser checks include ordinary-user/SUPPORT denial, Origin protection, stale revision, duplicate task requests, safe status responses and mobile layout. The external provider is explicitly simulated; this verifies orchestration and state transitions, not live Google behavior. Known eligible videos can now be confirmed from the operator UI without any new upload. Unknown initiation and thumbnail outcomes remain unresolved by design and require separate evidence handling.
