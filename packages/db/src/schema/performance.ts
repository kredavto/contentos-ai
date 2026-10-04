import {sql} from 'drizzle-orm';
import {pgTable,uuid,integer,text,jsonb,timestamp,unique,foreignKey,index,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';
import {jobs,strategyVersions} from './generation';
import type {PerformanceEvidence,PerformanceOutput,StrategyRecommendation} from '@contentos/types';
export const performanceReports=pgTable('performance_reports',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),jobId:uuid('job_id').notNull(),
  strategyId:uuid('strategy_id').notNull(),strategyVersion:integer('strategy_version').notNull(),brandRevision:integer('brand_revision').notNull(),
  evidence:jsonb('evidence').$type<PerformanceEvidence>().notNull(),output:jsonb('output').$type<PerformanceOutput>().notNull(),provider:text('provider').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('performance_report_tenant_id_uq').on(t.tenantId,t.id),unique('performance_report_job_uq').on(t.jobId),index('performance_report_brand_idx').on(t.tenantId,t.brandId,t.createdAt),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),foreignKey({columns:[t.tenantId,t.jobId],foreignColumns:[jobs.tenantId,jobs.id]}),foreignKey({columns:[t.tenantId,t.strategyId,t.strategyVersion],foreignColumns:[strategyVersions.tenantId,strategyVersions.strategyId,strategyVersions.version]})]);
export const strategyRecommendations=pgTable('strategy_recommendations',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),reportId:uuid('report_id').notNull(),ordinal:integer('ordinal').notNull(),content:jsonb('content').$type<StrategyRecommendation>().notNull(),
},t=>[unique('recommendation_tenant_id_uq').on(t.tenantId,t.id),unique('recommendation_ordinal_uq').on(t.reportId,t.ordinal),foreignKey({columns:[t.tenantId,t.reportId],foreignColumns:[performanceReports.tenantId,performanceReports.id]}),check('recommendation_ordinal_valid',sql`${t.ordinal} between 0 and 2`)]);
export const recommendationDecisions=pgTable('strategy_recommendation_decisions',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),recommendationId:uuid('recommendation_id').notNull(),decision:text('decision').$type<'ACCEPTED'|'REJECTED'>().notNull(),
  strategyId:uuid('strategy_id').notNull(),appliedVersion:integer('applied_version'),actorId:uuid('actor_id').notNull().references(()=>users.id),idempotencyKey:uuid('idempotency_key').notNull(),inputHash:text('input_hash').notNull(),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('recommendation_decision_uq').on(t.recommendationId),unique('recommendation_decision_intent_uq').on(t.tenantId,t.idempotencyKey),foreignKey({columns:[t.tenantId,t.recommendationId],foreignColumns:[strategyRecommendations.tenantId,strategyRecommendations.id]}),foreignKey({columns:[t.tenantId,t.strategyId,t.appliedVersion],foreignColumns:[strategyVersions.tenantId,strategyVersions.strategyId,strategyVersions.version]}),check('recommendation_decision_valid',sql`(${t.decision} = 'ACCEPTED' and ${t.appliedVersion} is not null) or (${t.decision} = 'REJECTED' and ${t.appliedVersion} is null)`)]);
