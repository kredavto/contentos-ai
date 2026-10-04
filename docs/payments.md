# Payments and monthly subscriptions

Status: implementation in progress. No checkout, renewal, provider settlement or payment-based credit grant is enabled yet. Existing trial credits remain separate. Production requires merchant credentials and receipt configuration; missing configuration must never simulate payment success.

## Domain and consistency decisions

Plans FREE, START, CREATOR, EXPERT and AGENCY have database-owned, immutable price/entitlement versions. UI displays server quotes rather than hardcoded prices. Checkout is restricted to a verified organization OWNER. A transaction locks the organization, validates the current quote and records an immutable order with exact integer minor units, currency, plan version, actor, consent and idempotency key before dispatching a durable payment task. A reused intent with different content conflicts.

Payments are organization-scoped, not brand-scoped, so they need their own durable task/outbox rather than fabricating a brand or usage reservation to fit generation jobs. A payment attempt keeps its provider, merchant identity, test/live mode, internal order reference and stable provider idempotency key. Its first-send timestamp and immutable request hash determine a conservative 23-hour replay deadline. Network/5xx/invalid-response uncertainty never creates a fresh payment key. After the replay deadline, an unknown submission requires reconciliation. Known IDs can always be read without creating a new charge.

A redirect back to the application proves nothing about payment. Webhook receipts are saved before processing and deduplicated by provider object/event type when no event UUID exists. An authenticated provider read must match the stored external payment ID, internal order reference, merchant, test/live mode, exact amount and currency. Only a paid SUCCEEDED observation can settle. Unsupported or contradictory states must not grant anything. Settlement locks the tenant and atomically appends the immutable settlement, paid subscription term, one PURCHASE entry per nonzero entitlement unit and audit event. Unique payment/term/ledger keys fence duplicate or reordered notifications.

An automatic renewal requires explicit, versioned consent covering amount, monthly cadence and cancellation, plus a saved provider method. Method references remain server-side and encrypted; card numbers/CVC are never accepted or stored. Cancellation changes future renewal eligibility, not the paid term. A queued renewal rechecks consent/cancellation under lock before its send marker. Cancellation after an external send cannot pretend to reverse that payment; its final outcome must be reconciled.

Monthly boundaries use a stored UTC anchor date and original day of month. Clamp only the individual target month (31 January → 28 February → 31 March), without permanent drift. A successful late renewal starts no earlier than the actual paid activation time; missed periods do not silently create multiple charges. Downgrade is scheduled for the next term. Upgrade is an explicit new quote and payment; existing paid value needs a deterministic disclosed credit/proration policy before enabling the action. No speculative renewal or unconfigured prices may be enabled.

## Provider research (2026-10-04)

Official sources: [interaction format](https://yookassa.ru/developers/using-api/interaction-format), [quick start](https://yookassa.ru/developers/payment-acceptance/getting-started/quick-start), [notifications](https://yookassa.ru/developers/using-api/webhooks), [saving a method](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/save-payment-method/save-during-payment), [recurring payments](https://yookassa.ru/developers/payment-acceptance/scenario-extensions/recurring-payments/pay-with-saved), [receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/payments), [refunds](https://yookassa.ru/developers/payment-acceptance/after-the-payment/refunds).

YooKassa v3 uses server-side Basic authentication and Idempotence-Key for mutations. Its replay window is 24 hours; a 500 response is not proof of failure. Redirect checkout uses capture=true. Payment confirmation must come from the provider state, not the browser. Do not invent a webhook HMAC. Recurring payments require shop activation and user consent. Receipt fields and merchant tax settings must be explicitly configured and validated before live checkout; no guessed tax values.

## Required verification before enabling

Provider contract tests must cover exact decimal money conversion, merchant/mode/reference mismatch, saved-method handling, response size/time limits, redaction and uncertain outcomes. Real PostgreSQL integration tests must cover tenant permissions, concurrent checkout/settlement, replay conflicts, webhook deduplication, expiry, cancellation versus send, term boundaries and no duplicate credit grants. Browser tests must exercise quoted prices, external confirmation using explicit development fixtures, persisted plan/credits, cancellation and scheduled changes. No real charge is needed for CI.

## Implemented YooKassa transport

The adapter supports redirect checkout, saved-method renewal, authenticated payment reads, refund creation and refund reads. The payment contract now includes merchant/test identity and paid status, rather than treating a bare status string as sufficient evidence. Saved method IDs are returned only for paid, saved methods; all card details and raw provider payloads are dropped. Receipt registration status is retained separately from payment success.

Each call is one bounded HTTP attempt to the fixed v3 API host, with redirects disabled, a 30-second timeout and a 128 KB response limit. Mutations require the original submission timestamp and stable UUID key; replay at or after 23 hours is refused. The worker must persist this timestamp/key and immutable request before first send. A definitive rejection describes this HTTP attempt only: if an earlier attempt was uncertain, a later rejection must not be interpreted as proof that no original charge exists.

Checkout return URLs must use the configured application HTTPS origin. Confirmation URLs must be HTTPS on YooMoney/YooKassa domains. Identity mismatches, malformed success responses and uncertain sends require reconciliation. Logs contain only operation, correlation/job IDs, status and duration; never credentials, receipt email, card details or saved method IDs.

The first receipt contract supports a single subscription item, full payment, a reviewed service/intellectual-activity classification, explicit VAT code and optional tax-system code. It is intentionally not a general merchandise/prepayment receipt engine. Production activation must verify the merchant's fiscal setup fits this contract; otherwise implement the required receipt lifecycle before accepting money. No tax classification is selected by default.

Configuration parsing and the provider factory require explicit mode and server credentials. PAYMENTS_ENABLED defaults false; PAYMENT_PROVIDER defaults disabled. Test mode cannot enable payments in production. The factory and adapter are not yet wired to checkout routes or the worker, so setting environment variables alone does not enable a payment flow.

Additional official references checked: [receipt parameter values](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/other-services/parameters-values), [refund receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds), [documented request paths in event logs](https://yookassa.ru/docs/support/merchant/payments/logs). No third-party SDK or undocumented endpoint is used.

Refund requests distinguish FULL (omit receipt; provider reuses the original receipt) from PARTIAL (supply the reviewed receipt for the refunded subscription amount). The future refund repository must enforce this classification against the original immutable payment and prior refunds under a lock. Both payment and refund reads retain receipt registration status for later monitoring; a successful payment alone does not establish successful fiscal registration.

## Implemented persistence foundation

Migration 0021 adds plans, immutable price/entitlement versions, immutable tenant orders, unique provider-payment mappings and immutable settlement evidence. Five plan codes are seeded disabled without invented prices. Database triggers reject changes to financial history and mismatched payment/settlement identities. A provider payment can map to only one order in a merchant/test scope.

BillingRepository checkout is verified-OWNER-only, snapshots a current enabled quote and receipt input, and serializes exact client-intent replay under the tenant lock. Changed intent or outdated quotes conflict. Payment settlement is an internal worker boundary accepting only an authenticated observation; it validates order identity/amount/mode, locks the tenant and atomically inserts payment, settlement, both nonzero PURCHASE grants and audit. A failure in either ledger insertion rolls back all changes. It is not a public webhook body handler.

No user-facing billing route or payment task invokes these methods yet. Subscription terms and renewal consent must join the same settlement transaction before enabling recurring subscriptions. Payment submission persistence, outbox/lease handling, authenticated webhook reconciliation, billing UI, refunds affecting entitlement balances and plan changes remain in progress. Immutable receipt email data also requires an explicit financial retention policy in the account deletion workflow; no deletion compliance claim is made by this schema.

## Paid subscription periods

Migration 0022 adds one subscription identity per organization and immutable paid terms tied to settled orders. Payment settlement inserts the monthly term and both credit grants in the same transaction. Dates use UTC anchors: prepaid months retain the original day across short months, and a payment after expiry starts a new anchor at processing time without charging for the unpaid gap. Early manual payments append the next paid month; credits are purchased at settlement. Automatic renewal remains disabled until explicit consent and durable scheduling are implemented.

The owner-only overview distinguishes the currently active term, future prepaid terms, recent term history and order summaries; receipt emails and provider references are excluded. Database guards enforce paid-order/plan identity, exact monthly boundaries and non-overlap under the same organization lock used by settlement. Replaying a settlement written before terms existed can record its missing historical term using the original settlement timestamp, without minting credits or restarting access from replay time. Earlier history is never rewritten.

## Explicit renewal permission

Migration 0023 adds immutable renewal consents and change events plus a tenant-scoped active preference with optimistic revision. Preview uses the current enabled immutable quote and a versioned server-generated text/hash disclosing the monthly price, method saving and cancellation boundary. Acceptance requires a verified OWNER, accepted=true, exact policy hash/version, current quote and expected preference revision. Actor and bounded request evidence are retained only in the consent record.

Enable/disable intents are idempotent under the tenant lock. Replaying an old enable after cancellation cannot re-enable it; replaying an old cancellation after a new acceptance cannot disable the new permission. Changed intent reuse and stale revisions conflict. Cancellation writes history/audit and clears the active permission without changing paid terms or credit balances. Safe overview excludes IP/user-agent evidence.

These repository operations are not yet exposed to users or scheduled by a billing worker. No auto-charge capability is implied by the permission record alone.

## Consent-bound saved methods

Migration 0024 binds a saving checkout to the active consent ID and revision. Ordinary checkout still uses saveMethod=false. A new saving order requires the exact active permission and quote; PostgreSQL checks this relationship as well as the repository. An exact replay returns the original immutable order, so the future worker must recheck eligibility before marking a new submission.

After authenticated paid verification and atomic settlement, PaymentMethodService encrypts the provider method reference with AES-256-GCM. Associated data binds the ciphertext to its payment purpose, tenant, internal method/order ID, provider, merchant and test/live mode. It cannot be decrypted as a social token or for another payment scope. Card data is never stored. A configured credential vault is required to capture a method.

Capture checks the settled payment identity, active consent/revision and requesting owner's current verified membership under the tenant lock. Cancellation or replacement permission clears stored ciphertext and records revocation in the same transaction. Concurrent cancellation/capture cannot leave a usable method. Database guards prevent resurrection. Method capture is separate from settlement: a capture failure must be retried through authenticated status reconciliation, never by repeating a charge with a new key.

Durable task dispatch, pre-send eligibility checks, queued-charge cancellation, webhook reconciliation, automatic renewal scheduling and Billing UI remain to be implemented before enabling payments.
