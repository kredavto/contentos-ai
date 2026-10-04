import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,timestamp,jsonb,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {publications} from './publishing';
import {users} from './identity';
import type {NormalizedMetrics} from '@contentos/types';
export const publicationMetrics=pgTable('publication_metrics',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),publicationId:uuid('publication_id').notNull(),
  source:text('source').$type<'MANUAL'>().notNull().default('MANUAL'),sourceNote:text('source_note').notNull(),metrics:jsonb('metrics').$type<NormalizedMetrics>().notNull(),
  observedAt:timestamp('observed_at',{withTimezone:true}).notNull(),recordedAt:timestamp('recorded_at',{withTimezone:true}).notNull().defaultNow(),recordedBy:uuid('recorded_by').notNull().references(()=>users.id),
  idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),
},t=>[unique('publication_metrics_intent_uq').on(t.tenantId,t.idempotencyKey),foreignKey({columns:[t.tenantId,t.publicationId],foreignColumns:[publications.tenantId,publications.id]}),index('publication_metrics_history_idx').on(t.tenantId,t.publicationId,t.observedAt,t.recordedAt),check('publication_metrics_source_valid',sql`${t.source} = 'MANUAL'`),check('publication_metrics_note_valid',sql`length(${t.sourceNote}) between 3 and 500`)]);
