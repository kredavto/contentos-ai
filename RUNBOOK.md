# Contentos AI incident and recovery runbook

This is an operational procedure, not evidence that production infrastructure has been provisioned or recovered. The verified release and blockers are in [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md); the selected topology is in [DEPLOYMENT](DEPLOYMENT.md). Web/BFF and persistent workers deploy separately. GLOBAL and RU_DATA_RESIDENCY are placement profiles, not interchangeable storage locations or a legal-compliance guarantee.

## Identify and contain

Record UTC start time, the affected deployment commit/image IDs, request/correlation/job IDs, tenant scope and the last known good operation. Use the protected operator views and allowlisted JSON/error-monitoring records; avoid copying credentials, cookies, payloads, private media, encrypted credentials or upload-session URLs into an incident ticket. Compare web and worker versions and active environment/rollout switches without printing secret values.

Before using Compose, identify the existing project and container IDs from the deployment inventory, particularly on the shared NL host. Set CONTENTOS_COMPOSE_PROJECT to that recorded project name; CONTENTOS_IMAGE_TAG and RUNTIME_ENV_FILE must already point to the selected immutable image and protected runtime file as described in deploy/README.md. Never operate on other projects or use global prune commands.

To pause only the selected Contentos worker after checking its identity:

```sh
docker compose -p "$CONTENTOS_COMPOSE_PROJECT" -f deploy/compose.production.yml stop -t 120 worker
```

A stopped worker is not proof that an external operation did not happen. Retain durable send/submission markers and allow leases to expire through the state machine. Block new admission through the relevant deployment switch/policy while diagnosing. Scope-specific rollout exceptions override less-specific rules; a GLOBAL policy alone is not an absolute kill switch. Environment switches and pausing the exact worker are the deployment controls. Existing external requests, queued mail already marked for sending and published material cannot be recalled by a toggle.

`/api/health` is public web-process liveness only. `/api/health/ready` separately checks PostgreSQL SELECT 1, Redis PING and signed S3 HeadBucket, returning only 200/503 with coarse dependency states. Its per-process cache can lag a change by five seconds plus the bounded fresh check. Worker `/health` covers its queue workers/Redis connection. Core readiness does not establish migration/write/KMS/provider correctness; verify those separately. See [readiness.md](docs/readiness.md) for permissions, deadlines and acceptance limits.

## Database unavailable

1. Preserve errors and confirm the affected endpoint/network/region with the infrastructure operator. Inspect connection saturation, TLS, disk, memory and managed-service status through the protected console. Do not print connection strings or switch to an unrelated database.
2. Pause admission and the affected worker before any repair/restore that could change durable state. Redis queue contents are not the source of truth for credits, consent, publishing or payment settlement.
3. If the service recovers without a restore, verify migrations, tenant-scoped reads and ledger consistency, then inspect jobs with expired leases before resuming. An uncertain remote submission requires reconciliation, not a new identity/retry key.
4. If restore is required, follow the isolated restore procedure below. Never overwrite the live database as the first experiment.

## Redis unavailable

Confirm the configured instance, memory/eviction policy, persistence, TLS and network reachability. Pause dispatch and workers while Redis is inconsistent. Keep PostgreSQL outbox/job/attempt/ledger rows intact; do not mark work successful or bulk-delete durable states to clear a queue. After Redis recovers, reconcile durable states and expired leases, then let the existing dispatch/outbox paths refill queues using their stable IDs. Do not manually enqueue an uncertain publishing/payment/email write as a new request.

## AI or media provider unavailable

Inspect safe provider operation/status logs, durable attempts and the protected provider configuration screen. Confirm current credentials, entitlement, region, consent, provider quota and service status separately; CONFIGURED is not live acceptance. Stop affected admission and pause work if repeated calls are unsafe. Keep a functioning unrelated integration available.

Only the implemented bounded retry/idempotency rules may replay a request. Unknown avatar/video creation, YouTube upload initiation/thumbnail writes, comment insertion, Telegram sends and payment/email submissions have different recovery semantics. Consult the relevant integration document and current task state rather than assuming all failures are retryable. Do not enable mock providers in production or silently fall back to another person's/BYOK/platform account. Already received provider facts and metered usage must still be persisted when an unrelated policy is disabled.

The current source audit found no provider circuit breaker yet (§134); use deployment containment until that implementation is verified. Do not interpret finite SDK/job retries as a global breaker.

## Object storage unavailable

Check the configured region/bucket/endpoint, network/TLS, IAM, encryption/KMS access and service capacity using the storage administrator's bounded probes. Do not expose the bucket publicly, disable isolation checks or replace signed private URLs with permanent public links. Stop new uploads/renders/publishing that depend on unavailable objects. Retain object keys/checksums and durable cleanup fences; do not delete rows merely because a temporary read failed.

Restore objects and encryption access consistently with the database checkpoint. Validate exact keys, content types, sizes/checksums, object-version/ETag bindings and representative signed downloads before resuming. A successful database restore does not reconstruct media, KMS or application encryption keys. Cleanup must respect active upload/processing leases and late-write sweeps.

## Compromised credential or encryption key

Identify whether the incident affects a session, provider credential, OAuth grant, storage/database credential or application encryption key. Revoke the affected authority at its issuer, contain admission and preserve a secret-free audit trail. Invalidate sessions/tokens through the supported paths where appropriate; a password reset alone is not provider/OAuth revocation.

Rotate provider credentials using supported owner/admin workflows and preserve exact provider/key/revision bindings for existing uncertain operations. Key replacement is not evidence that the original external resource was deleted. Current BYOK cleanup may require the original bound credential; automatic safe rebinding remains incomplete. Escalate unresolved provider-owned resources through the account owner/provider rather than forcing local COMPLETED or using another account.

Application encryption-key rotation is distinct from provider-key rotation: securely provision the new version to both web and worker, retain required historical decrypt versions, use supported rewrap paths, verify representative old/new ciphertext, then retire old material only after a complete inventory. Do not remove a historical encryption key before known sessions/credentials/submission evidence can be recovered. Restore key material through the designated secret store, never repository history or logs.

## Failed migration or incompatible release

Pause promotion and relevant writers. Record the exact migration/hash, database state and web/worker versions. Determine whether the transaction committed before retrying. Never edit an applied migration, run production schema push, drop ledger/history guards or guess that an interrupted migration did nothing.

Apply a reviewed additive repair to an isolated copy and verify old/new reader compatibility before retrying the release migration once. An image rollback does not undo schema or financial history. Retain previous images and backups; prevent older workers from bypassing newly enabled consent/policy/input semantics. In particular, apply migration 0094 with rules inherited, deploy matching web/worker versions, and only then activate scoped policies. Disable admission before a rollback to workers that do not understand them.

## Publishing, payment or email incident

Stop the affected new writes and retain stable operation/approval/idempotency/attempt identities. Check whether a durable submission marker, external reference, signed receipt or webhook observation exists. Distinguish a definitive provider rejection from an unknown network outcome. An absence of a local success row does not prove nothing was sent or charged.

Use supported read-only reconciliation with original tenant/account/content/attempt bindings. An operator's guessed external ID or a new approved content version cannot authorize replay of a prior uncertain write. Preserve received receipts even after approval/feature revocation where the implementation permits historical evidence recording. Resolve ownership, provider text/media identity, channel, timing and current authority before any explicit recovery action. Never manufacture provider success to unblock a dashboard.

References: [publishing](docs/publishing.md), [YouTube](docs/youtube-integration.md), [comments](docs/comment-inbox-plan.md), [payments](docs/payments.md), [authentication email](docs/production-email.md), [notification email](docs/notification-email.md). If a supported reconciliation operation is unavailable in the selected release, retain the blocked task and investigate through its original provider account.

## Backup and restore drill

The implemented local rehearsal is [database-recovery.md](docs/database-recovery.md). It verifies a synthetic PostgreSQL dump/restore, schemas/rows/sequences/migrations and selected integrity/concurrency probes. It is not production PITR, encrypted off-site backup, storage/key recovery or an RPO/RTO commitment.

Before a real drill, agree and record the restore point, actual backup age, expected data loss, access authority, isolated destination and acceptance criteria. Inventory compatible PostgreSQL versions/extensions/roles, encrypted database backup/WAL retention, object versions and encryption/secret material as one recovery set. Keep the destination isolated from real email, payments, providers, webhooks, public traffic and production dispatch.

Restore into a separate database/storage environment. Validate schema/migration hashes, row counts/fingerprints without exposing contents, tenant FKs, immutable histories, usage balances/reservations, representative media/checksums and decryptability. Reconcile restored pending outbox/jobs against real remote operations before any external side effect can resume. Measure actual restore and verification times and record failures; do not publish unmeasured availability/RPO/RTO claims. Production backup scheduling/PITR, independent storage/key restore and a timed infrastructure drill remain outstanding.

## Resume and review

Verify the intended release/schema/configuration, core dependencies, current roles/consent, admission controls, bounded queue backlog and reconciled uncertain operations. Resume only the selected worker/service and an explicitly authorized test flow. Verify registration/mail, tenant isolation, generation accounting, private media and the affected provider result separately before promoting public traffic. Confirm monitors/alerts and backup freshness, then document the incident timeline, retained unknown states, data-loss assessment, tested recovery evidence and follow-up owners. Do not declare full recovery while dependent data or external outcomes remain unknown.
