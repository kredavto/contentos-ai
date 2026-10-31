# Audio/video preparation boundary

The audio/video library now has tenant-scoped API endpoints, persisted upload intents and a dedicated durable worker queue. It is disabled by default. The existing photo library is unchanged. The browser supports same-origin uploads up to 64 MiB, with resumable 3 MiB parts for larger files. Normalized audio can be selected as background music in Video Studio; ready MP4 can be selected for up to five timed B-roll inserts and optional [intro/outro clips](video-bookends.md).

## Upload contract

`S3StorageProvider.signedUpload` issues a signed POST for exactly
`{tenantId}/uploads/{internalId}/source`. The internal ID must be a UUID. The policy binds the object key, declared MIME type, exact byte count, private cache policy and configured server-side encryption. It never grants access to a ready media key or sets a public ACL. Expiry is limited to 300 seconds; files are limited to 64 MiB and MP4, MP3 or WAV declarations.

A POST signature is a reusable bearer capability until it expires. MIME and length constraints do not prove content validity. The source declaration also contains SHA-256, but signing alone does not verify that hash. The worker downloads a bounded snapshot, checks its actual hash and length against the saved intent, and prepares those same bytes. Never publish or return a signed download of a quarantined object. Bucket CORS and POST policy support must be verified on the configured S3-compatible service.

## Preparation contract

`FFmpegMediaPreparation` accepts bytes rather than user paths or URLs. It checks container headers and probes actual streams before transcoding. It accepts at most 180 seconds, one video stream and at most one audio stream for MP4, or exactly one audio stream for MP3/WAV. Input video is bounded to 4096 pixels per axis, 8,388,608 total pixels and 120 fps. Attached pictures and additional streams are rejected.

MP4 output uses H.264, YUV420P, 30 fps, dimensions at most 1920 per axis, and AAC audio when present. Audio files become stereo 48 kHz MP3. Metadata and chapters are removed. Final duration, stream presence, codecs and size are checked before returning bytes. Silent videos remain silent.

Commands use generated filenames, explicit demuxers, no shell, disabled MOV external references and a restricted protocol list. Child processes receive a minimal environment without runtime credentials, per-allocation memory limits, bounded output, timeouts and cancellation. Temporary directories are removed on success and failure. These controls do not replace worker container resource limits or an OS sandbox.

## Durable lifecycle and API

Migration 0049 adds `library_media` with composite tenant/brand foreign keys and validated source, lease and ready-output metadata. Upload requests bind actor, brand, name, source hash/size/type and provider to an idempotency key. Conflicting replays fail. Migration 0050 adds validated part hashes and durable receipt indexes. The optional `chunkHashes` manifest is part of request identity and contains one SHA-256 per fixed 3 MiB part. Legacy/raw uploads expire five minutes after intent creation; chunked uploads expire after thirty minutes. Neither window can be extended; an expired upload requires a new intent. Only the original uploader can confirm it. Writers can delete and authorized readers can download ready results.

Under `/api/organizations/{tenantId}/brands/{brandId}/library-media`:

- `GET /`: list up to 100 active records and configuration readiness; private keys and hashes are omitted.
- `POST /`: submit `{name, source: {mimeType, bytes, sha256}, idempotencyKey}`. Returns an intent ID and signed POST fields while uploading. Completed/queued replays return status with no new grant.
- `POST /upload-intents`: create or recover a browser upload intent (maximum 64 MiB). Sources above 3 MiB require `chunkHashes`; the manifest length must match the source size. Returns ID, status, expiry and durable `uploadedChunks`, never provider credentials or a signed upload grant.
- `GET /{id}/upload-intent`: recover the original declaration, part manifest, received indexes and idempotency key for the current authorized uploader only. Available only for unexpired UPLOADING sources within the browser size limit. Response is no-store; other actors, brands and tenants are denied.
- `POST /{id}/source`: send raw file bytes with the declared Content-Type. Authenticates the original uploader before reading the bounded body, verifies size/MIME/SHA-256, writes through the storage provider and confirms processing after rechecking permission and lifecycle state.
- `POST /{id}/chunks/{index}`: send a fixed part (index 0–21, at most 3 MiB, final part may be one byte). Rechecks current actor/writer access before body reads and after storage writes. Exact size, declared MIME and part SHA-256 are required. Replays use the same private key and immutable bytes; a received part is not rewritten. Raw and chunked transport cannot be mixed for one intent.
- `POST /{id}/confirm`: enqueue processing after the source upload succeeds. Chunked intents require every expected receipt under the tenant lock. This confirms receipt, not content validity.
- `GET /{id}/download`: a 60-second URL for ready normalized content only.
- `POST /{id}/delete`: revoke new downloads immediately and schedule durable removal.

The application checks authentication and exact Origin for mutations, applies shared user mutation throttles, 15-per-15-minute actor/tenant intent/raw-upload throttles and a separate 120-per-15-minute actor/tenant chunk throttle, validates bounded JSON and checks writer permissions. Browser source bytes pass through a bounded same-origin web route, domain service and S3 provider. The per-request 3 MiB limit leaves room under the [Vercel Functions 4.5 MB request limit](https://vercel.com/docs/functions/limitations). Existing signed POST capabilities remain an adapter/API path for sources up to 64 MiB; browser components do not call that path or the storage upload API directly.

The record itself acts as a transactional outbox: the dispatcher redelivers due jobs with a stable BullMQ ID, and database lease tokens fence completion. Each job has at most three processing attempts with exponential backoff, a five-minute lease and a four-minute operation deadline. Authorization is rechecked before reading, before writing and during completion. Attempt-specific output keys keep old workers from overwriting the successful result. Missing configuration fails explicitly as `CONFIGURATION_REQUIRED`.

The worker reads parts sequentially, validates their individual hashes and sizes, assembles a bounded in-memory snapshot and verifies the whole-file hash before preparation. No additional assembled quarantine object is stored. A missing/corrupt part fails safely before FFmpeg.

A separate conservative 1 GiB tenant quota reserves source bytes plus three maximum-size outputs per active intent under the tenant lock. With 64 MiB sources this allows four simultaneous retained records. Ready and failed records retain their reservations until deletion completes; this is a bootstrap safety limit, not a paid-plan storage allowance. Upload processing does not consume AI credits or video generation seconds.

Cleanup waits past the upload grant and possible in-flight write deadlines. It deletes quarantine sources, every part key and non-selected outputs, preserves ready output, retries storage failures with bounded exponential delays, scrubs deleted names/source and part hashes/output metadata (retaining the part count for late-write cleanup), and sweeps late writes for 24 hours after the terminal transition. Abandoned uploads are reclaimed ten minutes after grant expiry. Previously issued download URLs can remain valid for up to 60 seconds. Cleanup continues even when new uploads are disabled.

## Enablement and remaining work

Set `MEDIA_LIBRARY_ENABLED=true` on web and worker only after configuring private S3 and absolute worker `FFMPEG_PATH` / `FFPROBE_PATH`. The private bucket must support signed POST policies. Configure lifecycle rules for incomplete requests and noncurrent object versions if bucket versioning is enabled; application quotas do not count retained object versions. Do not make quarantine keys public.

The brand media tab accepts MP4/MP3/WAV up to 64 MiB and three minutes, shows upload progress and lists audio/video processing states, supports native playback through short-lived signed downloads, and allows writer-authorized deletion. Players close on link expiry, deletion or list-access failure; temporary list failures recover automatically. Existing saved assets remain manageable when processing is disabled.

A failed or lost acknowledgement can be retried using the same retained intent while the form remains mounted. After a reload, the author can choose “Продолжить загрузку файла” on an eligible unfinished card and select the original file again. Recovery uses the database intent; no file bytes, source hashes or idempotency metadata are persisted in browser storage. The form checks original MIME/size/hash before sending bytes, and the server repeats validation. For raw uploads this retransmits the whole file. Chunked uploads fetch current durable receipts and send only missing parts, including after a lost acknowledgement or page reload. Completed parts do not extend the original thirty-minute deadline. The server never rewrites a source already queued or completed; the worker independently revalidates its downloaded snapshot. Retries after expiry require deleting the unfinished record and selecting the file again. In-flight storage requests have a deadline no later than the original upload window (five or thirty minutes); deletion retains its existing cleanup barrier and late-write sweep. Switching pages aborts client transmission but does not imply server rollback.

Still required: configurable storage entitlements, direct clip-to-clip transitions and advanced music editing, and live verification of the selected storage service.

No provider credentials or live bucket are required for local adapter contract tests. Real service verification remains outstanding.

## Database clock for processing and cleanup (2026-10-15)

Processing dispatch, retry eligibility, five-minute leases, completion/failure timestamps and cleanup deadlines now use PostgreSQL time. Fast or slow worker clocks cannot bypass processing backoff, steal an active lease, accept an expired lease, extend a cleanup retry or prematurely end the late-write sweep. The existing attempt tokens, tenant locks, current membership checks and attempt-specific storage keys remain authoritative. Maximum processing attempts and delays are unchanged.

Due-work scans use `statement_timestamp()` for a consistent scan boundary. Lease checks after acquiring the tenant lock, new deadlines and cleanup completion use `clock_timestamp()` so time is refreshed after lock waits rather than fixed at transaction start. This follows PostgreSQL's [documented clock semantics](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT). Cleanup scheduling takes the greatest of database time, persisted upload/processing/cleanup deadlines plus their one-minute safety margins, and any existing cleanup barrier. SQL SET expressions retain the old row's deadlines while clearing its ownership tokens. Nullable barriers are handled by PostgreSQL's [GREATEST semantics](https://www.postgresql.org/docs/17/functions-conditional.html#FUNCTIONS-GREATEST-LEAST).

Cleanup leases remain two minutes. Failed cleanup backs off exponentially to one hour; successful cleanup continues hourly while the persisted 24-hour sweep window remains open, then stops. Deleted timestamps remain stable across repeat sweeps. Existing deadlines are honored rather than rewritten, and no schema migration is required.

This change covers queued processing and cleanup in the audio/video library. Upload grant creation/signing, upload-expiry validation, local operation timeouts and other job families retain their existing timing behavior. It does not remove the operational need to synchronize database, application and storage clocks.
