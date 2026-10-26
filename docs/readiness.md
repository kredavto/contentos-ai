# Core infrastructure readiness

GET `/api/health` remains public web-process liveness. GET `/api/health/ready` is a separate Node route: HTTP 200 only when database, Redis and private storage probes all succeed, otherwise HTTP 503. The body contains only `status` (ready/not_ready) and fixed dependency names with ok/unavailable/configuration_required. Both response paths use Cache-Control: no-store. POST is not supported. The endpoint needs no application session or functioning authentication database.

The narrow readiness profile deliberately ignores external AI, video, social, payment and SMTP configuration. Those failures must not make core infrastructure fully unavailable. Likewise, core-ready is not a complete application/deployment/provider acceptance result: it does not validate all application settings, current migrations, user-table permissions, writes, rendering, consent, provider account access or production restore. Continue using deployment smoke tests and enabled-provider acceptance.

Each process coalesces simultaneous checks, runs configured probes in parallel and caches success/failure for five seconds using a monotonic clock. Each probe has a 1.5-second service deadline; cancellation is requested and even a non-cooperative probe cannot keep the HTTP response pending indefinitely. Cached status can therefore lag an infrastructure change for at most the normal cache interval plus a fresh probe. No dependency is retried indefinitely. Client disconnects do not cancel a shared probe needed by other health requests.

## Probe behavior and configuration

Database: a dedicated PostgreSQL connection (max one, one-second connection/statement bounds) runs only SELECT 1. Cancellation cancels that query; finalization closes the dedicated client, including failed connections. It does not borrow or mutate an application transaction, scan tenant data or run migrations.

Redis: a dedicated ioredis 5.11.1 client uses the configured redis/rediss URL, explicit one-second connection/command bounds, no offline queue, automatic retries, ready INFO requests, CLIENT SETINFO metadata or resubscription. The check connects, sends PING and disconnects. AUTH/SELECT follow the URL/client protocol when required; no application keys are read or written. The dependency is the same locked version already used by the worker.

Storage: S3StorageProvider uses signed HeadBucket against the configured private bucket, with no object upload, object enumeration, public ACL or user-object read. Its native abort deadline is 1.2 seconds, within the overall service deadline. HeadBucket requires the relevant bucket access permission (AWS S3 uses s3:ListBucket); a role supporting only individual object actions may need an explicitly reviewed probe permission. Failure remains unavailable rather than inventing storage success. This probe does not prove PutObject/KMS/media-processing capability.

DATABASE_URL must be a non-empty postgres/postgresql network URL and REDIS_URL a redis/rediss URL. Missing, malformed, wrong-protocol or fragment-bearing endpoints are configuration_required and cause no connection attempt. S3 uses the existing STORAGE_PROVIDER/S3_* configuration and endpoint security validation; disabled, missing or invalid storage configuration is reported independently. No new secret or mandatory environment variable is introduced. The factory does not print or return URLs, credentials, native errors, stack traces, bucket names, objects or user identifiers. Environment changes take effect with the corresponding process/deployment restart.

## Acceptance boundaries

Core tests cover missing config, parallelism/coalescing, cached recovery/failure, non-cooperative timeout/cancellation, frozen public results, private-error omission and backwards wall-clock movement. Factory/route tests cover 200/503/no-store, endpoint validation and external-provider independence. Native tests exercise real local PostgreSQL/Redis, rejected loopback connections and a signed S3 HeadBucket transport with accepted/denied access.

The Chromium scenario uses the actual Next HTTP route, dedicated PostgreSQL/Redis and loopback S3 fixture: 200 → 503 when bucket access is denied → 200 after recovery, while liveness remains 200. The fixture accepts both standard path-style bucket-root forms, including the SDK's trailing slash; changing the fixture does not relax production S3 checks. All fixture control endpoints exist only in the NODE_ENV=test loopback server.

Exact results and remaining deployment limits are in IMPLEMENTATION_STATUS.md. No real provider, production bucket, user data or infrastructure configuration is changed by local acceptance.

Final local checkpoints: all 830 Vitest cases / 117 files and full MVP/CSRF/readiness Chromium scenarios passed (5.2m browser suite). A final least-privilege Redis handshake change then passed 16 focused tests / 6 files, fresh types/lint/build and readiness outage/recovery Chromium (46.6s suite; 11.3s scenario). The Redis wire fixture verifies that a plain connection sends only PING. Details and any corrected fixture failure are retained in IMPLEMENTATION_STATUS.md.
