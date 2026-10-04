import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,jsonb,timestamp,unique,uniqueIndex,foreignKey,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import type {ProviderReference,EncryptedCredential,SocialStatus} from '@contentos/types';
export const socialConnections=pgTable('social_connections',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),provider:text('provider').notNull(),reference:jsonb('reference').$type<ProviderReference>().notNull(),
  name:text('name').notNull(),username:text('username'),status:text('status').$type<SocialStatus>().notNull(),credential:jsonb('credential').$type<EncryptedCredential>(),credentialVersion:integer('credential_version').notNull().default(1),revision:integer('revision').notNull().default(0),
  idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),createdBy:uuid('created_by').notNull().references(()=>users.id),lastCheckedAt:timestamp('last_checked_at',{withTimezone:true}),errorCode:text('error_code'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('social_tenant_id_uq').on(t.tenantId,t.id),unique('social_intent_uq').on(t.tenantId,t.idempotencyKey),uniqueIndex('social_channel_uq').on(t.tenantId,t.brandId,t.provider,sql`(${t.reference}->>'externalId')`),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),check('social_status_valid',sql`${t.status} in ('PENDING','CONNECTED','LIMITED','ACTIVE','TOKEN_EXPIRED','REVOKED','ERROR')`),check('social_revision_valid',sql`${t.revision} >= 0 and ${t.credentialVersion} >= 1`),check('social_credential_required',sql`(${t.status} = 'REVOKED' and ${t.credential} is null) or (${t.status} <> 'REVOKED' and ${t.credential} is not null)`),check('social_reference_valid',sql`${t.reference}->>'provider' = ${t.provider} and ${t.reference}->>'internalId' = ${t.id}::text`),
]);
