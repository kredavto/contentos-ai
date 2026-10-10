import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, unique, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { brands, users } from './identity';
export const utmLinks = pgTable('utm_links', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(),
  name: text('name').notNull(), destinationUrl: text('destination_url').notNull(), taggedUrl: text('tagged_url').notNull(),
  source: text('source').notNull(), medium: text('medium').notNull(), campaign: text('campaign').notNull(), term: text('term').notNull().default(''), content: text('content').notNull().default(''),
  createdBy: uuid('created_by').notNull().references(() => users.id), idempotencyKey: uuid('idempotency_key').notNull(), inputHash: text('input_hash').notNull(),
  revision: integer('revision').notNull().default(0), archivedAt: timestamp('archived_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('utm_intent_uq').on(t.tenantId, t.idempotencyKey), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }), index('utm_brand_page_idx').on(t.tenantId, t.brandId, t.id), check('utm_revision_valid', sql`${t.revision} >= 0`), check('utm_urls_valid', sql`${t.destinationUrl} ~ '^https?://' and ${t.taggedUrl} ~ '^https?://'`)]);
