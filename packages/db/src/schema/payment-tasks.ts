import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, jsonb, foreignKey, check, index } from 'drizzle-orm/pg-core';
import type { PaymentObservation } from '@contentos/types';
import { billingOrders } from './billing';
/** This durable row is also the payment outbox; Redis delivery is never authoritative. */
export const paymentTasks = pgTable('payment_tasks', {
  id: uuid('id').primaryKey(), tenantId: uuid('tenant_id').notNull(),
  status: text('status').notNull().default('QUEUED'), attempt: integer('attempt').notNull().default(0), submissionCount: integer('submission_count').notNull().default(0),
  firstSubmittedAt: timestamp('first_submitted_at', { withTimezone: true }),
  leaseToken: uuid('lease_token'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(), lastDispatchedAt: timestamp('last_dispatched_at', { withTimezone: true }),
  errorCode: text('error_code'), observation: jsonb('observation').$type<PaymentObservation>(), confirmationUrl: text('confirmation_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [foreignKey({ columns: [t.tenantId, t.id], foreignColumns: [billingOrders.tenantId, billingOrders.id] }), index('payment_task_dispatch_idx').on(t.status, t.nextAttemptAt),
  check('payment_task_status_valid', sql`${t.status} in ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELED','RECONCILIATION')`),
  check('payment_task_attempt_valid', sql`${t.attempt} >= 0 and ${t.submissionCount} >= 0 and ((${t.firstSubmittedAt} is null and ${t.submissionCount} = 0) or (${t.firstSubmittedAt} is not null and ${t.submissionCount} > 0))`),
  check('payment_task_lease_valid', sql`(${t.status} = 'RUNNING' and ${t.leaseToken} is not null and ${t.leaseExpiresAt} is not null) or (${t.status} <> 'RUNNING' and ${t.leaseToken} is null and ${t.leaseExpiresAt} is null)`),
]);
