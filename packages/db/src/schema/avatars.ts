import { sql } from 'drizzle-orm';
import { pgTable,uuid,text,timestamp,jsonb,integer,unique,index,foreignKey,check } from 'drizzle-orm/pg-core';
import { brands } from './identity';
import { consentSubjects } from './consent';
import { mediaAssets } from './media';
import { jobs } from './generation';
import type { ProviderReference,AvatarStatus,AvatarLookStatus } from '@contentos/types';
export const avatars=pgTable('avatars',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),subjectId:uuid('subject_id').notNull(),
  name:text('name').notNull(),provider:text('provider').notNull(),status:text('status').$type<AvatarStatus>().notNull().default('ACTIVE'),reference:jsonb('reference').$type<ProviderReference>(),
  leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),deleteAfter:timestamp('delete_after',{withTimezone:true}),deleteAttempts:integer('delete_attempts').notNull().default(0),errorCode:text('error_code'),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),deletedAt:timestamp('deleted_at',{withTimezone:true}),
},t=>[unique('avatar_tenant_id_uq').on(t.tenantId,t.id),index('avatar_brand_idx').on(t.tenantId,t.brandId),index('avatar_deletion_idx').on(t.status,t.deleteAfter),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.subjectId],foreignColumns:[consentSubjects.tenantId,consentSubjects.id]}),check('avatar_status_valid',sql`${t.status} in ('ACTIVE','DELETE_PENDING','DELETED')`),
]);
export const avatarLooks=pgTable('avatar_looks',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),avatarId:uuid('avatar_id').notNull(),sourceAssetId:uuid('source_asset_id').notNull(),jobId:uuid('job_id').notNull(),name:text('name').notNull(),
  status:text('status').$type<AvatarLookStatus>().notNull().default('QUEUED'),reference:jsonb('reference').$type<ProviderReference>(),
  mutationState:text('mutation_state',{enum:['NONE','STARTED','ACCEPTED','REJECTED','UNKNOWN']}).notNull().default('NONE'),firstSubmittedAt:timestamp('first_submitted_at',{withTimezone:true}),errorCode:text('error_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('avatar_look_tenant_id_uq').on(t.tenantId,t.id),unique('avatar_look_job_uq').on(t.jobId),index('avatar_look_parent_idx').on(t.tenantId,t.avatarId),
  foreignKey({columns:[t.tenantId,t.avatarId],foreignColumns:[avatars.tenantId,avatars.id]}),foreignKey({columns:[t.tenantId,t.sourceAssetId],foreignColumns:[mediaAssets.tenantId,mediaAssets.id]}),foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}),
  check('avatar_look_status_valid',sql`${t.status} in ('QUEUED','PROCESSING','READY','FAILED','RECONCILIATION')`),check('avatar_mutation_state_valid',sql`${t.mutationState} in ('NONE','STARTED','ACCEPTED','REJECTED','UNKNOWN')`),
]);
