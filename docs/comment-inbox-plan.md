# Comment inbox implementation scope

Audit date: 2026-10-24. Specification §§81–83 remains unimplemented. This document is a plan, not completion evidence. Internal approval discussion must not be counted as social comments.

## Provider evidence

Official [YouTube commentThreads.list](https://developers.google.com/youtube/data/reference/rest/v3/commentThreads/list) supports videoId, time ordering, page tokens and plainText output. Fetch only comments for a persisted publication whose channel and current authorized connection are checked. Request bounded pages; do not accept arbitrary browser-supplied provider URLs.

Replies use [comments.list](https://developers.google.com/youtube/data/reference/rest/v3/comments/list) with parentId and its own pagination. Do not present a partially returned reply list as complete. Provider errors or disabled comments must be explicit states, not empty success or zero analytics.

## Required implementation and acceptance

- Tenant-scoped UUID comment records with composite publication foreign keys and unique provider/external identity; author identity/name, original provider timestamps, text, nullable unassessed sentiment and status. Validate provider fields and render text without HTML interpretation.
- Durable bounded import tasks with outbox, stable IDs, credential-version checks, current role checks before and after reads, leases, retries, cursor cycle protection, safe logs and explicit incomplete-sync state. Do not overwrite local review state on repeated imports.
- Inbox with publication/brand scope, pagination, refresh, error recovery, thread/reply visibility and human triage. Deletion or edits at the provider need a documented refresh policy; absence from one page is not deletion evidence.
- SUGGEST_ONLY default. Separate generated draft, approval and external-send transitions; do not treat generating a suggestion as consent to publish. Recheck tenant role, current approved text/revision and connected channel before execution.
- AUTO_REPLY needs explicit opt-in, a feature flag and current policy checks. Legal claims, medical questions, financial promises, threats, complaints, personal-data requests and sensitive content require NEEDS_HUMAN; uncertainty must not produce silent automatic replies.
- Non-idempotent external sends with unknown outcomes require reconciliation, never blind retry. Record receipts and safe audit evidence. This plan does not authorize sending real comments during development.
- Tests: tenant/role isolation, external identity mismatch, replay/deduplication, edits, bounded pagination, credential revocation races, unknown send outcome, approval invalidation, all safety categories, injection-like comment text and browser flow. CI uses synthetic providers; live acceptance is separate.

No provider request using a user credential or comment publication occurred during this audit. OpenAI-backed drafting remains subject to the pending credential setup decision. Other social providers remain in the full project scope.
