import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,index,foreignKey,check,uniqueIndex} from 'drizzle-orm/pg-core';
import type {CoverDesign} from '@contentos/types';
import {videoProjects} from './videos';
import {users} from './identity';
import {usageReservations} from './generation';
export const covers=pgTable('covers',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),projectId:uuid('project_id').notNull(),version:integer('version').notNull(),
  requestedBy:uuid('requested_by').notNull().references(()=>users.id),design:jsonb('design').$type<CoverDesign>(),
  status:text('status',{enum:['QUEUED','RUNNING','READY','FAILED','CANCELLED','DELETED']}).notNull().default('QUEUED'),
  storageKey:text('storage_key').notNull().unique(),reservationId:uuid('reservation_id').notNull(),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),correlationId:uuid('correlation_id').notNull(),
  attempt:integer('attempt').notNull().default(0),leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),
  errorCode:text('error_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp('finished_at',{withTimezone:true}),
},t=>[unique('cover_tenant_id_uq').on(t.tenantId,t.id),unique('cover_project_version_uq').on(t.projectId,t.version),unique('cover_intent_uq').on(t.tenantId,t.idempotencyKey),
  uniqueIndex('cover_one_pending_uq').on(t.projectId).where(sql`${t.status} in ('QUEUED','RUNNING')`),index('cover_dispatch_idx').on(t.status,t.dispatchAfter),
  foreignKey({columns:[t.tenantId,t.projectId],foreignColumns:[videoProjects.tenantId,videoProjects.id]}),foreignKey({columns:[t.tenantId,t.reservationId],foreignColumns:[usageReservations.tenantId,usageReservations.id]}),
  check('cover_version_valid',sql`${t.version} > 0 and ${t.attempt} >= 0`),check('cover_status_valid',sql`${t.status} in ('QUEUED','RUNNING','READY','FAILED','CANCELLED','DELETED')`),
  check('cover_design_valid',sql`(${t.status} = 'DELETED' and ${t.design} is null) or (${t.status} <> 'DELETED' and ${t.design} is not null)`),check('cover_key_tenant',sql`${t.storageKey} like ${t.tenantId}::text || '/%'`),
]);
