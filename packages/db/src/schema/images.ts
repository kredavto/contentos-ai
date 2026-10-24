import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,index,foreignKey,check} from 'drizzle-orm/pg-core';
import type {ImageGenerationInput,ImageUsage,ProviderReference} from '@contentos/types';
import {brands,users} from './identity';
import {usageReservations} from './generation';
export const generatedImages=pgTable('generated_images',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),requestedBy:uuid('requested_by').notNull().references(()=>users.id),
  name:text('name').notNull(),input:jsonb('input').$type<ImageGenerationInput>(),provider:text('provider').notNull(),model:text('model').notNull(),currency:text('currency').notNull().default('USD'),
  status:text('status',{enum:['QUEUED','RUNNING','SUBMITTING','READY','FAILED','RECONCILIATION','DELETE_PENDING','DELETED']}).notNull().default('QUEUED'),
  storageKey:text('storage_key').notNull().unique(),reservationId:uuid('reservation_id').notNull(),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),correlationId:uuid('correlation_id').notNull(),
  reference:jsonb('reference').$type<ProviderReference>(),usage:jsonb('usage').$type<ImageUsage>(),submittedAt:timestamp('submitted_at',{withTimezone:true}),
  bytes:integer('bytes'),sha256:text('sha256'),approvedAt:timestamp('approved_at',{withTimezone:true}),approvedBy:uuid('approved_by').references(()=>users.id),
  attempt:integer('attempt').notNull().default(0),leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),
  errorCode:text('error_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp('finished_at',{withTimezone:true}),
  deleteAfter:timestamp('delete_after',{withTimezone:true}),deleteAttempts:integer('delete_attempts').notNull().default(0),deletedAt:timestamp('deleted_at',{withTimezone:true}),
},t=>[unique('image_tenant_id_uq').on(t.tenantId,t.id),unique('image_intent_uq').on(t.tenantId,t.idempotencyKey),index('image_dispatch_idx').on(t.status,t.dispatchAfter),index('image_cleanup_idx').on(t.deleteAfter),index('image_submitted_tenant_idx').on(t.submittedAt,t.tenantId),index('image_created_tenant_idx').on(t.createdAt,t.tenantId),
  check('image_currency_valid',sql`${t.currency} ~ '^[A-Z]{3}$'`),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.reservationId],foreignColumns:[usageReservations.tenantId,usageReservations.id]}),
  check('image_status_valid',sql`${t.status} in ('QUEUED','RUNNING','SUBMITTING','READY','FAILED','RECONCILIATION','DELETE_PENDING','DELETED')`),
  check('image_input_valid',sql`(${t.status}='DELETED' and ${t.input} is null) or (${t.status}<>'DELETED' and ${t.input} is not null)`),
  check('image_key_tenant',sql`${t.storageKey} like ${t.tenantId}::text || '/%'`),check('image_bytes_valid',sql`${t.bytes} is null or ${t.bytes} between 1 and 3145728`),
  check('image_ready_valid',sql`${t.status}<>'READY' or (${t.bytes} is not null and ${t.sha256} is not null and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.submittedAt} is not null)`),
  check('image_approval_valid',sql`(${t.approvedAt} is null and ${t.approvedBy} is null) or (${t.approvedAt} is not null and ${t.approvedBy} is not null and ${t.status}='READY')`),
  check('image_attempt_valid',sql`${t.attempt}>=0 and ${t.deleteAttempts}>=0`),
]);
