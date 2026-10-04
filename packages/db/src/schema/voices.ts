import {pgTable,uuid,text,jsonb,timestamp,unique,foreignKey} from 'drizzle-orm/pg-core';
import {brands} from './identity';
import type {ProviderReference} from '@contentos/types';
export const voiceProfiles=pgTable('voice_profiles',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),provider:text('provider').notNull(),externalId:text('external_id').notNull(),
  reference:jsonb('reference').$type<ProviderReference>().notNull(),name:text('name').notNull(),language:text('language'),previewUrl:text('preview_url'),
  refreshedAt:timestamp('refreshed_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('voice_tenant_id_uq').on(t.tenantId,t.id),unique('voice_catalog_uq').on(t.tenantId,t.brandId,t.provider,t.externalId),foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]})]);
