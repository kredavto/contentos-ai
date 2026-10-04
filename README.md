# CONTENTOS AI

AI content operations SaaS. Implemented: email/password accounts, verified email, password reset, revocable sessions, organizations, brands and a persisted 15-step Brand Brain onboarding. AI generation, videos, billing and publishing are still in development. See [coverage and gaps](docs/IMPLEMENTATION_STATUS.md).

Source: [kredavto/contentos-ai](https://github.com/kredavto/contentos-ai). Web deployment target: Vercel team digagency. Long-running media/queue work requires a separate worker service. No production deployment yet.

## Local development

Requires Node.js 22+ (24 used in CI), pnpm 10.30.3 and Docker.

```sh
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. Register with a fictional address and read its confirmation email in [local Mailpit](http://localhost:8025). Passwords require 12–128 characters. After confirmation, sign in, create an organization/brand and complete onboarding. Each step can be saved and resumed. Brand Brain is stored as structured PostgreSQL rows. Current worker entry is scaffold-only; generation is not advertised as working.

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

The integration suite runs when TEST_DATABASE_URL is present; otherwise it is explicitly skipped. Playwright requires it and starts a loopback SMTP sink (1026/8026) plus the web server. Stop any existing development server before running E2E. Use PLAYWRIGHT_CHANNEL=chrome for an installed Google Chrome. CI runs migrations, typecheck (including tests), lint, unit/integration tests, production build and E2E.

## Architecture

[Architecture](ARCHITECTURE.md) · [Data model](DATA_MODEL.md) · [Security](SECURITY.md) · [Providers](PROVIDERS.md) · [Deployment](DEPLOYMENT.md) · [Environment](ENVIRONMENT.md) · [Engineering rules](AGENTS.md).
