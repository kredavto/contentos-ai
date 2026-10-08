import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, integer, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { users } from './identity';
export const platformOperators = pgTable('platform_operators', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['SUPPORT', 'ADMIN'] }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('platform_operators_user_uq').on(t.userId), check('platform_operator_role_valid', sql`${t.role} in ('SUPPORT','ADMIN')`)]);
export const platformActions = pgTable('platform_actions', {
  id: uuid('id').primaryKey().defaultRandom(), actorId: uuid('actor_id').notNull().references(() => users.id), targetUserId: uuid('target_user_id').notNull().references(() => users.id),
  operation: text('operation').notNull(), reason: text('reason').notNull(), ticket: text('ticket').notNull(),
  requestKey: uuid('request_key').notNull(), inputHash: text('input_hash').notNull(), revokedSessions: integer('revoked_sessions').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('platform_action_intent_uq').on(t.actorId, t.requestKey), check('platform_action_valid', sql`${t.operation} = 'REVOKE_SESSIONS' and ${t.reason} in ('USER_REQUEST','SECURITY_INCIDENT','SUPPORT_CASE') and ${t.ticket} ~ '^[A-Za-z0-9_-]{3,80}$' and ${t.revokedSessions} >= 0`)]);
