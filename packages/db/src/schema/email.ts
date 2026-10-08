import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, integer, jsonb, index, check, foreignKey } from 'drizzle-orm/pg-core';
import type { EncryptedCredential } from '@contentos/types';
import { authTokens } from './identity';
export const emailOutbox=pgTable('email_outbox',{
  id:uuid('id').primaryKey(),userId:uuid('user_id').notNull(),tokenHash:text('token_hash').notNull().unique(),
  payload:jsonb('payload').$type<EncryptedCredential>(),correlationId:uuid('correlation_id').notNull(),
  status:text('status').$type<'PENDING'|'SENDING'|'SENT'|'FAILED'|'CANCELED'>().notNull().default('PENDING'),
  attempt:integer('attempt').notNull().default(0),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),
  leaseToken:uuid('lease_token'),leaseUntil:timestamp('lease_until',{withTimezone:true}),errorCode:text('error_code'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),completedAt:timestamp('completed_at',{withTimezone:true}),
},t=>[foreignKey({columns:[t.userId,t.tokenHash],foreignColumns:[authTokens.userId,authTokens.tokenHash]}).onDelete('cascade'),index('email_delivery_due_idx').on(t.status,t.nextAttemptAt),
  check('email_status_valid',sql`${t.status} in ('PENDING','SENDING','SENT','FAILED','CANCELED')`),
  check('email_attempt_valid',sql`${t.attempt} between 0 and 8`),
  check('email_lease_valid',sql`(${t.status}='SENDING') = (${t.leaseToken} is not null and ${t.leaseUntil} is not null)`),
  check('email_payload_valid',sql`(${t.status} in ('PENDING','SENDING')) = (${t.payload} is not null)`),
]);
