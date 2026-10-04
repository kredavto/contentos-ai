# Payments and monthly subscriptions

Status: checkout UI/API, worker settlement and webhook reconciliation are implemented but disabled by default. Automatic renewal and plan changes are still in progress. Existing trial credits remain separate. Production requires merchant credentials and receipt configuration; missing configuration must never simulate payment success.

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

Configuration parsing and the provider factory require explicit mode and server credentials. PAYMENTS_ENABLED defaults false; PAYMENT_PROVIDER defaults disabled. Test mode cannot enable payments in production. The factory and adapter are wired to the payment worker. Owner checkout routes additionally require explicit fiscal settings; enabling payments allows the worker to process newly created durable checkout tasks. Existing historical orders are not automatically backfilled into tasks.

Additional official references checked: [receipt parameter values](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/other-services/parameters-values), [refund receipts](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/refunds), [documented request paths in event logs](https://yookassa.ru/docs/support/merchant/payments/logs). No third-party SDK or undocumented endpoint is used.

Refund requests distinguish FULL (omit receipt; provider reuses the original receipt) from PARTIAL (supply the reviewed receipt for the refunded subscription amount). The future refund repository must enforce this classification against the original immutable payment and prior refunds under a lock. Both payment and refund reads retain receipt registration status for later monitoring; a successful payment alone does not establish successful fiscal registration.

## Implemented persistence foundation

Migration 0021 adds plans, immutable price/entitlement versions, immutable tenant orders, unique provider-payment mappings and immutable settlement evidence. Five plan codes are seeded disabled without invented prices. Database triggers reject changes to financial history and mismatched payment/settlement identities. A provider payment can map to only one order in a merchant/test scope.

BillingRepository checkout is verified-OWNER-only, snapshots a current enabled quote and receipt input, and serializes exact client-intent replay under the tenant lock. Changed intent or outdated quotes conflict. Payment settlement is an internal worker boundary accepting only an authenticated observation; it validates order identity/amount/mode, locks the tenant and atomically inserts payment, settlement, both nonzero PURCHASE grants and audit. A failure in either ledger insertion rolls back all changes. It is not a public webhook body handler.

Checkout routes and the durable worker now invoke this foundation. Refunds affecting entitlement balances and plan changes remain in progress. Immutable receipt email data also requires an explicit financial retention policy in the account deletion workflow; no deletion compliance claim is made by this schema.

## Paid subscription periods

Migration 0022 adds one subscription identity per organization and immutable paid terms tied to settled orders. Payment settlement inserts the monthly term and both credit grants in the same transaction. Dates use UTC anchors: prepaid months retain the original day across short months, and a payment after expiry starts a new anchor at processing time without charging for the unpaid gap. Early manual payments append the next paid month; credits are purchased at settlement. Automatic renewal remains disabled until explicit consent and durable scheduling are implemented.

The owner-only overview distinguishes the currently active term, future prepaid terms, recent term history and order summaries; receipt emails and provider references are excluded. Database guards enforce paid-order/plan identity, exact monthly boundaries and non-overlap under the same organization lock used by settlement. Replaying a settlement written before terms existed can record its missing historical term using the original settlement timestamp, without minting credits or restarting access from replay time. Earlier history is never rewritten.

## Explicit renewal permission

Migration 0023 adds immutable renewal consents and change events plus a tenant-scoped active preference with optimistic revision. Preview uses the current enabled immutable quote and a versioned server-generated text/hash disclosing the monthly price, method saving and cancellation boundary. Acceptance requires a verified OWNER, accepted=true, exact policy hash/version, current quote and expected preference revision. Actor and bounded request evidence are retained only in the consent record.

Enable/disable intents are idempotent under the tenant lock. Replaying an old enable after cancellation cannot re-enable it; replaying an old cancellation after a new acceptance cannot disable the new permission. Changed intent reuse and stale revisions conflict. Cancellation writes history/audit and clears the active permission without changing paid terms or credit balances. Safe overview excludes IP/user-agent evidence.

Cancellation is exposed in Billing; enabling a new recurring permission is not exposed until automatic scheduling and method binding are ready. No auto-charge capability is implied by the permission record alone.

## Consent-bound saved methods

Migration 0024 binds a saving checkout to the active consent ID and revision. Ordinary checkout still uses saveMethod=false. A new saving order requires the exact active permission and quote; PostgreSQL checks this relationship as well as the repository. An exact replay returns the original immutable order, so the future worker must recheck eligibility before marking a new submission.

After authenticated paid verification and atomic settlement, PaymentMethodService encrypts the provider method reference with AES-256-GCM. Associated data binds the ciphertext to its payment purpose, tenant, internal method/order ID, provider, merchant and test/live mode. It cannot be decrypted as a social token or for another payment scope. Card data is never stored. A configured credential vault is required to capture a method.

Capture checks the settled payment identity, active consent/revision and requesting owner's current verified membership under the tenant lock. Cancellation or replacement permission clears stored ciphertext and records revocation in the same transaction. Concurrent cancellation/capture cannot leave a usable method. Database guards prevent resurrection. Method capture is separate from settlement: a capture failure must be retried through authenticated status reconciliation, never by repeating a charge with a new key.

Durable task dispatch, pre-send eligibility checks, unsent saving-checkout cancellation, webhook reconciliation and Billing UI are connected below. Automatic renewal scheduling remains outstanding.


## Durable checkout processing

Migration 0025 adds `payment_tasks`, one organization-scoped durable task/outbox row per newly created order. Order and task creation commit together. BullMQ delivery uses the internal order UUID; the PostgreSQL row is authoritative across Redis loss or duplicate delivery. The dispatcher periodically redelivers due/expired work, and a two-minute token lease fences stale workers. The original submission timestamp and counters cannot be reset in PostgreSQL.

Before POST, the worker commits the send marker under the tenant lock, rechecks the verified owner's membership and any active consent/revision, checks the configured merchant/mode and requires a vault for method saving. The provider idempotency key is the globally unique internal order UUID, not the tenant-scoped browser intent key. Retries retain this key, immutable order input and first timestamp. Unknown submissions are bounded to five sends and a conservative 23-hour window; outside either limit they require reconciliation. A definitive rejection of the first attempt can fail the task; a rejection of a later uncertain replay cannot prove that the earlier charge did not happen.

An authenticated result is persisted as a unique payment mapping before settlement or method capture. Subsequent processing uses GET even after the POST replay deadline or renewal cancellation. Paid settlement and saved-method capture are idempotent; a capture failure cannot cause another POST. Successful task completion requires an existing committed settlement. Polling/recovery is bounded to 240 claims, then moves to reconciliation. Raw provider errors are not stored or logged.

Cancellation/replacement consent cancels unsent saving tasks in its transaction, including a claimed task whose send marker has not committed. Already marked submissions retain their uncertainty and must be reconciled; an unknown payment is not resent after consent revocation. A known payment can still be read and settled, preserving already paid access. The send-marker transaction defines the cancellation boundary; cancellation cannot retract an HTTP request already authorized there.

The persistent worker now has a separate `contentos-payments` BullMQ queue, health participation and shutdown handling. Disabled provider configuration does not dispatch or claim payment work. This step supports checkout tasks; automatic saved-method renewal orders intentionally cannot be submitted until their method binding/scheduling implementation is complete. Webhook reconciliation and owner-facing checkout/status endpoints are connected below. Plan changes and automatic renewal remain required.


## Durable YooKassa notifications

`POST /api/webhooks/yookassa` now accepts the three payment event types (`payment.succeeded`, `payment.canceled`, `payment.waiting_for_capture`). It returns HTTP 200 only after durable receipt insertion; storage/configuration/rate-limit errors remain non-200 so delivery can retry. Configure these events and the deployed HTTPS URL in the YooKassa merchant dashboard. HTTP Basic integrations configure callbacks there, not through an invented subscription API. The official notification documentation was rechecked on 2026-10-04: it specifies 200 acknowledgements, up to 24-hour redelivery and authentication by checking the object or source IP.

Migration 0026 adds the shared webhook receipt journal/outbox. A payment receipt contains only provider, configured merchant/mode, event type, external object ID and correlation ID; raw card/receipt data, claimed status/amount and untrusted order metadata are discarded. Deduplication uses merchant/mode/provider plus event-type/object-ID, since this notification format has no separate event UUID. Receipt identity is immutable. JSON input is bounded to 128 KiB and receipt admission is limited to 600 requests per configured merchant/mode per minute. Deployment edge protection can supplement this; arbitrary forwarded IP headers are not trusted as provider authentication.

The payment worker consumes the durable receipt and calls the authenticated provider `inspect` operation. That read discovers the internal order ID from the provider response, not the notification. Repository reconciliation checks exact merchant/mode/external ID, order price/currency, prior submission evidence and any existing payment mapping before waking payment work or settling. Unknown application orders are ignored without disclosure. A current checkout lease is allowed to finish first. A lost create response can therefore be reconciled after the POST replay deadline without creating another payment.

Paid settlement and method capture remain idempotent. A claimed terminal event while the actual payment is still pending remains retryable, so a forged early body cannot suppress a later paid notification. Receipt processing has leases, bounded exponential retry and a reconciliation state after 24 claims; provider redelivery can rearm an unresolved receipt with a fresh attempt budget without changing its original identity. Processed duplicates stay processed. Delayed event names do not override the current authenticated state.

An integration test now exercises the actual YooKassa adapter through the checkout processor with fixture HTTP responses. It caught and fixes a missing merchant/mode reference on status GET that interface-only mocks did not detect. No real provider request is made by these tests. Renewal scheduling/method binding and plan changes remain outstanding.


## Owner checkout and Billing UI

Verified organization owners can use `/billing?organization=<UUID>` and the organization billing API. The catalog reads only the latest version of enabled, priced paid plans; no UI price is hardcoded. Checkout accepts only an immutable plan-version ID and client UUID intent. It builds the HTTPS return URL from APP_URL and the receipt email from the verified owner, and takes fiscal classification from explicit server settings. Client amount, recipient email, provider credentials and arbitrary return URL fields are rejected. Creating a checkout does not make an external call inside HTTP; the response is a sanitized queued order.

Endpoints: GET `/api/organizations/:tenant/billing`, POST `.../billing/checkout`, GET `.../billing/orders/:order`, and POST `.../billing/cancel-renewal`. Session authentication, tenant/OWNER verification and Origin checks apply; mutations share the existing per-user rate limit. Order projections omit receipt email, merchant/payment IDs and saved methods. PAID is derived from the committed settlement, even if a later method-capture step is recovering. Only pending tasks expose their verified provider confirmation URL.

The screen shows configured plan resources, current/upcoming paid periods, confirmation/status polling, recent orders and renewal cancellation. Initial load resumes the most recent order. A checkout retry retains its UUID intent; a new purchase after a terminal result uses a new intent. Missing merchant/fiscal configuration disables purchase. Recurring permission is not enabled by a manual purchase. The active-permission display reflects whether the recurring engine is configured; accepting new permission is not exposed yet.

Checkout readiness requires PAYMENT_RECEIPT_VAT_CODE and PAYMENT_RECEIPT_SUBJECT; PAYMENT_RECEIPT_TAX_SYSTEM_CODE is optional according to the reviewed merchant setup. No tax defaults are invented. This does not constitute fiscal/legal approval of a merchant configuration.


## Recurring worker engine (opt-in UI still pending)

Migrations 0027–0028 add immutable `billing_renewal_intents`, binding one automatic order to one paid term and one internal saved-method ID with tenant-scoped foreign keys. A deferred database guard requires each renewal order to have its binding at transaction commit. The order mode must match its kind, and PostgreSQL rejects a plaintext paymentMethodId in any stored order. The worker decrypts the method only into the transient provider request; neither the frozen order nor its audit contains the provider method reference.

With PAYMENT_RENEWALS_ENABLED=true, a configured merchant, explicit fiscal settings and a usable vault, the worker scans eligible last paid terms. Scheduling checks current verified OWNER membership, the exact active consent/revision, enabled plan, consent-frozen quote and a non-revoked method for that merchant/mode. Concurrent scans return the same term-bound order. A later catalog price does not change the accepted price or entitlements. Candidates lacking a usable method/owner/plan are filtered before batching, so they do not occupy the whole due-work batch.

Only the latest paid term is eligible, from its end until 72 hours later. This bounded recovery window prevents old expired subscriptions from producing surprise catch-up charges after a long outage. There is one automatic payment intent per term; transient retries use the existing stable key and replay deadline, while definitive failure requires user recovery rather than a fresh automatic charge key. A subsequent manual purchase creates a new paid term and can restore future eligibility.

Immediately before the send marker, the worker rechecks consent, owner membership, method binding/revocation, merchant/mode, enabled plan and latest paid term. A manual payment that extended access first cancels an unsent stale renewal. Disabling the recurring flag prevents new renewal sends, while known payments can still be read/reconciled. Cancellation keeps its existing send-marker boundary and erases saved ciphertext.

Automatic payments settled within the recovery window preserve the original calendar anchor (31 January → 28 February → 31 March), even if processing is slightly late. Their immutable term has nominal calendar boundaries; access is only granted when settlement commits. Manual purchases after expiry, and renewal confirmation beyond that window, start a fresh full-month anchor. This distinction avoids permanent date drift without silently billing multiple missed months.

This engine is off by default. The explicit user opt-in/saving-checkout UI, method-readiness display and renewal recovery notifications still need integration before recurring billing is offered to users. Existing consent evidence is not re-written. Financial record deletion/retention remains a separate required workflow.
