# Comment inbox implementation scope

Audit date: 2026-10-24. Specification §§81–83 remains unimplemented. This document is a plan, not completion evidence. Internal approval discussion must not be counted as social comments.

## Provider evidence

Official [YouTube commentThreads.list](https://developers.google.com/youtube/data/reference/rest/v3/commentThreads/list) supports videoId, time ordering, page tokens and plainText output. Fetch only comments for a persisted publication whose channel and current authorized connection are checked. Request bounded pages; do not accept arbitrary browser-supplied provider URLs.

Replies use [comments.list](https://developers.google.com/youtube/data/reference/rest/v3/comments/list) with parentId and its own pagination. Do not present a partially returned reply list as complete. Provider errors or disabled comments must be explicit states, not empty success or zero analytics.

## OAuth prerequisite verified on 2026-10-24

The official [YouTube discovery document](https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest) lists `https://www.googleapis.com/auth/youtube.force-ssl` for commentThreads.list, comments.list and comments.insert. The default authorization requests only youtube.upload and youtube.readonly; an upload-only grant must not be presented as comment-ready.

Add an explicit optional comments permission request in the connection flow, persist the requested capability in the one-time OAuth attempt, and verify the granted scope on callback. Keep existing upload-only connections usable. Recheck the current grant and credential generation during every import/send; a missing comments scope requires reconnecting, not fallback to another account. The product must explain the additional Google permission before consent. Acquiring the provider permission is not opt-in to automatic replies; SUGGEST_ONLY remains the default and reply approval is separate.

## Required implementation and acceptance

- Tenant-scoped UUID comment records with composite publication foreign keys and unique provider/external identity; author identity/name, original provider timestamps, text, nullable unassessed sentiment and status. Validate provider fields and render text without HTML interpretation.
- Durable bounded import tasks with outbox, stable IDs, credential-version checks, current role checks before and after reads, leases, retries, cursor cycle protection, safe logs and explicit incomplete-sync state. Do not overwrite local review state on repeated imports.
- Inbox with publication/brand scope, pagination, refresh, error recovery, thread/reply visibility and human triage. Deletion or edits at the provider need a documented refresh policy; absence from one page is not deletion evidence.
- SUGGEST_ONLY default. Separate generated draft, approval and external-send transitions; do not treat generating a suggestion as consent to publish. Recheck tenant role, current approved text/revision and connected channel before execution.
- AUTO_REPLY needs explicit opt-in, a feature flag and current policy checks. Legal claims, medical questions, financial promises, threats, complaints, personal-data requests and sensitive content require NEEDS_HUMAN; uncertainty must not produce silent automatic replies.
- Non-idempotent external sends with unknown outcomes require reconciliation, never blind retry. Record receipts and safe audit evidence. This plan does not authorize sending real comments during development.
- Tests: tenant/role isolation, external identity mismatch, replay/deduplication, edits, bounded pagination, credential revocation races, unknown send outcome, approval invalidation, all safety categories, injection-like comment text and browser flow. CI uses synthetic providers; live acceptance is separate.

No provider request using a user credential or comment publication occurred during this audit. OpenAI-backed drafting remains subject to the pending credential setup decision. Other social providers remain in the full project scope.

## Provider adapter foundation (2026-10-24, not yet an inbox)

A typed YouTube read adapter now loads bounded thread/reply pages with plainText, opaque encoded cursors, fixed official endpoints, no redirects/retries/writes and a 1 MiB response cap. Thread reads first verify the video/channel, including empty pages. Reply reads require a parent already bound to a verified publication by the future repository; each returned parent/channel is checked. Duplicate identities, repeated cursors, malformed timestamps, oversized text/pages and mismatched associations are rejected without partial output. Author identity may be unavailable and is represented as null. Inline replies are not treated as complete. No author-profile URLs or provider-private textOriginal fields are returned.

Disabled comments, missing objects, expired tokens, quotas and network failure remain explicit typed errors. The existing provider transport keeps its prior response limits for other endpoints. Focused tests passed 23 cases across the new comment adapter and existing YouTube contracts using synthetic HTTP responses; no user credential or live Google call was made. Workspace/test typechecks and lint also passed in the isolated worktree. Full integration remains pending.

The next slice implements optional OAuth permission and channel-card capability controls, with full acceptance pending. This foundation does not implement comment storage, synchronization jobs, inbox UI, sentiment, drafts, approvals or sends. Existing upload-only connections cannot be advertised as comments-ready. Full §§81–83 remain open.

## Storage and import decisions from the existing schema

Publication ownership is derived through publications.job_id → publishing_jobs, where brand_id, connection_id and credential_version already exist. The importer must join that chain under authenticated tenant context rather than accept brand/channel/external video identity from its request. Persisted external identity is validated again against the current YouTube channel before reads. The initial scope is publications already recorded by this application; arbitrary remote video imports require a separate authorized flow.

Store each comment with an internal UUID, tenant/publication association, provider external identity, optional parent UUID within the same tenant/publication, nullable author identity, original/updated provider timestamps and latest observed text. Enforce composite parent/publication foreign keys and unique tenant/publication/provider/external identity. Keep imported content revision separate from local triage revision so replay cannot reset review decisions; changed text must invalidate any pending approved reply. Sentiment stays null until assessed.

Use a durable import run plus bounded page tasks: save each validated page and its next cursor atomically with the next outbox event. A lease token fences page completion. Record visited cursors per run to reject longer cycles, not just identical consecutive tokens. Fetch replies independently for every known thread with replies; a thread-list completion does not imply reply completion. A bounded run that reaches its page/time budget exposes PARTIAL with a resumable cursor, never SUCCEEDED with an apparently complete inbox. Missing rows from a refresh are not deletions; confirmed unavailable objects need explicit evidence and a retained review history.

These are design constraints for the next migration/service slice, not implemented storage or execution guarantees.


## Implemented import boundary and HTTP surface (2026-10-24)

The storage, import lifecycle, transactional page persistence, processor and worker queue described above are now implemented locally. Full regression before HTTP wiring passed 710 tests in 98 files. No live Google read or comment send was performed.

Canonical scope: `/api/v1/organizations/:tenantId/brands/:brandId/publications/:publicationId/comments`.

- GET lists roots or replies using optional `parentId`, `status` and paired `afterCreatedAt`/`afterId`. Response includes `items`, `next`, and `sync: {job, configuration}`. A null job means never imported, not confirmed empty. Partial/failed/cancelled jobs do not establish completeness; successful imports are snapshots and retain previously observed comments.
- PATCH `/:commentId` changes local triage only, with `revision`, `contentRevision` and `status`.
- GET `/imports` polls safe job progress and configuration, without credentials or cursors.
- POST `/imports` creates an idempotent import intent using `idempotencyKey`.
- POST `/imports/:importId/resume` resumes a PARTIAL import at the saved position using `revision`; only the original requester can resume.
- POST `/imports/:importId/cancel` cancels using `revision` and the current management role.

All routes reuse authenticated sessions, tenant/brand/publication service authorization, normalized envelopes, no-store responses and Origin checks for mutations. Import requests/resumes also use the auth throttle in addition to durable per-publication cooldown and active-run limits. Inbox UI and browser acceptance remain pending. These routes neither suggest nor send replies.

## Next implementation: generated reply drafts and approval

The existing GenerationOrchestrator already provides strict structured output, repair, model routing and call accounting, while JobRepository reserves/captures/releases credits in its job transaction. Reuse those boundaries for a dedicated reply workflow; do not call the LLM inside a route or run a provider directly from UI. Extend the typed job union, configured pricing, database constraints and persisted workflow result together.

A reply draft must reference the tenant/publication/root comment plus both provider content revision and local review revision, and preserve an immutable input snapshot with the selected Brand Brain revision. A generated result is a suggestion only. Model output includes bounded reply text and advisory risk categories; unknown or unvalidated output fails closed. Legal/medical/financial claims, conflict, complaints, personal data, sensitive topics and uncertainty require human review. A model's empty risk list cannot by itself authorize automatic sending.

Persist draft revisions append-only, with current editable draft selection separate from approval. Editing text, changing the source comment, changing the approved policy or losing current authorization invalidates approval. Approval explicitly binds exact text/version, source revisions, actor, channel and credential generation. SUGGEST_ONLY remains the default; drafting and manual triage do not create a send job. AUTO_REPLY requires its separate explicit opt-in, feature flag and execution-time policy checks and is not enabled by Google OAuth scope.

Delivery needs its own outbox and reconciliation-aware state machine. Verify current official YouTube insert capabilities before implementing the write adapter. Record an attempted remote write before dispatch; an unknown result cannot be blindly retried. No live reply send is authorized by test coverage or by enabling comment reads. Until that complete path exists, the UI continues to state that sending is unavailable.

Required acceptance: current tenant/role checks at request and execution; concurrent credit reservation/capture/release; stale comment/draft approval rejection; safe prompt treatment of external comment text; all human-review categories; bounded schema repair; provider failures and unknown outcomes; browser draft/edit/approve flow without real external sends.


## Delivery API evidence refreshed — 2026-10-24

Reviewed the official [comments.insert reference](https://developers.google.com/youtube/data/reference/rest/v3/comments/insert), updated 2026-10-15. Replies use POST `/youtube/v3/comments?part=snippet`, OAuth `youtube.force-ssl`, and `snippet.parentId` plus `snippet.textOriginal`; success returns a comment resource. The parent is a top-level comment. Therefore a reply to an imported child must resolve the stored thread root rather than pass the child ID. The documented request has no idempotency-key parameter; treat lost responses as uncertain outcomes and reconcile before any resend. This is a delivery design inference from the documented contract, not a tested provider guarantee.

Before delivery implementation, persist an approval bound to the immutable draft version, current source and root context, brand revision, approver, connected channel and credential generation. Verify all bindings again when claiming and immediately before dispatch. Editing source/draft, revoking permissions or replacing credentials must invalidate eligibility. Record the dispatch attempt before the non-idempotent call, retain the remote receipt when available, and never infer success from identical text alone during reconciliation. This reference review made no authenticated provider request or external send.
