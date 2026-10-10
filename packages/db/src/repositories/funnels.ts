import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DomainError, type FunnelCreate, type FunnelMeasurement, type FunnelChoices } from '@contentos/types';
import type { Database } from '../index';
import { auditLogs, brands, contentItems, utmLinks, funnelTargets, funnelMeasurements } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
const targetProjection = { id:funnelTargets.id,contentItemId:funnelTargets.contentItemId,utmLinkId:funnelTargets.utmLinkId,cta:funnelTargets.cta,destinationType:funnelTargets.destinationType,createdAt:funnelTargets.createdAt };
const measurementProjection = {id:funnelMeasurements.id,from:funnelMeasurements.from,to:funnelMeasurements.to,version:funnelMeasurements.version,clicks:funnelMeasurements.clicks,leads:funnelMeasurements.leads,source:funnelMeasurements.source,createdAt:funnelMeasurements.createdAt};
const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const page = <T extends {id:string}>(rows:T[]) => ({ rows: rows.slice(0,50), nextCursor: rows.length>50 ? rows[49]!.id : null });
async function ownedBrand(tx:Transaction,tenantId:string,brandId:string){const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);}
async function ownedTarget(tx:Transaction,tenantId:string,brandId:string,id:string){const [target]=await tx.select(targetProjection).from(funnelTargets).where(and(eq(funnelTargets.tenantId,tenantId),eq(funnelTargets.brandId,brandId),eq(funnelTargets.id,id)));if(!target)throw new DomainError('NOT_FOUND',404);return target;}
export class FunnelRepository {
  constructor(private readonly db:Database){}
  async choices(userId:string,tenantId:string,brandId:string,input:FunnelChoices){
    return this.db.transaction(async tx=>{await tx.execute(sql`set local statement_timeout = '5s'`);await assertMembership(tx,userId,tenantId);await ownedBrand(tx,tenantId,brandId);
      if(input.kind==='CONTENT')return page(await tx.select({id:contentItems.id,name:contentItems.title}).from(contentItems).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.brandId,brandId),input.before?lt(contentItems.id,input.before):undefined,sql`strpos(lower(${contentItems.title}),lower(${input.search}))>0`)).orderBy(desc(contentItems.id)).limit(51));
      return page(await tx.select({id:utmLinks.id,name:utmLinks.name}).from(utmLinks).where(and(eq(utmLinks.tenantId,tenantId),eq(utmLinks.brandId,brandId),isNull(utmLinks.archivedAt),input.before?lt(utmLinks.id,input.before):undefined,sql`strpos(lower(${utmLinks.name}),lower(${input.search}))>0`)).orderBy(desc(utmLinks.id)).limit(51));
    });
  }
  async list(userId:string,tenantId:string,brandId:string,before?:string){return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);await ownedBrand(tx,tenantId,brandId);return page(await tx.select({...targetProjection,title:contentItems.title,taggedUrl:utmLinks.taggedUrl,linkArchivedAt:utmLinks.archivedAt}).from(funnelTargets).innerJoin(contentItems,and(eq(contentItems.tenantId,funnelTargets.tenantId),eq(contentItems.brandId,funnelTargets.brandId),eq(contentItems.id,funnelTargets.contentItemId))).innerJoin(utmLinks,and(eq(utmLinks.tenantId,funnelTargets.tenantId),eq(utmLinks.brandId,funnelTargets.brandId),eq(utmLinks.id,funnelTargets.utmLinkId))).where(and(eq(funnelTargets.tenantId,tenantId),eq(funnelTargets.brandId,brandId),before?lt(funnelTargets.id,before):undefined)).orderBy(desc(funnelTargets.id)).limit(51));});}
  async create(userId:string,tenantId:string,brandId:string,input:FunnelCreate,correlationId:string){const inputHash=hash({brandId,...input});return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');await ownedBrand(tx,tenantId,brandId);
    const [existing]=await tx.select({...targetProjection,createdBy:funnelTargets.createdBy,inputHash:funnelTargets.inputHash}).from(funnelTargets).where(and(eq(funnelTargets.tenantId,tenantId),eq(funnelTargets.idempotencyKey,input.idempotencyKey)));
    if(existing){if(existing.createdBy!==userId||existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);const {createdBy:_actor,inputHash:_hash,...safe}=existing;return safe;}
    const [content]=await tx.select({id:contentItems.id}).from(contentItems).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.brandId,brandId),eq(contentItems.id,input.contentItemId)));
    const [link]=await tx.select({id:utmLinks.id}).from(utmLinks).where(and(eq(utmLinks.tenantId,tenantId),eq(utmLinks.brandId,brandId),eq(utmLinks.id,input.utmLinkId),isNull(utmLinks.archivedAt)));
    if(!content||!link)throw new DomainError('NOT_FOUND',404);
    const [result]=await tx.insert(funnelTargets).values({...input,tenantId,brandId,createdBy:userId,inputHash}).returning(targetProjection);if(!result)throw new Error('Funnel insert failed');
    await tx.insert(auditLogs).values({tenantId,userId,action:'FUNNEL_TARGET_CREATED',resourceId:result.id,correlationId});return result;
  });}
  async measurements(userId:string,tenantId:string,brandId:string,targetId:string,before?:string){return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);await ownedTarget(tx,tenantId,brandId,targetId);return page(await tx.select({...measurementProjection,currentVersion:sql<number>`(select max(newer.version) from funnel_measurements newer where newer.target_id=${funnelMeasurements.targetId} and newer.from_at=${funnelMeasurements.from} and newer.to_at=${funnelMeasurements.to})`.mapWith(Number)}).from(funnelMeasurements).where(and(eq(funnelMeasurements.tenantId,tenantId),eq(funnelMeasurements.brandId,brandId),eq(funnelMeasurements.targetId,targetId),before?lt(funnelMeasurements.id,before):undefined)).orderBy(desc(funnelMeasurements.id)).limit(51));});}
  async measure(userId:string,tenantId:string,brandId:string,targetId:string,input:FunnelMeasurement,correlationId:string){const inputHash=hash({brandId,targetId,...input});return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');await ownedTarget(tx,tenantId,brandId,targetId);
    const [existing]=await tx.select({...measurementProjection,createdBy:funnelMeasurements.createdBy,inputHash:funnelMeasurements.inputHash}).from(funnelMeasurements).where(and(eq(funnelMeasurements.tenantId,tenantId),eq(funnelMeasurements.idempotencyKey,input.idempotencyKey)));
    if(existing){if(existing.createdBy!==userId||existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);const {createdBy:_actor,inputHash:_hash,...safe}=existing;return safe;}
    const from=new Date(input.from),to=new Date(input.to);
    const [latest]=await tx.select({version:funnelMeasurements.version}).from(funnelMeasurements).where(and(eq(funnelMeasurements.targetId,targetId),eq(funnelMeasurements.from,from),eq(funnelMeasurements.to,to))).orderBy(desc(funnelMeasurements.version)).limit(1);
    if((latest?.version??0)!==input.expectedVersion)throw new DomainError('CONFLICT',409);
    const [result]=await tx.insert(funnelMeasurements).values({tenantId,brandId,targetId,from,to,version:input.expectedVersion+1,clicks:input.clicks,leads:input.leads,source:input.source,createdBy:userId,idempotencyKey:input.idempotencyKey,inputHash}).returning(measurementProjection);if(!result)throw new Error('Funnel measurement insert failed');
    await tx.insert(auditLogs).values({tenantId,userId,action:'FUNNEL_MEASUREMENT_RECORDED',resourceId:result.id,correlationId,metadata:{version:result.version}});return result;
  });}
}
