# Implementation status

Updated 2026-10-04. This is an implementation inventory, not a claim that the full specification is complete.

## Verified working slice

- pnpm 10.30.3 / Turborepo monorepo: apps/web, apps/worker and seven requested packages; strict TypeScript 5.9.3, ESLint 10, Vitest, Playwright.
- Next.js 16.3.8 Russian-first responsive UI with Tailwind 4, shared shadcn-style Radix/CVA button and original green/ivory visual design.
- Email/password registration, real SMTP adapter, email verification, reset links, login/logout and revoke-all-sessions API. scrypt N=131072/r=8/p=1; random tokens hashed at rest; HttpOnly/SameSite/Secure-in-production cookies.
- Atomic shared PostgreSQL rate limits, exact-Origin mutation checks, bounded JSON bodies, safe normalized API errors and correlation IDs.
- Persisted organizations/members/workspaces/brands. Role guards and tenant-scoped repository transactions; composite tenant foreign keys and database role/state constraints.
- Resumable 15-step onboarding, optimistic revisions, normalized Brand Brain rows, explicit completion and read-only completed summary. Existing completed Brand Brain editor is still to be added.
- Identity, Brand Brain and rate-limit schema: 37 tables with four SQL migrations. Initial migration's index-before-FK ordering was repaired before its first successful application; subsequent migrations are additive.
- Typed provider contracts for all requested provider categories; SMTP and OpenAI Responses adapters are implemented; OpenAI has contract tests but no live paid call.
- Local PostgreSQL 17, Redis 7 and Mailpit Compose stack is running. Separate PostgreSQL 16 container was used for initial integration/E2E development.
- CI workflow runs migrations, all typechecks, lint, unit/integration tests, production build and Playwright E2E. Remote CI passed all stages, including database and browser tests, for commit 97f41ba (run 37195435512).

## Generation slice implemented

- Atomic immutable UsageLedger, separate AI_CREDITS/VIDEO_SECONDS, one trial per verified owner, database-backed pricing policies, concurrency-safe reservations/captures/releases, audit events.
- Durable jobs/outbox with BullMQ dispatcher, bounded exponential retries, database leases/fencing and heartbeat, recovery of lost queue delivery, authorization rechecks and safe terminal release.
- OpenAI Responses adapter with explicit model/key configuration, strict structured schema and bounded orchestrator repair/fallback. Provider usage recorded independently of user credits; unknown provider cost stays null. Explicit local/CI mock is blocked in production.
- Append-only strategies with 30-day plans, ideas/scoring, script generation/edit actions, manual editor, version history and version-specific approval. Tenant-authorized APIs, responsive content studio and polling progress.
- No OpenAI key created; no live paid provider call. Other integrations and full MVP remain incomplete.

## Verification evidence

- Typecheck for all 9 workspace packages and test sources passed.
- ESLint passed.
- 34 tests in 7 Vitest files passed against real PostgreSQL 17. Coverage: role policy, foreign-key tenant isolation, concurrent token consumption, sessions/password reset, stale login prevention, atomic rate limits, normalized onboarding and revision conflicts.
- 2 Playwright tests passed in installed Chrome: register → SMTP email → verify → login → organization → brand → 15 onboarding steps → save/reload/resume → Brand Brain → starter credits → strategy/30-day plan → ideas → script → manual edit/version history → approval → mobile logout, plus CSRF/anonymous request rejection. HttpOnly/SameSite cookie assertions and no browser page errors.
- Agent-browser verified homepage renders, navigation exists and no Next error overlay/browser errors. Desktop/mobile dashboard screenshots visually inspected; mobile overflow check passed.
- Production Next.js build passed for implemented routes.
- Browser tests caught and fixed Strict Mode token clearing and textarea label association after reload.

## Full objective still outstanding

- Durable mail delivery and cleanup, OAuth authentication extensibility/flows, team invitations/role management and agency clients.
- Extend the implemented text-job engine to video, publishing and webhooks, including external-operation reconciliation and provider pricing configuration.
- Official documentation research and real adapters for HeyGen, captions/media, S3, YooKassa, YouTube/TikTok/Meta/VK/Telegram; credentials and provider approvals as applicable.
- Remaining AI workflows beyond strategy/ideas/scripts; content calendar with drag/drop and downstream content transitions.
- Consent/revocation, avatars/looks/voices, video state machine, FFmpeg processing, captions editor, cover studio, B-roll and media library.
- Social OAuth token encryption/refresh, publishing approval/autopilot, UTC scheduler, verified/idempotent webhooks, publication status and normalized/raw analytics.
- AI recommendations with acceptance, comments/reply safety modes, funnels/UTMs, subscription billing/plans/renewal and financial dashboards.
- Admin/support/audit UI, notifications, privacy export/deletion workflows, encryption/rotation, signed media URLs, feature flags, Sentry-compatible implementation, readiness/provider monitoring.
- Complete development seed, full requested E2E beyond onboarding, remaining adapter/webhook/media/publishing tests, platform-wide security and architecture review.
- Production Docker images/release flow, GLOBAL/RU deployment configuration and infrastructure, backups/restore verification, production credentials.
- Vercel deployment and verification. No deployment has happened; scaffold/partial functionality is not represented as the finished product.

## Source and hosting

Git remote origin: https://github.com/kredavto/contentos-ai. User selected Vercel for web/BFF. Connected Vercel team: Yuriy / digagency (team_T4Jm4ASQqZgd6ys8grG6emG4). Persistent BullMQ/FFmpeg worker requires a separate host. RU_DATA_RESIDENCY remains a separate Russian infrastructure profile.

## Next concrete slice

Continue with consent/revocation, HeyGen adapter, S3 media storage and video state machine/FFmpeg. Research official APIs first. Keep the complete original scope intact.

## Local environment notes

Bundled Node: /Users/urijlebedinskij/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node. Add its directory to PATH for tools. Bundled pnpm is 11.19.0; invoke `pnpm dlx pnpm@10.30.3` for project-pinned installs. Task-owned development web server was stopped after tests. PostgreSQL 16 test container remains on 55432; the main Compose stack uses PostgreSQL 17 on 5432 and Mailpit on 1025. Application development uses port 3100; isolated E2E uses 3187 and a test SMTP sink on 1026/8026. Port 3000 is used by another local project and must not be stopped or reused.

Docker public pulls initially hung in docker-credential-desktop. Task-owned hanging helpers were stopped; public pulls succeeded using an isolated empty Docker CLI config at /tmp/contentos-docker-public with the existing Docker socket. User credential configuration was not changed. Compose stack subsequently started normally with cached images.

## Repository and dependency follow-up

- Full source pushed to GitHub main (97f41ba); CI run https://github.com/kredavto/contentos-ai/actions/runs/37195435512 passed every required step.
- CLI OAuth lacks workflow scope. Connected GitHub connector has workflow permission: initial CI file was created through it, then local history merged and source pushed normally. Future workflow edits may need connector update_file followed by fetch/merge. No user credential settings changed.
- Production dependency audit found vulnerabilities in initial Nodemailer 7. Upgraded to Nodemailer 10.0.14 (bundled types), confirmed `pnpm audit --prod`: no known vulnerabilities. SMTP registration/verification E2E re-passed in a fresh server against PostgreSQL 17 after upgrade; dedicated test port avoids unrelated projects. Follow-up committed as 7a1d85b. Generation slice commit/remote CI pending.
