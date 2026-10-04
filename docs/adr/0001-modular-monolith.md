# ADR 0001: modular monolith with durable worker

Accepted. Use Next.js Node runtime, PostgreSQL/Drizzle, Redis/BullMQ and S3. Keep domain modules together for transaction safety and straightforward operations; keep long-running provider/media work outside HTTP. Provider contracts live independently of adapters. Use DB outbox to avoid losing a queued operation between DB commit and Redis write. Tenant ownership is enforced in service/repository queries and composite foreign keys; add PostgreSQL RLS where connection context can be reliably transaction-scoped. Never claim isolation based on UUID unpredictability.

Email/password auth uses scrypt hashes and hashed random sessions; verification/reset tokens are single-use and expire. Admin privilege is separate from organization roles. Billing uses integer units, append-only entries and row locking. Approval is the default publication policy.

Deliver working vertical slices with actual persistence. Unsupported integrations remain explicitly unavailable until an official adapter and contract tests exist. Docker is the portable release unit; GitHub is source/CI, not the application runtime. No hosting account or billable resource is assumed.
