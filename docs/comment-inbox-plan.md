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
