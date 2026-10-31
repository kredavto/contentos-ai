import { pgTable, uuid, integer, text, jsonb, timestamp, unique, foreignKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { brands, users } from './identity';
import { contentItems } from './content';
import { jobs } from './generation';
import type { PostOutput } from '@contentos/types';
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), contentItemId: uuid('content_item_id').notNull(),
  currentVersion: integer('current_version').notNull().default(1), approvedVersion: integer('approved_version'), approvedBy: uuid('approved_by').references(() => users.id),
  platform: text('platform').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('posts_tenant_id_uq').on(t.tenantId,t.id), unique('posts_content_uq').on(t.contentItemId),
  foreignKey({ columns: [t.tenantId,t.brandId], foreignColumns: [brands.tenantId,brands.id] }),
  foreignKey({ columns: [t.tenantId,t.brandId,t.contentItemId], foreignColumns: [contentItems.tenantId,contentItems.brandId,contentItems.id] }),
  check('posts_version_valid',sql`${t.currentVersion}>0 and (${t.approvedVersion} is null or ${t.approvedVersion}=${t.currentVersion})`),
]);
export const postVersions = pgTable('content_versions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), postId: uuid('post_id').notNull(), version: integer('version').notNull(),
  content: jsonb('content').$type<PostOutput>().notNull(), jobId: uuid('job_id'), createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('post_version_uq').on(t.postId,t.version),unique('post_version_job_uq').on(t.jobId),
  foreignKey({columns:[t.tenantId,t.postId],foreignColumns:[posts.tenantId,posts.id]}),
  foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}), check('post_version_positive',sql`${t.version}>0`),
]);
