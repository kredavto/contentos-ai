# Local demonstration data

`pnpm db:seed` is an optional, insert-only development fixture command. Run migrations first. It does not run automatically on deployment, migration or app startup.

In your ignored local `.env`, set `NODE_ENV=development`, `CONTENTOS_DEMO_SEED=true` and `CONTENTOS_DEMO_PASSWORD` to a private password of 12–128 characters. Use the local Docker PostgreSQL `DATABASE_URL`, then run:

```sh
pnpm db:migrate
pnpm db:seed
```

Sign in as `demo@contentos.example.test` with that password. The fixture account is verified locally; no verification email is sent. There is no built-in/shared password and the command never prints the password, hash or database URL. Remove the seed password and opt-in from `.env` afterward. Do not expose this development environment publicly.

The command accepts only explicit development/test mode, loopback hosts and database `contentos` or names ending `_test`, without URL parameters/fragments. A loopback SSH tunnel can still reach a remote database: point this command only at your disposable local development database. Production mode and ordinary remote database URLs are rejected before a connection is opened.

## Included

- Fictional owner, organization, workspace and completed structured Brand Brain.
- Product, audience, pain, CTA, voice and content pillar.
- Versioned strategy with 30 distinct plan days, three ideas and an unapproved editable post script.
- Explicit `mock`/`development-seed-v1` synthetic idea-job evidence and an internally consistent fixture credit ledger (100 granted, one reserved/captured, 99 available).

All material is demonstration content, not externally researched or generated. Seed execution creates no outbox tasks, publishing jobs, connected social accounts, external requests or payments. It grants no video seconds. It does not alter provider configuration; subsequent user-triggered actions use the app's configured providers. Set `AI_PROVIDER=mock` for a fully local text walkthrough.

The whole seed is one transaction, serialized with a PostgreSQL advisory lock. The final audit marker records successful initialization. Repeated and concurrent runs create no duplicates and never reset passwords, disabled accounts, edits, versions or credits. Existing email/ID collisions fail and roll back; the command never adopts existing accounts. There is no destructive reset option. Start a fresh disposable database if you need pristine data.

Video projects and publication analytics are not included in this initial fixture: no fabricated media, consent or successful social publication is inserted. The existing fixture-backed browser chain exercises these workflows separately. Full seed coverage for media and analytics remains outstanding.
