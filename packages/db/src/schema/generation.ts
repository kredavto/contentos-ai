import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, jsonb, unique, index, foreignKey, check, bigint } from 'drizzle-orm/pg-core';
import { organizations, users, brands } from './identity';
import type { GenerationInput, GenerationOutput, JobState, UsageUnit, JobType, AvatarJobInput, VideoJobInput } from '@contentos/types';
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const usagePolicies = pgTable('usage_policies', {
  operation: text('operation').primaryKey(), unit: text('unit').$type<UsageUnit>().notNull(), amount: integer('amount').notNull(),
}, t => [check('usage_policy_positive', sql`${t.amount} > 0`)]);
export const usageReservations = pgTable('usage_reservations', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id),
  key: text('key').notNull(), unit: text('unit').$type<UsageUnit>().notNull(), amount: integer('amount').notNull(),
  status: text('status', { enum: ['HELD', 'CAPTURED', 'RELEASED'] }).notNull().default('HELD'), createdAt: createdAt(),
}, t => [unique('reservation_key_uq').on(t.tenantId, t.key), unique('reservation_tenant_id_uq').on(t.tenantId, t.id), check('reservation_amount_positive', sql`${t.amount} > 0`)]);
export const usageLedger = pgTable('usage_ledger', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id),
  reservationId: uuid('reservation_id'), unit: text('unit').$type<UsageUnit>().notNull(),
  type: text('type', { enum: ['GRANT', 'RESERVE', 'CAPTURE', 'RELEASE', 'PURCHASE', 'REFUND', 'ADJUSTMENT', 'EXPIRE'] }).notNull(),
  amount: integer('amount').notNull(), availableDelta: integer('available_delta').notNull(), reservedDelta: integer('reserved_delta').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), correlationId: uuid('correlation_id').notNull(), createdAt: createdAt(),
}, t => [unique('ledger_key_uq').on(t.tenantId, t.idempotencyKey), index('ledger_balance_idx').on(t.tenantId, t.unit),
  foreignKey({ columns: [t.tenantId, t.reservationId], foreignColumns: [usageReservations.tenantId, usageReservations.id] }),
  check('ledger_unit_valid', sql`${t.unit} in ('AI_CREDITS','VIDEO_SECONDS')`),
  check('ledger_deltas_valid', sql`(
    (${t.type} in ('GRANT','PURCHASE','REFUND') and ${t.amount} > 0 and ${t.availableDelta} = ${t.amount} and ${t.reservedDelta} = 0 and ${t.reservationId} is null) or
    (${t.type} = 'ADJUSTMENT' and ${t.amount} <> 0 and ${t.availableDelta} = ${t.amount} and ${t.reservedDelta} = 0 and ${t.reservationId} is null) or
    (${t.type} = 'EXPIRE' and ${t.amount} > 0 and ${t.availableDelta} = -${t.amount} and ${t.reservedDelta} = 0 and ${t.reservationId} is null) or
    (${t.type} = 'RESERVE' and ${t.amount} > 0 and ${t.availableDelta} = -${t.amount} and ${t.reservedDelta} = ${t.amount} and ${t.reservationId} is not null) or
    (${t.type} = 'CAPTURE' and ${t.amount} > 0 and ${t.availableDelta} = 0 and ${t.reservedDelta} = -${t.amount} and ${t.reservationId} is not null) or
    (${t.type} = 'RELEASE' and ${t.amount} > 0 and ${t.availableDelta} = ${t.amount} and ${t.reservedDelta} = -${t.amount} and ${t.reservationId} is not null))`),
]);
export const trialGrants = pgTable('trial_grants', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').unique().references(() => users.id, { onDelete: 'set null' }),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id), createdAt: createdAt(),
});
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id), brandId: uuid('brand_id').notNull(),
  requestedBy: uuid('requested_by').notNull().references(() => users.id), type: text('type').$type<JobType>().notNull(), status: text('status').$type<JobState>().notNull().default('QUEUED'),
  input: jsonb('input').$type<GenerationInput | AvatarJobInput | VideoJobInput>().notNull(), inputHash: text('input_hash').notNull(), idempotencyKey: uuid('idempotency_key').notNull(),
  reservationId: uuid('reservation_id').notNull(), attempt: integer('attempt').notNull().default(0), maxAttempts: integer('max_attempts').notNull().default(3), consecutiveFailures: integer('consecutive_failures').notNull().default(0), pollCount: integer('poll_count').notNull().default(0),
  provider: text('provider').notNull(), model: text('model').notNull(), externalJobId: text('external_job_id'), progress: integer('progress').notNull().default(0),
  errorCode: text('error_code'), errorMessage: text('error_message'), leaseToken: uuid('lease_token'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(), correlationId: uuid('correlation_id').notNull(),
  result: jsonb('result').$type<{ internalId: string; version: number }>(), createdAt: createdAt(), startedAt: timestamp('started_at', { withTimezone: true }), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [unique('jobs_tenant_id_uq').on(t.tenantId, t.id), unique('jobs_idempotency_uq').on(t.tenantId, t.idempotencyKey), index('jobs_dispatch_idx').on(t.status, t.nextAttemptAt),
  foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }),
  foreignKey({ columns: [t.tenantId, t.reservationId], foreignColumns: [usageReservations.tenantId, usageReservations.id] }),
  check('jobs_progress_valid', sql`${t.progress} between 0 and 100`), check('jobs_attempt_valid', sql`${t.attempt} >= 0 and ${t.maxAttempts} between 1 and 10`),
  check('jobs_status_valid', sql`${t.status} in ('QUEUED','RUNNING','RETRY','SUCCEEDED','FAILED','WAITING_EXTERNAL','RECONCILIATION')`),
]);
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), jobId: uuid('job_id').notNull().unique(),
  lastDispatchedAt: timestamp('last_dispatched_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] })]);
export const aiCalls = pgTable('ai_calls', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), jobId: uuid('job_id').notNull(), attempt: integer('attempt').notNull(), call: integer('call').notNull(),
  provider: text('provider').notNull(), model: text('model').notNull(), status: text('status', { enum: ['STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] }).notNull(),
  inputUnits: integer('input_units'), outputUnits: integer('output_units'), providerCostMicrounits: bigint('provider_cost_microunits', { mode: 'number' }), currency: text('currency').notNull().default('USD'),
  output: jsonb('output').$type<unknown>(), durationMs: integer('duration_ms'), errorCode: text('error_code'), createdAt: createdAt(),
}, t => [unique('ai_call_order_uq').on(t.jobId, t.attempt, t.call), foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] })]);
export const strategies = pgTable('strategies', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), createdAt: createdAt(),
}, t => [unique('strategy_brand_uq').on(t.tenantId, t.brandId), unique('strategy_tenant_id_uq').on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] })]);
export const strategyVersions = pgTable('strategy_versions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), strategyId: uuid('strategy_id').notNull(), jobId: uuid('job_id').notNull(), version: integer('version').notNull(),
  content: jsonb('content').$type<GenerationOutput>().notNull(), createdAt: createdAt(),
}, t => [unique('strategy_version_uq').on(t.strategyId, t.version), unique('strategy_version_job_uq').on(t.jobId),
  foreignKey({ columns: [t.tenantId, t.strategyId], foreignColumns: [strategies.tenantId, strategies.id] }), foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] })]);
