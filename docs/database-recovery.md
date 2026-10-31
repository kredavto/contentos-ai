# Local PostgreSQL recovery rehearsal

Run with the pinned Node/pnpm versions and a local Docker engine:

```sh
pnpm test:local --recovery
# Include the production web build and full browser MVP afterward:
PLAYWRIGHT_CHANNEL=chrome pnpm test:local --recovery --e2e tests/e2e/onboarding.spec.ts
```

The rehearsal is opt-in and runs after migrations, typecheck and lint, before regression/browser workers. The runner owns a fresh PostgreSQL 17 container and ignores supplied database URLs. The recovery entry point is internal to this runner; do not point it at development or production services. No new migration is required.

The rehearsal creates a source database from the freshly migrated test template and seeds explicitly synthetic Brand Brain, strategy/script history, audit, job and usage-ledger evidence. Credits include captured, released and held reservations; a second tenant supports the cross-tenant constraint probe. No provider is contacted. The generated archive stays inside the disposable PostgreSQL container and is removed with that container and its volume.

It then performs these checks:

1. Take a custom-format `pg_dump` backup of the source and restore it into a separately created `template0` database with `pg_restore --exit-on-error --single-transaction`.
2. Compare the restored schema with an independent reference database built from the source’s separate schema-only dump. PostgreSQL reparses expressions on restore and can flatten redundant AND parentheses, so the reference gives both sides the same parsing step without weakening CHECK expressions. Complete schema dumps include constraints, indexes, triggers, functions and ownership/grants present in the database. Only random psql restriction-token lines are excluded from textual comparison.
3. Compare sorted row fingerprints and row counts for every application and migration table in `public` and `drizzle`, plus sequence values and `is_called`. Empty tables are included. Row contents, credentials and fingerprints are not printed.
4. Run the ordinary migration entry point against the restored database and verify that data and schema remain unchanged.
5. Prove that ledger updates and script-history deletion are rejected, a cross-tenant content relationship is rejected, held credits settle exactly once under two concurrent calls, and restored content can be approved through the repository.
6. Confirm that the source still matches its original snapshot. Only after all probes pass is a `database_recovery_verified` event emitted, with counts and elapsed milliseconds.

Command failures, fingerprint/schema mismatches or failed integrity probes fail the entire local run. PostgreSQL utility calls and migration replay have two-minute timeouts. Existing runner cleanup covers success, failure and SIGINT/SIGTERM, including the archive, schema file and all three recovery databases. See [cleanup limitations](local-verification.md) for host crashes/SIGKILL. Utility stderr and fixture row contents are not included in command-failure messages.

This is a small-fixture recovery regression, not an operational backup service or an RPO/RTO commitment. It runs without source writers, uses the same PostgreSQL major version and role, and does not cover large datasets, concurrent production traffic, cluster-global roles/tablespaces, extensions requiring external software, PITR/WAL, encrypted off-site retention, object storage, credential encryption keys, or restoration into independently provisioned production infrastructure. Most application tables are empty in this fixture; their definitions are compared, but populated recovery scenarios are not claimed for every module. The final MVP browser run uses the runner's regular test database, not the restored fixture.

Production recovery still requires coordinated database/object-store/key backups, access-controlled encrypted storage, retention and monitoring, documented RPO/RTO, and a timed restore into isolated infrastructure. Keep workers/schedulers disabled during such a drill: restored pending jobs, outbox records and uncertain remote submissions require reconciliation before external side effects resume.

PostgreSQL command references: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
