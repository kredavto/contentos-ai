# Scoped feature rollout policies

`feature_policies` provides operator-controlled GLOBAL, PLAN, ORGANIZATION and USER rules for the twelve feature names in specification §99. This is rollout configuration, not RBAC, a tariff quota, consent, provider configuration or user opt-in. An ENABLED rule cannot connect an unimplemented integration, bypass an environment switch, spend unavailable credits or authorize an otherwise forbidden operation.

## Resolution

The highest specific non-INHERIT rule wins: USER → ORGANIZATION → PLAN → GLOBAL → DEFAULT. A user rule applies to that user's actions in any organization where the user already has the required current membership/role. The plan is taken from the one settled subscription term current at PostgreSQL transaction time. Expired/future terms do not apply; without a current term, the FREE plan identity is used. Multiple overlapping current terms fail explicitly instead of arbitrarily selecting an entitlement. Plan policies refer to plan identity, not mutable prices or a rewrite of immutable purchased terms.

INHERIT removes that scope's override while retaining evidence. Default rollout policy preserves existing eligibility for all names except autopilot, whose default is disabled. These defaults do not imply functional/provider readiness: unsupported trends/Instagram/TikTok/autopilot remain unavailable in their existing implementation/configuration boundaries. GLOBAL DISABLED can be overridden by a more specific explicit rule; server environment switches remain the absolute deployment boundary.

GET `/api/v1/organizations/:tenantId/features` derives the user exclusively from the current session and checks membership before returning name, enabled and source for each rule. It returns no target identities, operator metadata, credentials or private content. Normal no-store responses and a per-user read budget apply.

## Operator changes

GET `/api/v1/admin/feature-policy?feature=...&scope=...&targetId=...` inspects one explicit target and at most ten recent changes, with a has-more indicator. GLOBAL omits targetId; other scopes require a UUID pointing to an existing plan, organization or user. Current verified/enabled SUPPORT and ADMIN operators may inspect; tenant ownership alone grants no operator access. Successful reads record safe audit evidence.

POST to the same path requires current ADMIN authority, PLATFORM_ADMIN_ENABLED, session/Origin checks, the shared mutation budget and a specific write budget. Strict input binds feature/scope/target, ENABLED/DISABLED/INHERIT, expectedRevision, an idempotency UUID and an ASCII ticket reference. There is no force edit. A row lock plus the unique scoped key serializes competing first writes and later edits; actor/key advisory serialization deduplicates intent across targets. Replaying an old accepted key returns its receipt without reverting a newer revision. Changed input with the same key conflicts. Operator authority is checked again even for replay.

Migration 0094_scoped_feature_policies.sql is generated/reviewed and applied in disposable acceptance. It adds typed target FKs, scope-shape and mode constraints, NULLS NOT DISTINCT uniqueness (PostgreSQL 15+, project local target 17), indexed effective lookups and append-only change records. The database permits initial INHERIT/revision-zero stubs only. Every committed update requires the next revision and matching immutable change evidence for actor/mode/correlation. Target identities, history and deletion of policy records are protected. These retained references intentionally prevent the narrow resource-free account-erasure path from deleting policy evidence.

PLAN targets can be selected by name/code from the protected catalog, which now supplies an additive planId field. Other targets use their existing operator-visible UUIDs. The admin interface separates inspection from edits, requires an explicit scope/mode/ticket, retains retry identity after an uncertain response and refreshes the current revision/history after saving. SUPPORT controls remain read-only. Plain React text rendering avoids interpretation of ticket or history data as markup.

## Runtime boundaries

Admission checks apply to avatar/video creation, AI performance analysis, generated/manual comment replies and approvals, comment imports/delivery, Telegram/YouTube publishing approval, new BYOK storage/use and agency activation/client creation/restoration. Existing server readiness, membership, consent, immutable input, quota and provider-grant checks remain authoritative.

Queue checks apply before unsubmitted avatar/video creation, generic analytics/comment generation claim, comment-import pages, comment reply preparation and recorded send attempts, Telegram preparation/send marking, and YouTube initiation, chunk writes and thumbnail marking. User-scoped checks use the persisted requesting/approving user, never an arbitrary queue/body user ID. New policy checks do not hold a database transaction open across provider calls.

A policy is not cancellation of remote work. Transactions that already passed their check, an external request already in flight and continuation of an already submitted render can still finish. Known render-reference polling, confirmed result/usage settlement, read-only upload/session queries, historical comment receipt reconciliation, revocation, deletion, inspection and retained history must remain possible after disabling a feature. The processor records outcomes rather than losing evidence or blindly replaying uncertain non-idempotent writes. A fresh queued job denied before submission fails through its existing state machine and releases held generation credit where applicable.

## Acceptance

Acceptance results and any corrected failures are recorded in IMPLEMENTATION_STATUS.md. Focused storage covers current operator access, precedence/inheritance/isolation, real settled and expired plans, concurrent idempotency/revisions, immutable evidence and denied admission before resource/credit allocation. Worker regressions cover stopped unsubmitted avatar/Telegram work and retained in-flight receipts. Chromium exercises SUPPORT read-only, fresh ADMIN authority, actual scoped API denial, inheritance, ordinary role/source validation, safe history and mobile rendering. No real account, provider write or production configuration is used.

Latest local checkpoints: 814/815 passed in the full regression before one fixture correction; then 30/30 targeted policy/avatar/publishing tests and 36/36 browsers passed. The final plan-selector change passed 17/17 policy/pricing tests and 4/4 admin/policy browsers after fresh types/lint/build. See IMPLEMENTATION_STATUS.md for exact logs and boundaries.
