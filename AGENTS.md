# CONTENTOS AI engineering contract

## Architecture
TypeScript pnpm/Turborepo monorepo. `apps/web` is the Next.js App Router UI/BFF; `apps/worker` executes BullMQ jobs. Packages: `db` (Drizzle schemas, migrations, repositories), `core` (domain services, authorization and state machines), `ai` (validated deterministic workflows), `providers` (external adapters), `ui`, `config`, `types`.
Dependencies flow UI → route → service → repository/provider. No direct provider calls from UI. No provider calls outside provider layer. Provider contracts use internal UUIDs plus provider/external_id/metadata mappings. Brand Brain is structured source data, not a prompt blob.

## Standards
TypeScript strict mode, no unchecked indexed access, explicit boundary validation with Zod, no implicit `any`. PascalCase types/components, camelCase functions, kebab-case modules, snake_case database fields. Small domain modules; typed errors with safe public messages. No swallowed errors or simulated production success. Prices and product name are configuration, not UI constants.

## Data and migrations
UUID primary keys; timestamptz UTC timestamps. Every tenant repository operation requires authenticated tenant context. Composite tenant foreign keys prevent cross-tenant relationships. Commit additive, numbered SQL migrations generated/reviewed with Drizzle; never edit an applied migration or use schema push in production. Use transactions for authorization-sensitive state transitions and ledger operations. Version strategies/scripts append-only.

## Security
No secrets in repository, fixtures, logs, browser bundles or error responses. Validate server environment once. Public configuration has an explicit allowlist. Encrypt OAuth/provider credentials with versioned authenticated encryption keys; support rotation. Sessions are random, hashed at rest, expiring and revocable, with HttpOnly/Secure/SameSite cookies. Check Origin for cookie-authenticated mutations. Hash passwords using a memory-hard KDF. Rate-limit auth and expensive endpoints. Deny unknown roles/actions. Audit security and administrative mutations without sensitive payloads. Use short-lived signed media URLs. Verify webhook origin per official provider capabilities before acting.

## Reliability and billing
Mandatory idempotency for payments, webhooks and publishing jobs. Store webhook receipts before processing. DB outbox bridges database commits and BullMQ delivery. Jobs use stable IDs, bounded retries, exponential backoff, timeouts and correlation IDs. Remote non-idempotent operations with uncertain outcome require reconciliation, never blind replay. Immutable usage ledger is authoritative; reserve before expensive operations, capture success, release final failure under a database lock. Never treat absent analytics as zero.

## Consent and approval
Require current subject-scoped consent before likeness/voice operations; recheck during execution. Revocation blocks pending work. Approval publishing is default; autopilot and auto-reply require explicit opt-in and feature flags. AI recommendations never silently mutate permanent Brand Brain.

## Testing and delivery
Run typecheck, lint and tests for each substantial slice. Test permissions, tenant isolation, concurrent ledger operations, webhook deduplication, retries and adapter contracts. CI mocks external providers only; production adapters must be real. Test the full MVP chain with Playwright. Do not claim a check passed without running it. Keep progress and remaining work in `docs/IMPLEMENTATION_STATUS.md`. Production integrations without credentials must report CONFIGURATION_REQUIRED. Review OWASP risks before deployment. Do not deploy broken main.

## Environment and operations
`.env.example` contains placeholders/local-only defaults; `.env*` is ignored except the example. Runtime secrets come from secret stores. Structured JSON logs redact secrets. Docker profiles separate local dependencies, web and worker. GLOBAL and RU_DATA_RESIDENCY placements must be explicitly configured; the RU profile is infrastructure placement, not a legal compliance guarantee.
