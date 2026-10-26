import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,timestamp,unique,check,index} from 'drizzle-orm/pg-core';
import {users,organizations} from './identity';
import {plans} from './billing';
export const featurePolicies=pgTable('feature_policies',{
 id:uuid('id').primaryKey().defaultRandom(),feature:text('feature').notNull(),scope:text('scope',{enum:['GLOBAL','PLAN','ORGANIZATION','USER']}).notNull(),
 planId:uuid('plan_id').references(()=>plans.id),tenantId:uuid('tenant_id').references(()=>organizations.id),userId:uuid('user_id').references(()=>users.id),
 mode:text('mode',{enum:['ENABLED','DISABLED','INHERIT']}).notNull().default('INHERIT'),revision:integer('revision').notNull().default(0),
 updatedBy:uuid('updated_by').notNull().references(()=>users.id),correlationId:uuid('correlation_id').notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('feature_policy_actor_idx').on(t.updatedBy),index('feature_policy_user_idx').on(t.userId,t.feature),index('feature_policy_tenant_idx').on(t.tenantId,t.feature),index('feature_policy_plan_idx').on(t.planId,t.feature),index('feature_policy_global_idx').on(t.feature).where(sql`${t.scope}='GLOBAL'`),unique('feature_policy_target_uq').on(t.feature,t.scope,t.planId,t.tenantId,t.userId).nullsNotDistinct(),
 check('feature_policy_feature_valid',sql`${t.feature} in ('avatar_generation','video_generation','trend_radar','instagram_publishing','tiktok_publishing','youtube_publishing','telegram_publishing','autopilot','comments','analytics_ai','agency_mode','byok')`),
 check('feature_policy_scope_valid',sql`(${t.scope}='GLOBAL' and ${t.planId} is null and ${t.tenantId} is null and ${t.userId} is null) or (${t.scope}='PLAN' and ${t.planId} is not null and ${t.tenantId} is null and ${t.userId} is null) or (${t.scope}='ORGANIZATION' and ${t.planId} is null and ${t.tenantId} is not null and ${t.userId} is null) or (${t.scope}='USER' and ${t.planId} is null and ${t.tenantId} is null and ${t.userId} is not null)`),
 check('feature_policy_state_valid',sql`${t.revision}>=0 and ${t.mode} in ('ENABLED','DISABLED','INHERIT')`)]);
export const featurePolicyChanges=pgTable('feature_policy_changes',{
 id:uuid('id').primaryKey().defaultRandom(),policyId:uuid('policy_id').notNull().references(()=>featurePolicies.id),revision:integer('revision').notNull(),mode:text('mode',{enum:['ENABLED','DISABLED','INHERIT']}).notNull(),
 actorId:uuid('actor_id').notNull().references(()=>users.id),requestKey:uuid('request_key').notNull(),inputHash:text('input_hash').notNull(),ticket:text('ticket').notNull(),correlationId:uuid('correlation_id').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('feature_policy_change_revision_uq').on(t.policyId,t.revision),unique('feature_policy_change_intent_uq').on(t.actorId,t.requestKey),index('feature_policy_change_history_idx').on(t.policyId,t.createdAt,t.id),check('feature_policy_change_valid',sql`${t.revision}>0 and ${t.mode} in ('ENABLED','DISABLED','INHERIT') and ${t.inputHash} ~ '^[a-f0-9]{64}$' and ${t.ticket} ~ '^[A-Za-z0-9_-]{3,80}$'`)]);
