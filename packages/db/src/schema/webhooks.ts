import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, integer, timestamp, unique, index, check } from 'drizzle-orm/pg-core';
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(), provider: text('provider').notNull(), merchantId: text('merchant_id').notNull(), test: boolean('test').notNull(),
  providerEventId: text('provider_event_id').notNull(), eventType: text('event_type').notNull(), externalId: text('external_id').notNull(), correlationId: uuid('correlation_id').notNull(),
  status: text('status').notNull().default('RECEIVED'), attempt: integer('attempt').notNull().default(0), leaseToken: uuid('lease_token'), leaseExpiresAt: timestamp('lease_expires_at',{withTimezone:true}),
  nextAttemptAt: timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(), lastDispatchedAt: timestamp('last_dispatched_at',{withTimezone:true}), errorCode:text('error_code'),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, t => [unique('webhook_provider_event_uq').on(t.provider,t.merchantId,t.test,t.providerEventId),index('webhook_dispatch_idx').on(t.status,t.nextAttemptAt),
  check('webhook_status_valid',sql`${t.status} in ('RECEIVED','PROCESSING','RETRY','PROCESSED','IGNORED','RECONCILIATION')`),
  check('webhook_attempt_valid',sql`${t.attempt} >= 0`),
  check('webhook_lease_valid',sql`(${t.status} = 'PROCESSING' and ${t.leaseToken} is not null and ${t.leaseExpiresAt} is not null) or (${t.status} <> 'PROCESSING' and ${t.leaseToken} is null and ${t.leaseExpiresAt} is null)`),
]);
