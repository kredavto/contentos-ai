import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, unique, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { contentItems } from './content';
import { utmLinks } from './utm';
export const funnelTargets = pgTable('funnel_targets', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), contentItemId: uuid('content_item_id').notNull(), utmLinkId: uuid('utm_link_id').notNull(),
  cta: text('cta').notNull(), destinationType: text('destination_type').notNull(), createdBy: uuid('created_by').notNull().references(() => users.id), idempotencyKey: uuid('idempotency_key').notNull(), inputHash: text('input_hash').notNull(), createdAt: timestamp('created_at', { withTimezone:true }).notNull().defaultNow(),
}, t => [unique('funnel_target_scope_uq').on(t.tenantId,t.brandId,t.id), unique('funnel_target_intent_uq').on(t.tenantId,t.idempotencyKey), index('funnel_target_page_idx').on(t.tenantId,t.brandId,t.id),
  foreignKey({columns:[t.tenantId,t.brandId,t.contentItemId],foreignColumns:[contentItems.tenantId,contentItems.brandId,contentItems.id]}),foreignKey({columns:[t.tenantId,t.brandId,t.utmLinkId],foreignColumns:[utmLinks.tenantId,utmLinks.brandId,utmLinks.id]}),
  check('funnel_destination_valid',sql`${t.destinationType} in ('URL','WEBSITE','TELEGRAM','LEAD_FORM','MESSENGER')`),
]);
export const funnelMeasurements = pgTable('funnel_measurements', {
  id: uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),targetId:uuid('target_id').notNull(),
  from:timestamp('from_at',{withTimezone:true}).notNull(),to:timestamp('to_at',{withTimezone:true}).notNull(),version:integer('version').notNull(),clicks:integer('clicks'),leads:integer('leads'),source:text('source').notNull(),
  createdBy:uuid('created_by').notNull().references(()=>users.id),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('funnel_measurement_intent_uq').on(t.tenantId,t.idempotencyKey),unique('funnel_measurement_version_uq').on(t.targetId,t.from,t.to,t.version),index('funnel_measurement_page_idx').on(t.tenantId,t.brandId,t.targetId,t.id),foreignKey({columns:[t.tenantId,t.brandId,t.targetId],foreignColumns:[funnelTargets.tenantId,funnelTargets.brandId,funnelTargets.id]}),check('funnel_measurement_valid',sql`${t.version}>0 and ${t.to}>${t.from} and ${t.to}-${t.from}<=interval '93 days' and (${t.clicks} is not null or ${t.leads} is not null) and (${t.clicks} is null or ${t.clicks} between 0 and 1000000000) and (${t.leads} is null or ${t.leads} between 0 and 1000000000)`)]);
