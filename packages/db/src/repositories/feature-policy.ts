import {createHash} from 'node:crypto';
import {and,eq,inArray,or,sql,desc} from 'drizzle-orm';
import {DomainError,managedFeatures,featureTargetSchema,featurePolicyChangeSchema,type FeatureTarget,type FeaturePolicyChange,type ManagedFeature} from '@contentos/types';
import type {Database} from '../index';
import {featurePolicies,featurePolicyChanges,plans,planVersions,subscriptionTerms,users,organizations,auditLogs} from '../schema';
import {assertMembership,type Transaction} from './ledger';
import {assertPlatformOperator} from './admin';
const priority={GLOBAL:1,PLAN:2,ORGANIZATION:3,USER:4} as const;
/** Rollout policy only. It never substitutes for role, consent, credit or environment checks. */
export async function effectiveFeatures(tx:Transaction,userId:string,tenantId:string,features:readonly ManagedFeature[]=managedFeatures){
 const terms=await tx.select({planId:planVersions.planId}).from(subscriptionTerms).innerJoin(planVersions,eq(planVersions.id,subscriptionTerms.planVersionId)).where(and(eq(subscriptionTerms.tenantId,tenantId),sql`${subscriptionTerms.startsAt}<=now() and ${subscriptionTerms.endsAt}>now()`)).limit(2);
 if(terms.length>1)throw new DomainError('CONFLICT',409);
 const planId=terms[0]?.planId??(await tx.select({id:plans.id}).from(plans).where(eq(plans.code,'FREE')))[0]?.id;
 const rows=await tx.select({feature:featurePolicies.feature,scope:featurePolicies.scope,mode:featurePolicies.mode}).from(featurePolicies).where(and(inArray(featurePolicies.feature,[...features]),or(eq(featurePolicies.scope,'GLOBAL'),eq(featurePolicies.tenantId,tenantId),eq(featurePolicies.userId,userId),planId?eq(featurePolicies.planId,planId):undefined))).limit(features.length*4);
 return features.map(feature=>{
  const selected=rows.filter(row=>row.feature===feature&&row.mode!=='INHERIT').sort((a,b)=>priority[b.scope]-priority[a.scope])[0];
  return {feature,enabled:selected?selected.mode==='ENABLED':feature!=='autopilot',source:selected?.scope??'DEFAULT' as const};
 });
}
export async function assertManagedFeature(tx:Transaction,feature:ManagedFeature,userId:string,tenantId:string){
 if(!(await effectiveFeatures(tx,userId,tenantId,[feature]))[0]?.enabled)throw new DomainError('NOT_AUTHORIZED',403);
}
function targetWhere(input:FeatureTarget){return and(eq(featurePolicies.feature,input.feature),eq(featurePolicies.scope,input.scope),input.scope==='PLAN'?eq(featurePolicies.planId,input.targetId!):undefined,input.scope==='ORGANIZATION'?eq(featurePolicies.tenantId,input.targetId!):undefined,input.scope==='USER'?eq(featurePolicies.userId,input.targetId!):undefined);}
async function targetExists(tx:Transaction,input:FeatureTarget){
 if(input.scope==='GLOBAL')return;
 const table=input.scope==='PLAN'?plans:input.scope==='USER'?users:organizations;
 if(!(await tx.select({id:table.id}).from(table).where(eq(table.id,input.targetId!)).for('key share'))[0])throw new DomainError('NOT_FOUND',404);
}
export class FeaturePolicyRepository{
 constructor(private readonly db:Database){}
 overview(userId:string,tenantId:string){return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);return {features:await effectiveFeatures(tx,userId,tenantId)};});}
 inspect(actorId:string,raw:FeatureTarget,correlationId:string){const input=featureTargetSchema.parse(raw);return this.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='5s'`);const actor=await assertPlatformOperator(tx,actorId);await targetExists(tx,input);
  const [policy]=await tx.select().from(featurePolicies).where(targetWhere(input));
  const changes=policy?await tx.select({id:featurePolicyChanges.id,revision:featurePolicyChanges.revision,mode:featurePolicyChanges.mode,ticket:featurePolicyChanges.ticket,createdAt:featurePolicyChanges.createdAt}).from(featurePolicyChanges).where(eq(featurePolicyChanges.policyId,policy.id)).orderBy(desc(featurePolicyChanges.revision)).limit(11):[];
  await tx.insert(auditLogs).values({userId:actorId,action:'FEATURE_POLICY_INSPECTED',resourceId:policy?.id??null,correlationId,metadata:{feature:input.feature,scope:input.scope}});
  return {target:input,mode:policy?.mode??'INHERIT',revision:policy?.revision??0,canManage:actor.role==='ADMIN',changes:changes.slice(0,10),hasMoreChanges:changes.length>10};
 });}
 change(actorId:string,raw:FeaturePolicyChange,correlationId:string){const input=featurePolicyChangeSchema.parse(raw),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');return this.db.transaction(async tx=>{
  await tx.execute(sql`set local statement_timeout='5s'`);if((await assertPlatformOperator(tx,actorId)).role!=='ADMIN')throw new DomainError('NOT_AUTHORIZED',403);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actorId+'/'+input.idempotencyKey},0))`);
  const [existing]=await tx.select().from(featurePolicyChanges).where(and(eq(featurePolicyChanges.actorId,actorId),eq(featurePolicyChanges.requestKey,input.idempotencyKey)));
  if(existing){if(existing.inputHash!==hash)throw new DomainError('CONFLICT',409);return {id:existing.policyId,revision:existing.revision,mode:existing.mode,replayed:true};}
  await targetExists(tx,input);
  await tx.insert(featurePolicies).values({feature:input.feature,scope:input.scope,planId:input.scope==='PLAN'?input.targetId:null,tenantId:input.scope==='ORGANIZATION'?input.targetId:null,userId:input.scope==='USER'?input.targetId:null,updatedBy:actorId,correlationId}).onConflictDoNothing();
  const [current]=await tx.select().from(featurePolicies).where(targetWhere(input)).for('update');if(!current||current.revision!==input.expectedRevision)throw new DomainError('CONFLICT',409);
  const revision=current.revision+1;
  await tx.insert(featurePolicyChanges).values({policyId:current.id,revision,mode:input.mode,actorId,requestKey:input.idempotencyKey,inputHash:hash,ticket:input.ticket,correlationId});
  await tx.update(featurePolicies).set({mode:input.mode,revision,updatedBy:actorId,correlationId,updatedAt:sql`clock_timestamp()`}).where(eq(featurePolicies.id,current.id));
  await tx.insert(auditLogs).values({userId:actorId,resourceId:current.id,action:'FEATURE_POLICY_CHANGED',correlationId,metadata:{feature:input.feature,scope:input.scope,mode:input.mode,revision,ticket:input.ticket}});
  return {id:current.id,revision,mode:input.mode,replayed:false};
 });}
}
