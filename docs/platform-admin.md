# Platform operator console

`/admin` is a server-authorized platform console, separate from organization roles. Organization OWNER/ADMIN membership never grants access. The deployment gate `PLATFORM_ADMIN_ENABLED` defaults to false. An operator also needs a current, unrevoked `platform_operators` record and an enabled, email-verified account. Every API operation rechecks these conditions under database locks. The dashboard shows the admin link only after a server-side access check.

## Provisioning

A trusted host operator provisions an existing verified user by UUID through the explicit CLI. There is no web signup, email allowlist or HTTP endpoint that grants operator rights. Run against the intended database environment:

```
pnpm admin:operator --mode grant --userId <USER_UUID> --role SUPPORT --ticket OPS-123
pnpm admin:operator --mode revoke --userId <USER_UUID> --role SUPPORT --ticket OPS-124
```

The role argument is required by the command; revocation audits the existing stored role. SUPPORT and ADMIN share read and session-revocation capability. Only ADMIN can publish plan versions, as described below. Provider, job reconciliation and HTTP permission-management actions remain unimplemented. The command takes a user lock before changing operator state and records a HOST_OPERATOR audit event with target UUID, role and ticket. It prints no database credentials or exception details. Real accounts were not granted operator rights during development; tests use synthetic accounts.

## Read projections

The console has bounded, cursor-paginated views of users, organizations, jobs/failures, subscription terms, plan versions, usage ledger entries, webhook events, social connection status, AI call costs/models, organization flags, audit headers, email delivery status, payment tasks and support actions. Applicable views can filter by organization UUID; users can filter by user UUID. Cursors use timestamp/UUID ordering and limits cannot exceed 50 rows.

Queries explicitly select allowed fields. Password hashes, session/token hashes, credentials/envelopes, raw webhook or payment data, AI inputs/outputs, email payloads and job error messages are excluded. Authorized operators can see account names/emails for support. Audit views omit arbitrary metadata. Successful data/configuration reads are themselves audited without query text or content. Unknown AI cost remains null. A separate financial evidence report adds confirmed receipts, recorded cost attribution and resource captures; gross-margin and full per-video economics still require complete expense data. See [financial reporting](financial-reporting.md).

Provider status labels report configuration presence only, never measured remote health. Only named provider/model/status fields are passed to the browser; the environment is not serialized. Complete readiness probing, model routing administration and financial aggregation remain separate work.

## Support action

POST `/api/admin/revoke-sessions` validates target UUID, a constrained reason, ticket reference and idempotency UUID. Common authentication, exact-Origin validation, body limits and mutation throttling apply. Operator-scoped advisory locking serializes intent lookup. The transaction rechecks operator access, locks the target user, deletes existing sessions and atomically writes a result plus audit event. Retry of the same actor/intent returns the original result and does not revoke later logins. Changed intent under the same key is rejected. This does not change passwords, disable users or cancel requests already in progress.

Support cannot target its own or another operator account, including previously provisioned operator accounts. Those users use the existing self-service revoke-all-sessions/password-reset flow; account recovery beyond that requires trusted host operations. A second operator lookup after the target lock fences concurrent role provisioning. User-before-operator lock ordering matches the CLI. Action rows cannot be updated in the database; application paths are append-only. Account erasure/pseudonymization still needs to account for administrative action references in the broader privacy workflow.

Migration 0035 adds operator/action records, role/reason/count constraints, actor-scoped unique request keys and an action-update guard. Tests use real PostgreSQL, including CLI provisioning, denied tenant owners, stale/revoked access, safe projections, unknown costs, pagination and concurrent/replayed session revocation. Browser verification covers the guarded navigation, user search, CSRF denial, actual session invalidation and audit-action visibility.

## Versioned tariff publishing

`GET /api/admin/plans` returns all five configured plan codes, including plans with no version (version 0). SUPPORT and ADMIN can read this projection. `POST /api/admin/plans` requires the current platform ADMIN role, the deployment gate, a verified/enabled account and the normal session/Origin checks. Tenant ADMIN/OWNER have no platform authority.

The strict request contains code, name, enabled, expectedVersion, amountMinor (integer kopeks), currency RUB, aiCredits, videoSeconds, ticket and idempotencyKey. Paid prices must be positive; FREE must be zero. All price/resource values are bounded at 1,000,000,000. There are no operator-supplied provider credentials in this API.

Publishing locks the plan row, compares the latest version and inserts a new immutable plan version. This includes availability/name changes, so every UI change advances the expected version. Checkout takes a shared lock on the same row; it cannot accept a stale new quote after publication. An actor-scoped idempotency record in `platform_plan_changes` freezes the result, display name, enabled state and ticket. Reusing a key with changed fields is a conflict; replaying it after later changes returns the original result, after rechecking operator authority. An audit row is written atomically. Both pricing versions and change records reject UPDATE/DELETE through database triggers.

Existing orders, paid periods, credit grants and accepted renewal consents retain their original version/amount/limits. An already-created order can still settle after a catalog change. Automatic renewal uses the consent's original price and limits, not the latest catalog price. Disabling a plan prevents new checkout and scheduling new renewals; it does not cancel already-created payment tasks or paid periods. Re-enabling permits scheduling again under the existing renewal eligibility window. FREE is a catalog configuration only: payment checkout excludes it, and this editor does not change the separate trial-grant policy.

The browser form displays units, requires an operator change ticket and confirms the complete proposed price/limits/availability before publishing. A failed/uncertain response retains the request key; reload explicitly discards unsaved fields. On a version conflict, reload the current catalog before issuing another change. No real prices were selected or enabled as part of implementation; integration/browser values are synthetic test-database fixtures.

Verified by PostgreSQL integration tests covering SUPPORT/tenant denial, strict validation, duplicate and concurrent different-operator requests, stale quotes, exact checkout replay, existing paid periods and in-flight settlement, immutable history, disabling/re-enabling and revoked operator replay. Browser verification covers read-only SUPPORT, ADMIN publication, CSRF rejection and reload persistence.
