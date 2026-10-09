import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, unique, foreignKey, check, index, type PgTableExtraConfigValue } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';
import type { StoredPaymentRequest, PaymentObservation, EncryptedCredential } from '@contentos/types';
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(), code: text('code').notNull(), name: text('name').notNull(), enabled: boolean('enabled').notNull().default(false), createdAt: createdAt(),
}, t => [unique('plan_code_uq').on(t.code), check('plan_code_valid', sql`${t.code} in ('FREE','START','CREATOR','EXPERT','AGENCY')`)]);
export const planVersions = pgTable('plan_versions', {
  id: uuid('id').primaryKey().defaultRandom(), planId: uuid('plan_id').notNull().references(() => plans.id), version: integer('version').notNull(),
  amountMinor: integer('amount_minor').notNull(), currency: text('currency').notNull().default('RUB'), aiCredits: integer('ai_credits').notNull(), videoSeconds: integer('video_seconds').notNull(), createdAt: createdAt(),
}, t => [unique('plan_version_uq').on(t.planId, t.version), check('plan_version_valid', sql`${t.version} > 0 and ${t.amountMinor} between 0 and 1000000000 and ${t.currency} = 'RUB' and ${t.aiCredits} between 0 and 1000000000 and ${t.videoSeconds} between 0 and 1000000000`)]);
export const billingOrders = pgTable('billing_orders', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id), planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id),
  requestedBy: uuid('requested_by').notNull().references(() => users.id), kind: text('kind').notNull(), amountMinor: integer('amount_minor').notNull(), currency: text('currency').notNull(),
  aiCredits: integer('ai_credits').notNull(), videoSeconds: integer('video_seconds').notNull(), provider: text('provider').notNull(), merchantId: text('merchant_id').notNull(), test: boolean('test').notNull(),
  changeFromTermId: uuid('change_from_term_id'),
  renewalConsentId: uuid('renewal_consent_id'), renewalRevision: integer('renewal_revision'),
  input: jsonb('input').$type<StoredPaymentRequest>().notNull(), inputHash: text('input_hash').notNull(), idempotencyKey: uuid('idempotency_key').notNull(), correlationId: uuid('correlation_id').notNull(), createdAt: createdAt(),
}, (t): PgTableExtraConfigValue[] => [unique('billing_order_tenant_id_uq').on(t.tenantId, t.id), unique('billing_order_intent_uq').on(t.tenantId, t.idempotencyKey), index('billing_order_tenant_created_idx').on(t.tenantId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.changeFromTermId], foreignColumns: [subscriptionTerms.tenantId, subscriptionTerms.id] }),
  check('billing_order_change_valid', sql`(${t.kind} in ('UPGRADE','DOWNGRADE')) = (${t.changeFromTermId} is not null)`),
  check('billing_order_mode_kind_valid', sql`((${t.kind} = 'RENEWAL') = (${t.input}->>'mode' = 'RENEWAL')) IS TRUE`),
  check('billing_order_no_plaintext_method', sql`not (${t.input} ? 'paymentMethodId')`),
  check('billing_order_kind_valid', sql`${t.kind} in ('START','RENEWAL','UPGRADE','DOWNGRADE')`), check('billing_order_amount_valid', sql`${t.amountMinor} between 1 and 1000000000 and ${t.currency} = 'RUB' and ${t.aiCredits} between 0 and 1000000000 and ${t.videoSeconds} between 0 and 1000000000`),
  check('billing_order_input_valid', sql`${t.input}->>'currency' = ${t.currency} and (${t.input}->>'amountMinor')::numeric = ${t.amountMinor}`),
  foreignKey({ columns: [t.tenantId, t.renewalConsentId], foreignColumns: [renewalConsents.tenantId, renewalConsents.id] }),
  check('billing_order_renewal_valid', sql`((${t.renewalConsentId} is null and ${t.renewalRevision} is null and ${t.input}->>'saveMethod' = 'false') or (${t.renewalConsentId} is not null and ${t.renewalRevision} > 0 and (${t.input}->>'saveMethod' = 'true' or ${t.input}->>'mode' = 'RENEWAL'))) IS TRUE`),
]);
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), orderId: uuid('order_id').notNull(), provider: text('provider').notNull(), merchantId: text('merchant_id').notNull(), test: boolean('test').notNull(),
  externalId: text('external_id').notNull(), createdAt: createdAt(),
}, t => [unique('payment_tenant_id_uq').on(t.tenantId, t.id), unique('payment_order_uq').on(t.tenantId, t.orderId), unique('payment_external_uq').on(t.provider, t.merchantId, t.test, t.externalId),
  foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [billingOrders.tenantId, billingOrders.id] }),
]);
export const paymentSettlements = pgTable('payment_settlements', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), orderId: uuid('order_id').notNull(), paymentId: uuid('payment_id').notNull(),
  observation: jsonb('observation').$type<PaymentObservation>().notNull(), correlationId: uuid('correlation_id').notNull(), createdAt: createdAt(),
}, t => [index('settlement_created_tenant_idx').on(t.createdAt, t.tenantId), unique('payment_settlement_order_uq').on(t.tenantId, t.orderId), unique('payment_settlement_payment_uq').on(t.tenantId, t.paymentId),
  foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [billingOrders.tenantId, billingOrders.id] }),
  foreignKey({ columns: [t.tenantId, t.paymentId], foreignColumns: [payments.tenantId, payments.id] }),
  check('payment_settlement_paid_valid', sql`${t.observation}->>'status' = 'SUCCEEDED' and ${t.observation}->>'paid' = 'true'`),
]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id), createdAt: createdAt(),
}, t => [unique('subscription_tenant_uq').on(t.tenantId), unique('subscription_tenant_id_uq').on(t.tenantId, t.id)]);
export const subscriptionTerms = pgTable('subscription_terms', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), subscriptionId: uuid('subscription_id').notNull(), orderId: uuid('order_id').notNull(),
  planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id), anchorAt: timestamp('anchor_at', { withTimezone: true }).notNull(), monthIndex: integer('month_index').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(), endsAt: timestamp('ends_at', { withTimezone: true }).notNull(), createdAt: createdAt(),
}, t => [unique('subscription_term_tenant_id_uq').on(t.tenantId, t.id), unique('subscription_term_order_uq').on(t.tenantId, t.orderId), index('subscription_term_current_idx').on(t.tenantId, t.startsAt, t.endsAt),
  foreignKey({ columns: [t.tenantId, t.subscriptionId], foreignColumns: [subscriptions.tenantId, subscriptions.id] }),
  foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [paymentSettlements.tenantId, paymentSettlements.orderId] }),
  check('subscription_term_period_valid', sql`${t.monthIndex} between 1 and 1200 and ${t.endsAt} > ${t.startsAt} and ${t.startsAt} = ((${t.anchorAt} at time zone 'UTC') + make_interval(months => ${t.monthIndex} - 1)) at time zone 'UTC' and ${t.endsAt} = ((${t.anchorAt} at time zone 'UTC') + make_interval(months => ${t.monthIndex})) at time zone 'UTC'`),
]);

export const renewalConsents = pgTable('billing_renewal_consents', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id), planVersionId: uuid('plan_version_id').notNull().references(() => planVersions.id),
  policyVersion: text('policy_version').notNull(), policyText: text('policy_text').notNull(), textHash: text('text_hash').notNull(), amountMinor: integer('amount_minor').notNull(), currency: text('currency').notNull(),
  acceptedBy: uuid('accepted_by').notNull().references(() => users.id), ipAddress: text('ip_address').notNull(), userAgent: text('user_agent').notNull(), createdAt: createdAt(),
}, t => [unique('renewal_consent_tenant_id_uq').on(t.tenantId, t.id), check('renewal_consent_amount_valid', sql`${t.amountMinor} > 0 and ${t.currency} = 'RUB' and ${t.textHash} ~ '^[a-f0-9]{64}$'`)]);
export const renewalPreferences = pgTable('billing_renewal_preferences', {
  tenantId: uuid('tenant_id').primaryKey().references(() => organizations.id), activeConsentId: uuid('active_consent_id'), revision: integer('revision').notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.tenantId, t.activeConsentId], foreignColumns: [renewalConsents.tenantId, renewalConsents.id] }), check('renewal_revision_valid', sql`${t.revision} >= 0`)]);
export const renewalChanges = pgTable('billing_renewal_changes', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id), consentId: uuid('consent_id'), revision: integer('revision').notNull(), operation: text('operation').notNull(),
  actorId: uuid('actor_id').notNull().references(() => users.id), idempotencyKey: uuid('idempotency_key').notNull(), inputHash: text('input_hash').notNull(), correlationId: uuid('correlation_id').notNull(), createdAt: createdAt(),
}, t => [unique('renewal_change_intent_uq').on(t.tenantId, t.idempotencyKey), unique('renewal_change_revision_uq').on(t.tenantId, t.revision),
  foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [renewalConsents.tenantId, renewalConsents.id] }),
  check('renewal_change_valid', sql`${t.revision} > 0 and ${t.operation} in ('ENABLE','DISABLE') and (${t.operation} <> 'ENABLE' or ${t.consentId} is not null)`),
]);

export const paymentMethods = pgTable('billing_payment_methods', {
  id: uuid('id').primaryKey(), tenantId: uuid('tenant_id').notNull(), orderId: uuid('order_id').notNull(), consentId: uuid('consent_id').notNull(), renewalRevision: integer('renewal_revision').notNull(),
  credential: jsonb('credential').$type<EncryptedCredential>(), revokedAt: timestamp('revoked_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [unique('payment_method_order_uq').on(t.tenantId, t.orderId),
  foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [paymentSettlements.tenantId, paymentSettlements.orderId] }),
  foreignKey({ columns: [t.tenantId, t.consentId], foreignColumns: [renewalConsents.tenantId, renewalConsents.id] }),
  check('payment_method_identity_valid', sql`${t.id} = ${t.orderId} and ${t.renewalRevision} > 0`),
  check('payment_method_revocation_valid', sql`(${t.revokedAt} is null and ${t.credential} is not null) or (${t.revokedAt} is not null and ${t.credential} is null)`),
]);


export const renewalIntents = pgTable('billing_renewal_intents', {
  orderId: uuid('order_id').primaryKey(), tenantId: uuid('tenant_id').notNull(), termId: uuid('term_id').notNull(), methodId: uuid('method_id').notNull(), createdAt: createdAt(),
}, t => [unique('renewal_intent_term_uq').on(t.tenantId,t.termId),
  foreignKey({columns:[t.tenantId,t.orderId],foreignColumns:[billingOrders.tenantId,billingOrders.id]}),
  foreignKey({columns:[t.tenantId,t.termId],foreignColumns:[subscriptionTerms.tenantId,subscriptionTerms.id]}),
  // Method IDs equal their originating settled order IDs by the existing identity constraint.
  foreignKey({columns:[t.tenantId,t.methodId],foreignColumns:[paymentMethods.tenantId,paymentMethods.orderId]}),
]);
