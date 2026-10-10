import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { users } from './identity';
export const accountDeletionRequests = pgTable('account_deletion_requests', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id),
  status: text('status', { enum: ['REQUESTED', 'CANCELLED'] }).notNull().default('REQUESTED'),
  revision: uuid('revision').notNull().defaultRandom(), requestKey: uuid('request_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, t => [uniqueIndex('account_deletion_intent_uq').on(t.userId, t.requestKey),
  uniqueIndex('account_deletion_active_uq').on(t.userId).where(sql`${t.status} = 'REQUESTED'`),
  check('account_deletion_state_valid', sql`(${t.status} = 'REQUESTED' and ${t.cancelledAt} is null) or (${t.status} = 'CANCELLED' and ${t.cancelledAt} is not null and ${t.cancelledAt} >= ${t.createdAt})`)]);
