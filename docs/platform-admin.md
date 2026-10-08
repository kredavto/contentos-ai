# Platform operator console

`/admin` is a server-authorized platform console, separate from organization roles. Organization OWNER/ADMIN membership never grants access. The deployment gate `PLATFORM_ADMIN_ENABLED` defaults to false. An operator also needs a current, unrevoked `platform_operators` record and an enabled, email-verified account. Every API operation rechecks these conditions under database locks. The dashboard shows the admin link only after a server-side access check.

## Provisioning

A trusted host operator provisions an existing verified user by UUID through the explicit CLI. There is no web signup, email allowlist or HTTP endpoint that grants operator rights. Run against the intended database environment:

```
pnpm admin:operator --mode grant --userId <USER_UUID> --role SUPPORT --ticket OPS-123
pnpm admin:operator --mode revoke --userId <USER_UUID> --role SUPPORT --ticket OPS-124
```

The role argument is required by the command; revocation audits the existing stored role. SUPPORT and ADMIN currently have the same read and session-revocation capability. Higher-risk plan/pricing, provider, job reconciliation and permission-management actions are not implemented by this slice. The command takes a user lock before changing operator state and records a HOST_OPERATOR audit event with target UUID, role and ticket. It prints no database credentials or exception details. Real accounts were not granted operator rights during development; tests use synthetic accounts.

## Read projections

The console has bounded, cursor-paginated views of users, organizations, jobs/failures, subscription terms, plan versions, usage ledger entries, webhook events, social connection status, AI call costs/models, organization flags, audit headers, email delivery status, payment tasks and support actions. Applicable views can filter by organization UUID; users can filter by user UUID. Cursors use timestamp/UUID ordering and limits cannot exceed 50 rows.

Queries explicitly select allowed fields. Password hashes, session/token hashes, credentials/envelopes, raw webhook or payment data, AI inputs/outputs, email payloads and job error messages are excluded. Authorized operators can see account names/emails for support. Audit views omit arbitrary metadata. Successful data/configuration reads are themselves audited without query text or content. Unknown AI cost remains null; this is a call-cost view, not a complete revenue/gross-margin dashboard.

Provider status labels report configuration presence only, never measured remote health. Only named provider/model/status fields are passed to the browser; the environment is not serialized. Complete readiness probing, model routing administration, pricing and financial aggregation remain separate work.

## Support action

POST `/api/admin/revoke-sessions` validates target UUID, a constrained reason, ticket reference and idempotency UUID. Common authentication, exact-Origin validation, body limits and mutation throttling apply. Operator-scoped advisory locking serializes intent lookup. The transaction rechecks operator access, locks the target user, deletes existing sessions and atomically writes a result plus audit event. Retry of the same actor/intent returns the original result and does not revoke later logins. Changed intent under the same key is rejected. This does not change passwords, disable users or cancel requests already in progress.

Support cannot target its own or another operator account, including previously provisioned operator accounts. Those users use the existing self-service revoke-all-sessions/password-reset flow; account recovery beyond that requires trusted host operations. A second operator lookup after the target lock fences concurrent role provisioning. User-before-operator lock ordering matches the CLI. Action rows cannot be updated in the database; application paths are append-only. Account erasure/pseudonymization still needs to account for administrative action references in the broader privacy workflow.

Migration 0035 adds operator/action records, role/reason/count constraints, actor-scoped unique request keys and an action-update guard. Tests use real PostgreSQL, including CLI provisioning, denied tenant owners, stale/revoked access, safe projections, unknown costs, pagination and concurrent/replayed session revocation. Browser verification covers the guarded navigation, user search, CSRF denial, actual session invalidation and audit-action visibility.
