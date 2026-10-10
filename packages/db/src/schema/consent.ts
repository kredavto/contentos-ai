import { sql } from 'drizzle-orm';
import { pgTable,uuid,text,timestamp,unique,foreignKey,index,check } from 'drizzle-orm/pg-core';
import { brands,users } from './identity';
import type { ConsentType } from '@contentos/types';
export const consentSubjects=pgTable('consent_subjects',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),name:text('name').notNull(),type:text('type',{enum:['PERSON','VOICE','ORGANIZATION']}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('consent_subject_tenant_id_uq').on(t.tenantId,t.id),foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),check('consent_subject_type_valid',sql`${t.type} in ('PERSON','VOICE','ORGANIZATION')`)]);
export const consentRecords=pgTable('consent_records',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),subjectId:uuid('subject_id').notNull(),
  subjectType:text('subject_type').notNull(),subjectName:text('subject_name').notNull(),consentType:text('consent_type').$type<ConsentType>().notNull(),consentVersion:text('consent_version').notNull(),consentTextHash:text('consent_text_hash').notNull(),
  acceptedAt:timestamp('accepted_at',{withTimezone:true}).notNull().defaultNow(),acceptedByUserId:uuid('accepted_by_user_id').notNull().references(()=>users.id),ipAddress:text('ip_address').notNull(),userAgent:text('user_agent').notNull(),
  revokedAt:timestamp('revoked_at',{withTimezone:true}),revokedByUserId:uuid('revoked_by_user_id').references(()=>users.id),idempotencyKey:uuid('idempotency_key').notNull(),
},t=>[index('consent_acceptor_created_idx').on(t.acceptedByUserId,t.acceptedAt,t.id),index('consent_revoker_created_idx').on(t.revokedByUserId,t.revokedAt,t.id),unique('consent_tenant_id_uq').on(t.tenantId,t.id),unique('consent_idempotency_uq').on(t.tenantId,t.idempotencyKey),index('consent_subject_active_idx').on(t.tenantId,t.subjectId,t.consentType,t.revokedAt),foreignKey({columns:[t.tenantId,t.subjectId],foreignColumns:[consentSubjects.tenantId,consentSubjects.id]}),check('consent_type_valid',sql`${t.consentType} in ('OWN_LIKENESS','THIRD_PARTY_LIKENESS','VOICE_CLONING','CROSS_BORDER_PROCESSING','AUTOMATED_PUBLISHING')`),check('consent_hash_valid',sql`${t.consentTextHash} ~ '^[a-f0-9]{64}$'`),check('consent_revocation_valid',sql`(${t.revokedAt} is null and ${t.revokedByUserId} is null) or (${t.revokedAt} >= ${t.acceptedAt} and ${t.revokedByUserId} is not null)`) ]);
