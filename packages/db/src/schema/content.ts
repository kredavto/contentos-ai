import { pgTable, uuid, text, integer, timestamp, jsonb, unique, foreignKey } from 'drizzle-orm/pg-core';
import { brands, users } from './identity';
import { audienceSegments, contentPillars } from './brand';
import { jobs } from './generation';
import type { ContentState, ScriptOutput } from '@contentos/types';
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const ideas = pgTable('ideas', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), jobId: uuid('job_id').notNull(), ordinal: integer('ordinal').notNull(),
  title: text('title').notNull(), angle: text('angle').notNull(), hook: text('hook').notNull(), audienceSegmentId: uuid('audience_segment_id'), contentPillarId: uuid('content_pillar_id'),
  audienceLabel: text('audience_label').notNull(), pillarLabel: text('pillar_label').notNull(), funnelStage: text('funnel_stage').notNull(), platform: text('platform').notNull(), format: text('format').notNull(),
  score: integer('score').notNull(), scores: jsonb('scores').$type<Record<string, number>>().notNull(), rationale: text('rationale').notNull(),
  status: text('status', { enum: ['DRAFT', 'SELECTED', 'REJECTED', 'USED', 'ARCHIVED'] }).notNull().default('DRAFT'), source: text('source').notNull(), createdAt: createdAt(),
}, t => [unique('ideas_tenant_id_uq').on(t.tenantId, t.id), unique('ideas_job_ordinal_uq').on(t.jobId, t.ordinal),
  foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }), foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] }),
  foreignKey({ columns: [t.tenantId, t.audienceSegmentId], foreignColumns: [audienceSegments.tenantId, audienceSegments.id] }),
  foreignKey({ columns: [t.tenantId, t.contentPillarId], foreignColumns: [contentPillars.tenantId, contentPillars.id] }),
]);
export const contentItems = pgTable('content_items', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), ideaId: uuid('idea_id'),
  title: text('title').notNull(), type: text('type', { enum: ['SHORT_VIDEO', 'POST', 'CAROUSEL', 'STORY', 'IMAGE'] }).notNull(),
  status: text('status').$type<ContentState>().notNull().default('SCRIPT'), revision: integer('revision').notNull().default(0), createdAt: createdAt(),
}, t => [unique('content_items_tenant_id_uq').on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }), foreignKey({ columns: [t.tenantId, t.ideaId], foreignColumns: [ideas.tenantId, ideas.id] })]);
export const scripts = pgTable('scripts', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(), contentItemId: uuid('content_item_id').notNull(),
  currentVersion: integer('current_version').notNull().default(0), approvedVersion: integer('approved_version'), approvedBy: uuid('approved_by').references(() => users.id),
  platform: text('platform').notNull(), duration: integer('duration').notNull(), createdAt: createdAt(),
}, t => [unique('scripts_tenant_id_uq').on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.brandId], foreignColumns: [brands.tenantId, brands.id] }), foreignKey({ columns: [t.tenantId, t.contentItemId], foreignColumns: [contentItems.tenantId, contentItems.id] })]);
export const scriptVersions = pgTable('script_versions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), scriptId: uuid('script_id').notNull(), jobId: uuid('job_id'),
  version: integer('version').notNull(), content: jsonb('content').$type<ScriptOutput>().notNull(), createdBy: uuid('created_by').notNull().references(() => users.id), createdAt: createdAt(),
}, t => [unique('script_version_number_uq').on(t.scriptId, t.version), unique('script_version_job_uq').on(t.jobId),
  foreignKey({ columns: [t.tenantId, t.scriptId], foreignColumns: [scripts.tenantId, scripts.id] }), foreignKey({ columns: [t.tenantId, t.jobId], foreignColumns: [jobs.tenantId, jobs.id] })]);
