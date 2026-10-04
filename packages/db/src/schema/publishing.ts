import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,jsonb,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import {calendarEntries} from './calendar';
import {socialConnections} from './social';
import {contentItems} from './content';
import type {PublishingState,PublishingSnapshot,ProviderReference} from '@contentos/types';
export const publishingJobs=pgTable('publishing_jobs',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),calendarId:uuid('calendar_id').notNull(),calendarRevision:integer('calendar_revision').notNull(),contentItemId:uuid('content_item_id').notNull(),connectionId:uuid('connection_id').notNull(),credentialVersion:integer('credential_version').notNull(),
  type:text('type').notNull().default('PUBLISH_CONTENT'),provider:text('provider').notNull(),snapshot:jsonb('snapshot').$type<PublishingSnapshot>().notNull(),status:text('status').$type<PublishingState>().notNull().default('SCHEDULED'),attempt:integer('attempt').notNull().default(0),
  scheduledAt:timestamp('scheduled_at',{withTimezone:true}).notNull(),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull(),dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),submittedAt:timestamp('submitted_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),
  errorCode:text('error_code'),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),approvedBy:uuid('approved_by').notNull().references(()=>users.id),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('publishing_tenant_id_uq').on(t.tenantId,t.id),unique('publishing_intent_uq').on(t.tenantId,t.idempotencyKey),unique('publishing_revision_uq').on(t.calendarId,t.calendarRevision),index('publishing_due_idx').on(t.status,t.nextAttemptAt,t.dispatchAfter),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.calendarId],foreignColumns:[calendarEntries.tenantId,calendarEntries.id]}),foreignKey({columns:[t.tenantId,t.contentItemId],foreignColumns:[contentItems.tenantId,contentItems.id]}),foreignKey({columns:[t.tenantId,t.connectionId],foreignColumns:[socialConnections.tenantId,socialConnections.id]}),
  check('publishing_state_valid',sql`${t.status} in ('SCHEDULED','PREPARING','SUBMITTING','PUBLISHED','FAILED','CANCELLED','RECONCILIATION')`),check('publishing_attempt_valid',sql`${t.attempt} >= 0 and ${t.calendarRevision} >= 0 and ${t.credentialVersion} > 0`),check('publishing_type_valid',sql`${t.type} = 'PUBLISH_CONTENT'`),
]);
export const publications=pgTable('publications',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),jobId:uuid('job_id').notNull(),provider:text('provider').notNull(),reference:jsonb('reference').$type<ProviderReference>().notNull(),url:text('url'),publishedAt:timestamp('published_at',{withTimezone:true}).notNull(),recordedAt:timestamp('recorded_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('publication_job_uq').on(t.jobId),unique('publication_tenant_id_uq').on(t.tenantId,t.id),foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[publishingJobs.tenantId,publishingJobs.id]})]);
