import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,jsonb,integer,timestamp,unique,foreignKey,check,index} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import type {EncryptedCredential,ProviderKeyProvider} from '@contentos/types';
export const providerKeys=pgTable('provider_keys',{
 id:uuid('id').primaryKey(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),provider:text('provider').$type<ProviderKeyProvider>().notNull(),
 credential:jsonb('credential').$type<EncryptedCredential>(),maskedKey:text('masked_key').notNull(),status:text('status').$type<'ACTIVE'|'REVOKED'>().notNull(),revision:integer('revision').notNull().default(0),
 createdBy:uuid('created_by').notNull().references(()=>users.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('provider_key_brand_identity_uq').on(t.tenantId,t.brandId,t.id,t.provider),index('provider_key_creator_history_idx').on(t.createdBy,t.createdAt,t.id),unique('provider_key_scope_uq').on(t.tenantId,t.brandId,t.provider),unique('provider_key_tenant_id_uq').on(t.tenantId,t.id),
 foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
 check('provider_key_provider_valid',sql`${t.provider} in ('heygen','openai')`),
 check('provider_key_status_valid',sql`${t.status} in ('ACTIVE','REVOKED') and (${t.status}='ACTIVE')=(${t.credential} is not null)`),
 check('provider_key_revision_valid',sql`${t.revision}>=0`),check('provider_key_mask_valid',sql`length(${t.maskedKey})=12 and left(${t.maskedKey},8)='••••••••'`),
]);
