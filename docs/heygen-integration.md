# HeyGen integration research — 2026-10-04

Canonical API: https://developers.heygen.com/llms.txt. The current v3 reference supersedes older examples at docs.heygen.com and community v1/v2 snippets. No account credentials were read, no key created and no paid request made during adapter development. Contract tests use intercepted fetch, not the live service. Subsequently, an authorized short test with the user-selected private avatar was submitted through the HeyGen plugin and accepted for processing. This is separate from the application API adapter, which still lacks server credentials.

## Implemented adapter contracts

- Photo creation / additional uploaded-photo look: `POST /v3/avatars`, `type: photo`, `file: {type: url, url}`, optional `avatar_group_id`; save `data.avatar_item.id` as the look reference and `group_id` in provider metadata. https://developers.heygen.com/docs/avatar-from-photo and https://developers.heygen.com/reference/create-avatar
- Public-only avatar discovery: `GET /v3/avatars/looks?ownership=public`, cursor `token`/`next_token`, `has_more`. A server API account may contain multiple tenants' private assets; those are never exposed through catalog discovery. https://developers.heygen.com/reference/list-avatar-looks
- Poll look: `GET /v3/avatars/looks/{id}`. Completed, processing and failed are normalized; no generated avatar is treated as ready merely because creation returned an ID.
- Delete owned avatar group: `DELETE /v3/avatars/{group_id}`. Application code must supply a tenant-owned private reference, never a user-entered external ID. Public catalog deletion is rejected by the adapter. https://developers.heygen.com/reference/delete-avatar-group
- Direct talking-head render: `POST /v3/videos`, `type: avatar`, look ID, voice ID, script, selected aspect ratio/resolution; no default watermark. https://developers.heygen.com/reference/create-video
- Delete owned render: `DELETE /v3/videos/{id}`; require matching `data.id` and `deleted: true`. HTTP 404 is idempotent success. Only tenant-owned internal references reach this operation. https://developers.heygen.com/reference/delete-video
- Poll render: `GET /v3/videos/{id}`, normalized processing/ready/failed; a completed response must contain an HTTPS video URL and matching ID. https://developers.heygen.com/reference/get-video
- Public voice discovery: `GET /v3/voices?type=public`, cursor pagination. Private voice cloning remains a separate consent-gated workflow, not catalog discovery. https://developers.heygen.com/reference/list-voices

Transport uses the fixed HTTPS origin, server-only API key, no redirects, 30-second abortable requests, bounded response size, normalized errors and safe correlation/job/status/duration logging. No raw response, script, URL, key or personal image is logged.

## Mutation recovery constraint

The Create Avatar and Create Video references document `Idempotency-Key`: mutation response replay for 24 hours, 409 while the original request is in flight. The adapter propagates the durable operation key and performs no hidden retries. The avatar repository persists the first submission time and immutable business intent. It replays only within a conservative 23-hour window (a renewed signed URL may differ, as allowed by the documented replay behavior). Beyond that window it requires operator reconciliation. Video orchestration enforces the same bounded replay policy. Never regenerate after an ambiguous timeout under a new key. Internal ledger settlement remains separate from provider charges.

## Consent

HeyGen photo avatars do not collect a provider consent record; the application must retain the subject's authorization. Our center stores subject, type, exact policy version/hash, accepting user, timestamp, IP and user agent; policy evidence cannot be edited and revocation cannot be undone in-place. Withdrawal revokes all currently active attestations for that subject/type so duplicate acceptance cannot bypass it. A later grant requires a new explicit action.

`requireConsent` checks exact tenant, subject, type, version and hash. Avatar/video creation and execution must call it inside their tenant-lock transaction before submitting external work and before committing results. Avatar jobs now bind to exact original consent record IDs and recheck both policy and revocation before submission and readiness. Revoking and then granting a new consent does not reactivate old jobs. Video workflows bind to the avatar job’s original consent evidence and the exact approved script version. Production deployment also needs review of the application consent text and retention/deletion policy for the intended jurisdiction.

## Remaining media slice

S3 adapter boundaries are implemented and contract-tested; Private photo upload/download and tenant-owned avatar/looks jobs are implemented. Public voice selection and video jobs now connect provider submission/status, bounded download, private storage, FFmpeg processing and user approval. Remaining work includes private voice cloning/import, provider configuration UI, webhook verification, operator investigation of expired unknown submissions and richer editing. The application adapter has not been tested against the live account; the separately authorized plugin test does not prove deployed adapter operation.

Provider video downloads accept only HTTPS files.heygen.ai URLs, without embedded credentials or alternate ports. DNS must resolve exclusively to permitted public IPv4 addresses; the request pins one checked address while retaining hostname TLS verification. Redirects are rejected, size is capped at 256 MiB and MP4 magic is checked before FFprobe validates tracks. Download URLs and signatures are never logged.

## Video deletion and recovery

Deletion immediately marks the project DELETE_PENDING, clears approval, blocks new signed downloads and fences/cancels unfinished jobs. Pending reservations are released; completed renders retain their captured usage. The cleanup worker waits beyond an active generation lease plus request grace, deletes the provider render, original/final objects and cover, then scrubs project text and references. Retries keep downloads blocked and use exponential backoff. Previously issued signed links have a maximum remaining lifetime of 120 seconds and cannot be recalled before object removal.

An ambiguous submission without a reference remains pending for investigation; cleanup never invents an external ID or claims remote success. A late reference is retained so deletion can proceed after the writer grace period. Manager/admin/owner resume is allowed for active reconciliation jobs only with current consent and script approval; unknown mutations past the conservative replay window cannot be re-submitted.
