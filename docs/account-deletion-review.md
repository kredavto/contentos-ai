# Account deletion review

The existing account request intake remains REQUESTED/CANCELLED; submitting it does not start erasure or disable access. The asynchronous LOCKED → external cleanup → PII anonymization workflow is not implemented yet. This review is a preparatory operator tool, not completion of specification §107.

GET `/api/admin/deletion-requests/:id` requires the enabled admin feature and a current, verified, enabled platform SUPPORT/ADMIN operator. Tenant ownership does not grant access. The route uses the authenticated read throttle and existing no-store responses. Unknown requests return NOT_FOUND only after operator authorization. Every successful inspection records ADMIN_DELETION_INSPECTED with the request ID and correlation ID, without inventory or private payloads.

The response contains request identity, current revision/status/timestamps, inspection time, and actor-linked counts: current memberships/ownership, live sessions, unfinished generation jobs and reconciliation, non-deleted photo/library uploads, non-revoked social connections originally created by the user, active BYOK records originally created by the user, accepted consent/renewal evidence and unfinished email deliveries. Counts are decimal strings to preserve PostgreSQL bigint values. A repeatable-read transaction and one inventory statement provide a snapshot; it is not a lock authorizing a later mutation. A five-second query timeout fails explicitly instead of treating missing data as zero.

No plaintext, ciphertext, masked key suffix, file path, media name, email contents, external identity, job payload or other users' data is exposed. Migration 0080 adds actor/status indexes for jobs, photo uploads, library uploads and social connections; other counts use existing actor indexes.

The admin request list offers an inspection panel for requests on the current page, including cancelled requests. Refreshing obtains the latest status and revision. The interface explicitly warns that an uploader or consent acceptor need not be the depicted person, and that an originally created connection can later belong to another owner. Neither inventory nor a zero count authorizes deleting that organization's resources.

## Work remaining for actual erasure

- Define and confirm subject/resource scope independently of uploader/acceptor identity; distinguish account data from organization-owned content and other people's likenesses.
- Resolve current ownership before locking an account; recheck under transaction locks against concurrent membership/ownership changes.
- Capture explicit authorization for execution. Existing requests were submitted under copy saying automatic deletion is unavailable and must not be silently reinterpreted.
- Implement durable staged execution, fencing, retries, progress and reconciliation with active remote operations, bounded cleanup adapters, current consent and credential bindings.
- Inventory generated avatars/voices/videos, publishing and payment evidence, arbitrary material content and retention requirements; the displayed counts are not exhaustive.
- Revoke access and queued delivery, clean selected remote/local resources, anonymize eligible PII while preserving necessary references, then verify before reporting COMPLETED.

## Security review

Reviewed before delivery on 2026-10-24: authenticated session precedes routing; current verified/enabled operator rows are locked for the read transaction; schema restricts operator roles to SUPPORT/ADMIN; unknown request IDs cannot bypass authorization. Strict UUID validation and parameterized queries cover the new input. Rate limits, a five-second statement timeout and actor/status indexes bound work. Explicit projections omit private content and credentials, responses use no-store, and safe errors/logs expose only codes/correlation/timing. Rendering uses React text. The route only records inspection audit evidence and does not authorize erasure. These checks address the changed access-control, injection and data-exposure surface; they are not a claim of a complete platform security audit.
