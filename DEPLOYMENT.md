# Deployment

Source repository: https://github.com/kredavto/contentos-ai.

GitHub Actions will validate the lockfile, lint, typecheck, run unit/integration/E2E suites with mock external providers, build immutable web/worker images and attach commit identifiers. Deploy only validated releases. Repository access does not provision a runtime.

GLOBAL: HTTPS web/CDN, managed PostgreSQL, Redis, private S3-compatible bucket and persistent Node/FFmpeg worker. RU_DATA_RESIDENCY: web/API, PostgreSQL, Redis, private object storage and worker all placed in Russian infrastructure. External AI is called only for user-authorized operations with applicable consent. Select region explicitly; do not infer legal compliance from profile name.

Secrets: application origin, DB/Redis credentials, versioned encryption keys, email delivery, S3 keys and enabled provider credentials. Configure externally; never commit. Restrict service network access, set quotas/timeouts, configure HTTPS and trusted proxy boundaries. Migrations execute once before rolling out compatible images. Retain previous image and use additive migrations for rollback. Enable encrypted backups and demonstrate restore before production launch.

Current release status and deploy blockers: docs/IMPLEMENTATION_STATUS.md. No live deployment has occurred.

## Selected web hosting
User selected Vercel for the web/BFF deployment, connected to kredavto/contentos-ai. Use apps/web as project root with workspace dependencies included. Deploy and verify only after implementation checks. Persistent BullMQ/FFmpeg worker remains a separate container service with PostgreSQL, Redis and S3. Vercel deployment belongs to GLOBAL; RU_DATA_RESIDENCY continues to use the separately documented Russian hosting profile.
