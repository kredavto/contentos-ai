# Deployment

Source repository: https://github.com/kredavto/contentos-ai.

GitHub Actions validates the lockfile, lint and types, runs unit/integration/E2E suites with fixture external providers, and builds the application. Container builds and registry publication are not yet part of that workflow; run the documented container checks and record image digests separately before promotion. Deploy only validated releases. Repository access does not provision a runtime.

GLOBAL: HTTPS web/CDN, managed PostgreSQL, Redis, private S3-compatible bucket and persistent Node/FFmpeg worker. RU_DATA_RESIDENCY: web/API, PostgreSQL, Redis, private object storage and worker all placed in Russian infrastructure. External AI is called only for user-authorized operations with applicable consent. Select region explicitly; do not infer legal compliance from profile name.

Secrets: application origin, DB/Redis credentials, versioned encryption keys, email delivery, S3 keys and enabled provider credentials. Configure externally; never commit. Restrict service network access, set quotas/timeouts, configure HTTPS and trusted proxy boundaries. Migrations execute once before rolling out compatible images. Retain previous image and use additive migrations for rollback. Enable encrypted backups and demonstrate restore before production launch.

Current release status and deploy blockers: docs/IMPLEMENTATION_STATUS.md. A staging web deployment is available; production runtime configuration and full-stack acceptance remain outstanding.

## Selected web hosting
User selected Vercel for the web/BFF deployment, connected to kredavto/contentos-ai. Use apps/web as project root with workspace dependencies included. Deploy and verify only after implementation checks. Persistent BullMQ/FFmpeg worker remains a separate container service with PostgreSQL, Redis and S3. Vercel deployment belongs to GLOBAL; RU_DATA_RESIDENCY continues to use the separately documented Russian hosting profile.

Vercel project was created on 2026-10-09 in team `digagency` (`team_T4Jm4ASQqZgd6ys8grG6emG4`): `contentos-ai`, project ID `prj_KMzoSu8fmoWhhWqTFWFG4lc0hpEB`, linked GitHub repository `kredavto/contentos-ai`, root `apps/web`, Next.js, Node 24. Creation itself did not deploy the application; the verified staging deployment is recorded below. Runtime environment values remain unconfigured. Production PostgreSQL/Redis/S3/SMTP and the persistent worker host still need provisioning/configuration.

First staging deployment: `e3f3c043386c9ab9f28d4fce7b7fe0a55690f130`, deployment `dpl_BNU3bMVcorBgwyPDFrPS8XvRRERk`, [staging URL](https://contentos-54l7vlhlu-digagency.vercel.app), READY. The home page was inspected in Chrome, `/api/health` returned HTTP 200 and `/api/me` correctly returned HTTP 503 CONFIGURATION_REQUIRED because production services are not configured. Registration page renders, but account operations are not live. This is not production/MVP acceptance.

The first Git-triggered deployment was labeled production for the feature-branch commit; it was canceled before completion. The explicit staging request uses Vercel API target `staging` (the API rejects `preview`). Vercel's UI was checked against the project ID and currently tracks `main` as the production branch. Watch target/commit on subsequent Git deployments before promotion. Runtime environment variables remain empty.

Container build targets and the GLOBAL/RU_DATA_RESIDENCY release commands are documented in [deploy/README.md](deploy/README.md).

## NL server placement

The project owner authorized use of their existing NL server for backend infrastructure. SSH access with the existing local key was verified and a read-only inventory completed. The host currently runs many other applications; about 700 MB RAM and 8.3 GB disk were available, with roughly 3.2 GB swap in use. The owner chose to increase server resources; recheck capacity before deployment. Keep existing applications running; choose isolated service names, networks, volumes and ports after inventory. This placement belongs to GLOBAL, not RU_DATA_RESIDENCY. Do not copy a local development environment or test credentials onto the server.

Read-only TLS inventory found an existing Let's Encrypt certificate for the NL host's IP, valid through 2026-10-14, and an enabled IP-certificate renewal timer. The current reverse proxy and certificate configuration were not changed. New services need their own isolated ports/networks and a verified certificate-reload path before using that certificate; do not assume startup-only certificate loading covers its short renewal interval.
