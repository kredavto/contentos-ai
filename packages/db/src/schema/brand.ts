import { pgTable, uuid, text, timestamp, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core';
import { brands } from './identity';
export const brandProfiles = pgTable('brand_profiles', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(),
  website: text('website'), niche: text('niche'), geography: text('geography'), description: text('description'), usp: text('usp'),
  goals: text('goals').array().notNull().default([]), socialPlatforms: text('social_platforms').array().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('brand_profiles_brand_uq').on(t.tenantId, t.brandId), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }).onDelete('cascade')]);
function brainEntity(name: string) {
  return pgTable(name, {
    id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(),
    name: text('name').notNull(), description: text('description').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }, t => [uniqueIndex(`${name}_tenant_id_uq`).on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }).onDelete('cascade')]);
}
export const products = brainEntity('products');
export const audienceSegments = brainEntity('audience_segments');
export const painPoints = brainEntity('pain_points');
export const desires = brainEntity('desires');
export const objections = brainEntity('objections');
export const competitors = brainEntity('competitors');
export const positioning = brainEntity('positioning');
export const brandVoice = brainEntity('brand_voice');
export const brandRules = brainEntity('brand_rules');
export const offers = brainEntity('offers');
export const leadMagnets = brainEntity('lead_magnets');
export const ctas = brainEntity('ctas');
export const contentPillars = brainEntity('content_pillars');
export const referenceContent = brainEntity('reference_content');
