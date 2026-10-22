import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,unique,foreignKey,check} from 'drizzle-orm/pg-core';
import {users} from './identity';
import {publishingJobs,publications} from './publishing';
export const youtubeResolutions=pgTable('youtube_resolutions',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),jobId:uuid('job_id').notNull(),publicationId:uuid('publication_id').notNull(),
  actorId:uuid('actor_id').notNull().references(()=>users.id),requestKey:uuid('request_key').notNull(),inputHash:text('input_hash').notNull(),ticket:text('ticket').notNull(),
  expectedRevision:integer('expected_revision').notNull(),source:text('source').$type<'API'|'DEMO'>().notNull(),verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull(),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('youtube_resolution_tenant_id_uq').on(t.tenantId,t.id),unique('youtube_resolution_job_uq').on(t.jobId),unique('youtube_resolution_intent_uq').on(t.actorId,t.requestKey),
  foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[publishingJobs.tenantId,publishingJobs.id]}),foreignKey({columns:[t.tenantId,t.publicationId],foreignColumns:[publications.tenantId,publications.id]}),
  check('youtube_resolution_valid',sql`${t.expectedRevision}>=0 and ${t.source} in ('API','DEMO') and ${t.ticket} ~ '^[A-Za-z0-9_-]{3,80}$' and ${t.inputHash} ~ '^[a-f0-9]{64}$'`),
]);
