import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,boolean,jsonb,timestamp,unique,index,foreignKey,check} from 'drizzle-orm/pg-core';
import {brands,users,sessions} from './identity';
import {socialConnections} from './social';
import type {EncryptedCredential} from '@contentos/types';
export const youtubeOAuthAttempts=pgTable('youtube_oauth_attempts',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),createdBy:uuid('created_by').notNull().references(()=>users.id),sessionId:uuid('session_id').notNull().references(()=>sessions.id,{onDelete:'cascade'}),
  commentsAccess:boolean('comments_access').notNull().default(false),stateHash:text('state_hash').notNull(),verifier:jsonb('verifier').$type<EncryptedCredential>(),connectionId:uuid('connection_id').notNull(),reconnectId:uuid('reconnect_id'),revision:integer('revision'),
  status:text('status').$type<'PENDING'|'EXCHANGING'|'COMPLETED'|'FAILED'>().notNull().default('PENDING'),errorCode:text('error_code'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull().default(sql`now()+interval '10 minutes'`),finishedAt:timestamp('finished_at',{withTimezone:true}),
},t=>[unique('youtube_oauth_state_uq').on(t.stateHash),index('youtube_oauth_expiry_idx').on(t.expiresAt),index('youtube_oauth_actor_idx').on(t.tenantId,t.createdBy,t.sessionId),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.reconnectId],foreignColumns:[socialConnections.tenantId,socialConnections.id]}),
  check('youtube_oauth_state_valid',sql`${t.stateHash} ~ '^[a-f0-9]{64}$' and ${t.status} in ('PENDING','EXCHANGING','COMPLETED','FAILED')`),
  check('youtube_oauth_verifier_valid',sql`(${t.status}='PENDING' and ${t.verifier} is not null) or (${t.status}<>'PENDING' and ${t.verifier} is null)`),
  check('youtube_oauth_reconnect_valid',sql`(${t.reconnectId} is null and ${t.revision} is null) or (${t.reconnectId} is not null and ${t.revision} is not null and ${t.revision} >= 0 and ${t.connectionId}=${t.reconnectId})`),
]);
