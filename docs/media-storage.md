# Private photo library

The implemented slice uploads, previews and deletes brand photos. Avatar/video generation, remote video ingestion and the broader media factory remain separate work.

## Boundaries and format

The authenticated BFF accepts a raw JPEG/PNG/WebP body up to 3 MiB with `Content-Type`, percent-encoded `X-File-Name` and a UUID `Idempotency-Key`. Exact Origin and verified writer-role checks apply before the body is consumed. Unknown brands, tenant mismatches, control characters, empty bodies and oversized streams are rejected. Bodies are bounded even without Content-Length.

Sharp inspects allowlisted raster signatures, validates the actual decoder format against MIME, rejects multi-page input and limits decoded dimensions to 16 megapixels. It applies orientation and encodes a fresh JPEG of at most 2048 × 2048, without original EXIF/ICC metadata. No SVG, arbitrary URL fetching, original unvalidated blob, or executable attachment is served. The 3 MiB request ceiling is intentional for the short-request BFF; large video uploads will need a separate upload workflow.

Sources: https://sharp.pixelplumbing.com/api-constructor/ and https://sharp.pixelplumbing.com/api-output/ (checked 2026-10-04).

## Persistence and retries

`media_assets` stores tenant/brand ownership, safe display metadata, content hash, unique upload intent, provider and an opaque tenant-prefixed object key. A tenant lock serializes quota checks and upload claims. The current bootstrap quota is 1 GiB / 1000 non-deleted photos per organization; pricing-plan integration is still pending.

Upload claims last 120 seconds; storage calls abort at 60 seconds. Completion checks current permission and the exact live lease. Repeating the same successful intent returns the existing asset; changing input under a used key conflicts. In-flight concurrent ownership is rejected. Failed attempts retain the same intent for retry, while uploads abandoned for 24 hours are collected automatically.

No signed URL or storage credential is persisted in browser-facing records. A tenant/brand-authorized request obtains a GET-only URL valid for 60 seconds. Previously issued links may remain usable for their remaining lifetime or until physical deletion; revocation immediately blocks issuance of new links.

Deletion changes the record to DELETE_PENDING before contacting storage. The persistent worker claims cleanup rows with SKIP LOCKED and a fenced lease, applies bounded exponential backoff, and records completion only after storage acknowledges deletion. Pending uploads receive a grace interval before deletion. Deleted keys are never reused, and tombstones trigger hourly delete sweeps for 24 hours to remove late writes from timed-out requests. A deleted asset cannot be reactivated by replaying an upload. Audit events store internal identifiers rather than file names or bytes.

## Configuration

Set `STORAGE_PROVIDER=s3`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` on both web and worker. For compatible providers use `S3_ENDPOINT` and optionally `S3_FORCE_PATH_STYLE=true`. Production endpoints require HTTPS. Optional `S3_ENCRYPTION=AES256` or `aws:kms` with `S3_KMS_KEY_ID` configures server-side encryption.

Provision a private bucket with public access blocked and least-privilege GetObject/PutObject/DeleteObject permissions for the application prefix. Do not configure public website access. Use an unversioned media bucket for this deletion implementation; a versioned bucket requires a separate purge/retention policy for non-current versions before claiming physical erasure. Storage must remain consistent between web and worker. Keep signed URL query strings out of logs, CDN caches and analytics. Without complete server configuration, uploads and downloads return CONFIGURATION_REQUIRED; deletion intent can still be recorded for processing when the storage returns.

## Verification

Unit tests cover decode/re-encode, orientation, metadata stripping, forged MIME, SVG, truncation and resource bounds. PostgreSQL integration tests cover tenant/brand isolation, role rejection, idempotency, failed upload recovery, persisted deletion retries, abandoned upload collection and upload-versus-delete fencing. Playwright uses a loopback S3 transport fixture and the actual AWS SDK to exercise the UI; this is not a live cloud-storage verification. Production credentials and bucket policy verification remain outstanding.
