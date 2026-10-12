import { pgTable, uuid, integer, jsonb, timestamp, unique, foreignKey, index } from 'drizzle-orm/pg-core';
import { brands } from './identity';
import { jobs } from './generation';
import { scriptVersions } from './content';
import type { BrandReviewOutput } from '@contentos/types';
export const brandReviews = pgTable('brand_reviews', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(),
  jobId: uuid('job_id').notNull(), scriptId: uuid('script_id').notNull(), scriptVersion: integer('script_version').notNull(),
  brandRevision: integer('brand_revision').notNull(), content: jsonb('content').$type<BrandReviewOutput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('brand_reviews_job_uq').on(t.jobId), index('brand_reviews_scope_idx').on(t.tenantId, t.brandId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }),
  foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] }),
  foreignKey({ columns: [t.tenantId, t.scriptId, t.scriptVersion], foreignColumns: [scriptVersions.tenantId, scriptVersions.scriptId, scriptVersions.version] }),
]);
