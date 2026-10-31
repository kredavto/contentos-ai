import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,uniqueIndex,foreignKey,index,check} from 'drizzle-orm/pg-core';
import type {CommentImportPosition} from '@contentos/types';
import {brands,users} from './identity';
import {publications} from './publishing';
import {socialConnections} from './social';
export const commentImports=pgTable('comment_imports',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),publicationId:uuid('publication_id').notNull(),connectionId:uuid('connection_id').notNull(),credentialVersion:integer('credential_version').notNull(),
 videoId:text('video_id').notNull(),channelId:text('channel_id').notNull(),requestedBy:uuid('requested_by').notNull().references(()=>users.id),idempotencyKey:uuid('idempotency_key').notNull(),correlationId:uuid('correlation_id').notNull(),
 status:text('status',{enum:['QUEUED','RUNNING','PARTIAL','SUCCEEDED','FAILED','CANCELLED']}).notNull().default('QUEUED'),position:jsonb('position').$type<CommentImportPosition>().default(sql`'{"kind":"THREADS","cursor":null}'::jsonb`),
 remainingPages:integer('remaining_pages').notNull().default(200),completedPages:integer('completed_pages').notNull().default(0),revision:integer('revision').notNull().default(0),attempt:integer('attempt').notNull().default(0),
 leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),startedAt:timestamp('started_at',{withTimezone:true}),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),
 errorCode:text('error_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp('finished_at',{withTimezone:true}),
},t=>[
 unique('comment_import_tenant_id_uq').on(t.tenantId,t.id),unique('comment_import_intent_uq').on(t.tenantId,t.idempotencyKey),
 foreignKey({name:'comment_import_brand_fk',columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
 foreignKey({name:'comment_import_publication_fk',columns:[t.tenantId,t.publicationId],foreignColumns:[publications.tenantId,publications.id]}),
 foreignKey({name:'comment_import_connection_fk',columns:[t.tenantId,t.connectionId],foreignColumns:[socialConnections.tenantId,socialConnections.id]}),
 uniqueIndex('comment_import_active_uq').on(t.tenantId,t.publicationId).where(sql`${t.status} in ('QUEUED','RUNNING','PARTIAL')`),
 index('comment_import_due_idx').on(t.status,t.nextAttemptAt,t.dispatchAfter),index('comment_import_history_idx').on(t.tenantId,t.publicationId,t.createdAt,t.id),
 check('comment_import_identity_valid',sql`${t.credentialVersion}>0 and ${t.videoId} ~ '^[A-Za-z0-9_-]{11}$' and ${t.channelId} ~ '^UC[A-Za-z0-9_-]{22}$'`),
 check('comment_import_counters_valid',sql`${t.remainingPages} between 0 and 200 and ${t.completedPages}>=0 and ${t.revision}>=0 and ${t.attempt} between 0 and 3`),
 check('comment_import_state_valid',sql`${t.status} in ('QUEUED','RUNNING','PARTIAL','SUCCEEDED','FAILED','CANCELLED') and ((${t.status}='SUCCEEDED' and ${t.position} is null) or (${t.status}<>'SUCCEEDED' and ${t.position} is not null and jsonb_typeof(${t.position})='object')) and (${t.status} not in ('QUEUED','RUNNING') or ${t.remainingPages}>0) and (${t.status}<>'PARTIAL' or ${t.remainingPages}=0)`),
 check('comment_import_lease_valid',sql`((${t.status}='RUNNING' and ${t.leaseToken} is not null and ${t.leaseExpiresAt} is not null and ${t.startedAt} is not null) or (${t.status}<>'RUNNING' and ${t.leaseToken} is null and ${t.leaseExpiresAt} is null))`),
 check('comment_import_finish_valid',sql`((${t.status} in ('SUCCEEDED','FAILED','CANCELLED') and ${t.finishedAt} is not null) or (${t.status} not in ('SUCCEEDED','FAILED','CANCELLED') and ${t.finishedAt} is null))`),
]);
export const commentImportPages=pgTable('comment_import_pages',{
 id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),importId:uuid('import_id').notNull(),scope:text('scope').notNull(),cursorHash:text('cursor_hash').notNull(),ordinal:integer('ordinal').notNull(),observedAt:timestamp('observed_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 foreignKey({name:'comment_page_import_fk',columns:[t.tenantId,t.importId],foreignColumns:[commentImports.tenantId,commentImports.id]}),
 unique('comment_page_cursor_uq').on(t.tenantId,t.importId,t.scope,t.cursorHash),unique('comment_page_ordinal_uq').on(t.tenantId,t.importId,t.ordinal),
 check('comment_page_valid',sql`${t.ordinal}>0 and ${t.cursorHash} ~ '^[a-f0-9]{64}$' and (${t.scope}='THREADS' or ${t.scope} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')`),
]);
