import { pgTable, uuid, integer, text, jsonb, timestamp, unique, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { brands, users } from './identity';
import { contentItems } from './content';
import { jobs } from './generation';
import type { CarouselOutput } from '@contentos/types';
export const carousels = pgTable('carousels', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), contentItemId: uuid('content_item_id').notNull(),
  currentVersion: integer('current_version').notNull().default(1), approvedVersion: integer('approved_version'), approvedBy: uuid('approved_by').references(() => users.id),
  archivedAt: timestamp('archived_at', {withTimezone:true}), lifecycleRevision: integer('lifecycle_revision').notNull().default(0),
  platform: text('platform').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('carousels_tenant_id_uq').on(t.tenantId,t.id), unique('carousels_content_uq').on(t.contentItemId),
  foreignKey({ columns: [t.tenantId,t.brandId], foreignColumns: [brands.tenantId,brands.id] }),
  foreignKey({ columns: [t.tenantId,t.brandId,t.contentItemId], foreignColumns: [contentItems.tenantId,contentItems.brandId,contentItems.id] }),
  check('carousels_lifecycle_valid',sql`${t.lifecycleRevision}>=0 and (${t.archivedAt} is null or (${t.approvedVersion} is null and ${t.approvedBy} is null))`),
  check('carousels_version_valid',sql`${t.currentVersion}>0 and (${t.approvedVersion} is null or ${t.approvedVersion}=${t.currentVersion})`),
]);
export const carouselVersions = pgTable('carousel_versions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), carouselId: uuid('carousel_id').notNull(), version: integer('version').notNull(),
  content: jsonb('content').$type<CarouselOutput>().notNull(), jobId: uuid('job_id'), createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('carousel_version_uq').on(t.carouselId,t.version),unique('carousel_version_job_uq').on(t.jobId),
  foreignKey({columns:[t.tenantId,t.carouselId],foreignColumns:[carousels.tenantId,carousels.id]}),
  foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}), check('carousel_version_positive',sql`${t.version}>0`),
]);
