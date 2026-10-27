# CONTENTOS AI

AI content operations SaaS with a Russian-first interface. The implemented workflow covers accounts → organization/brand → 15-step Brand Brain → strategy/ideas/scripts → consent-bound avatar and video generation → reviewed subtitles and MP4 approval → calendar → approval-based Telegram publishing → analytics → reviewed AI strategy recommendations.

**Release status: IN DEVELOPMENT · live integrations: UNVERIFIED · production: NOT DEPLOYED.** Implementation and automated fixture tests do not prove live provider delivery or commercial readiness. See [development stage labels](#development-stages), [detailed readiness](docs/READINESS.md) and [implementation evidence](docs/IMPLEMENTATION_STATUS.md).

Source: [kredavto/contentos-ai](https://github.com/kredavto/contentos-ai). Web deployment target: Vercel team digagency. Persistent BullMQ/FFmpeg work requires a separate worker service, PostgreSQL, Redis and private S3 storage.

## Development stages

Labels describe the **named scope**, not the entire specification: **IMPLEMENTED** = connected application workflow; **PARTIAL** = part of the stage works; **PENDING** = required work remains; **NOT DEPLOYED** = no production release. External-provider workflows remain **LIVE UNVERIFIED** until tested through the application against real services. These labels are not completion percentages.

| Stage | Readiness | Implemented scope and remaining gate |
| --- | --- | --- |
| 0. Engineering foundation | IMPLEMENTED | Monorepo, strict types, database migrations, durable jobs/outbox, CI. Production release infrastructure remains in stage 9. |
| 1. Accounts and brand onboarding | PARTIAL | Email verification/reset, sessions, tenant roles, organizations/brands and 15-step onboarding work. Completed Brand Brain editing, invitations and team/agency management remain. |
| 2. Strategy, ideas and scripts | IMPLEMENTED · LIVE UNVERIFIED | Versioned strategy/ideas/scripts, editing and approval, metered AI generation. Additional audience/competitor/trend workflows remain outside this slice. |
| 3. Photos, avatars and public voices | PARTIAL · LIVE UNVERIFIED | Private photo lifecycle, consent-bound HeyGen avatars and public voice selection. Private voice cloning/import and operator investigation remain. |
| 4. Video and subtitles | PARTIAL · LIVE UNVERIFIED | Durable video jobs, real FFmpeg, reviewed manual/automatic captions, private MP4/cover frame, approval and deletion. Cover Studio, B-roll, music and richer editing remain. |
| 5. Calendar and publishing | PARTIAL · LIVE UNVERIFIED | Calendar, encrypted Telegram connections, explicit approval, scheduling and saved acknowledgements. Other social platforms and operator resolution remain. |
| 6. Analytics and AI recommendations | PARTIAL · LIVE UNVERIFIED | Manual publication observations, requested background channel counts, durable AI reports and explicit recommendation decisions. Automatic post metrics and recurring collection remain. |
| 7. Payments and subscriptions | PENDING | Usage ledger and trial credits exist; YooKassa payments, subscriptions, renewals and financial dashboards remain. |
| 8. Operations, teams and privacy | PARTIAL | Role guards, audit records and consent evidence exist. Admin/support UI, notifications, privacy export/deletion and full team/agency flows remain. |
| 9. Production launch | NOT DEPLOYED | Live provider verification, web/worker deployment, monitoring, backup/restore and a live end-to-end acceptance run remain. |

The full MVP is **not complete**. The section 170 acceptance chain in [TECH_SPEC.md](TECH_SPEC.md) must work with live services; a mocked browser run alone does not close that gate. Detailed boundaries and criteria for advancing labels are in [READINESS.md](docs/READINESS.md).

## Local development

Requires Node.js 22+ (24 used in CI), pnpm 10.30.3 and Docker.

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

Open http://localhost:3100. Register with a fictional address and read its confirmation email in [local Mailpit](http://localhost:8025). Passwords require 12–128 characters. After confirmation, sign in, create an organization/brand and complete onboarding. Each step can be saved and resumed. Brand Brain is stored as structured PostgreSQL rows. Set `AI_PROVIDER=mock` in your local `.env` for an explicitly marked demo walkthrough, then restart `pnpm dev`. Open the completed brand, claim starter credits, create a strategy, ideas and a script, edit it and approve a version. Web and the actual worker run together. For real text generation, configure `AI_PROVIDER=openai`, `OPENAI_API_KEY` and `OPENAI_MODEL` server-side on both services; no live provider test has been performed.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For database integration and browser tests, use a dedicated PostgreSQL database ending in `_test`. Never point tests at real customer data. Create it in local Docker, then:

```sh
docker compose exec postgres createdb -U contentos contentos_test
export TEST_DATABASE_URL=postgresql://contentos:local-development-only@localhost:5432/contentos_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

The integration suite runs when TEST_DATABASE_URL is present; otherwise it is explicitly skipped. Playwright requires it and starts a loopback SMTP sink (1026/8026), an S3 transport fixture (8027), and the web server on port 3187. Stop any existing development server before running E2E. Use PLAYWRIGHT_CHANNEL=chrome for an installed Google Chrome. CI runs migrations, typecheck (including tests), lint, unit/integration tests, production build and E2E.

## Publishing and performance analysis

Telegram supports explicitly approved text posts and MP4 short videos through the durable scheduler. Connections use encrypted server-side tokens and channel-rights checks. Unknown send outcomes enter reconciliation instead of automatic replay. Instagram, TikTok, YouTube and VK adapters remain pending. See [publishing](docs/publishing.md) and [connections](docs/social-connections.md).

Analytics separates manually entered publication metrics from whole-channel Telegram membership counts. AI performance reports use frozen evidence, capture credits atomically, and require an explicit acceptance/rejection; acceptance creates a strategy version and does not change Brand Brain. `ANALYTICS_AI_ENABLED` defaults off and must be enabled on both web and worker with the existing AI configuration. Automatic publication metrics, audience breakdowns and recurring collection remain pending. See [performance analysis](docs/performance-analysis.md) and [channel analytics](docs/channel-analytics.md).

## Architecture

[Architecture](ARCHITECTURE.md) · [Data model](DATA_MODEL.md) · [Security](SECURITY.md) · [Providers](PROVIDERS.md) · [Deployment](DEPLOYMENT.md) · [Environment](ENVIRONMENT.md) · [Engineering rules](AGENTS.md).

## Private photo library

The brand content studio includes a Media tab for private photo uploads, short-lived previews and durable deletion. Configure the same private S3 bucket on web and worker using `.env.example`. Details and limits: [media storage](docs/media-storage.md). Without storage credentials the UI reports that configuration is required. Avatar/video jobs use the same storage and durable worker. See ENVIRONMENT.md for video configuration.
