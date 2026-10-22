import {randomUUID,createHash} from 'node:crypto';
import {and,eq,desc,sql,inArray} from 'drizzle-orm';
import {DomainError,imageRequestSchema,type ImageRequest,type ImageUsage,type ProviderReference} from '@contentos/types';
import type {Database} from '../index';
import {generatedImages as images,brands,usagePolicies,usageReservations,auditLogs} from '../schema';
import {assertMembership,lockTenant,reserveInTransaction,settleInTransaction,type Transaction} from './ledger';
export type StoredImage=typeof images.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(images.tenantId,tenantId),eq(images.id,id));
async function brand(tx:Transaction,tenantId:string,brandId:string){const [row]=await tx.select().from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!row)throw new DomainError('NOT_FOUND',404);if(!row.onboardingCompletedAt)throw new DomainError('INVALID_INPUT');}
async function price(tx:Transaction){const [row]=await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,'GENERATE_IMAGE'));if(!row||row.unit!=='AI_CREDITS')throw new DomainError('CONFIGURATION_REQUIRED',503);return row.amount;}
async function audit(tx:Transaction,row:StoredImage,action:string,userId?:string,correlationId?:string){await tx.insert(auditLogs).values({tenantId:row.tenantId,userId:userId??row.requestedBy,resourceId:row.id,correlationId:correlationId??row.correlationId,action,metadata:{attempt:row.attempt}});}
async function terminal(tx:Transaction,row:StoredImage,status:'FAILED'|'RECONCILIATION',code:string){
  await settleInTransaction(tx,row.tenantId,row.reservationId,'RELEASE',row.correlationId);
  await tx.update(images).set({status,errorCode:code,finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null,deleteAfter:new Date(Math.max(Date.now(),row.leaseExpiresAt?.getTime()??0)+60_000)}).where(where(row.tenantId,row.id));
  await audit(tx,row,`IMAGE_${status}`);
}
export class ImageRepository{
  constructor(private readonly db:Database){}
  async overview(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);await brand(tx,tenantId,brandId);
    const items=await tx.select({id:images.id,name:images.name,input:images.input,status:images.status,errorCode:images.errorCode,approvedAt:images.approvedAt,provider:images.provider,model:images.model,bytes:images.bytes,createdAt:images.createdAt}).from(images).where(and(eq(images.tenantId,tenantId),eq(images.brandId,brandId),sql`${images.status}<>'DELETED'`)).orderBy(desc(images.createdAt)).limit(200);
    return {items,cost:await price(tx)};
  });}
  async request(userId:string,tenantId:string,brandId:string,raw:ImageRequest,provider:string,model:string,currency:string,correlationId:string){
    const input=imageRequestSchema.parse(raw),hash=createHash('sha256').update(JSON.stringify({brandId,name:input.name,input:input.input})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');await brand(tx,tenantId,brandId);
      const [existing]=await tx.select().from(images).where(and(eq(images.tenantId,tenantId),eq(images.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==hash||existing.requestedBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const [usage]=await tx.select({count:sql<number>`count(*)::int`,active:sql<number>`count(*) filter (where ${images.status} in ('QUEUED','RUNNING','SUBMITTING'))::int`}).from(images).where(and(eq(images.tenantId,tenantId),sql`${images.status}<>'DELETED'`));
      // Includes in-flight and deletion-pending rows: at most 600 MiB normalized output.
      if((usage?.count??0)>=200||(usage?.active??0)>=4)throw new DomainError('PLAN_LIMIT_REACHED',403);
      const reservation=await reserveInTransaction(tx,tenantId,'AI_CREDITS',await price(tx),`image:${input.idempotencyKey}`,correlationId),id=randomUUID();
      const [row]=await tx.insert(images).values({id,tenantId,brandId,requestedBy:userId,name:input.name,input:input.input,provider,model,currency,storageKey:`${tenantId}/images/${id}.jpg`,reservationId:reservation.id,idempotencyKey:input.idempotencyKey,inputHash:hash,correlationId}).returning();
      await audit(tx,row!,'IMAGE_QUEUED');return {id,status:'QUEUED' as const};
    });
  }
  async due(){return this.db.select({tenantId:images.tenantId,id:images.id}).from(images).where(and(sql`${images.dispatchAfter}<=now()`,sql`(${images.status}='QUEUED' or (${images.status} in ('RUNNING','SUBMITTING') and ${images.leaseExpiresAt}<=now()))`)).orderBy(images.createdAt).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(images).set({dispatchAfter:new Date(Date.now()+10_000)}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const [row]=await tx.select().from(images).where(where(tenantId,id));
    if(!row||!['QUEUED','RUNNING','SUBMITTING'].includes(row.status)||(row.leaseExpiresAt&&row.leaseExpiresAt>new Date()))return null;
    if(row.status==='SUBMITTING'){await terminal(tx,row,'RECONCILIATION','RECONCILIATION_REQUIRED');return null;}
    if(row.attempt>=3){await terminal(tx,row,'FAILED','PROVIDER_UNAVAILABLE');return null;}
    const [claimed]=await tx.update(images).set({status:'RUNNING',attempt:row.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+300_000)}).where(where(tenantId,id)).returning();await audit(tx,claimed!,'IMAGE_RUNNING');return claimed!;
  });}
  private async owned(tx:Transaction,job:StoredImage){const [row]=await tx.select().from(images).where(where(job.tenantId,job.id));if(!row||!['RUNNING','SUBMITTING'].includes(row.status)||row.leaseToken!==job.leaseToken||!row.leaseExpiresAt||row.leaseExpiresAt<=new Date())throw new DomainError('CONFLICT',409);return row;}
  async verify(job:StoredImage){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);await assertMembership(tx,row.requestedBy,row.tenantId,'generate');await brand(tx,row.tenantId,row.brandId);return row;});}
  async submit(job:StoredImage){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);await assertMembership(tx,row.requestedBy,row.tenantId,'generate');await brand(tx,row.tenantId,row.brandId);
    if(row.status!=='RUNNING'||row.submittedAt)throw new DomainError('CONFLICT',409);
    await tx.update(images).set({status:'SUBMITTING',submittedAt:new Date()}).where(where(row.tenantId,row.id));await audit(tx,row,'IMAGE_SUBMITTING');
  });}
  async metering(job:StoredImage,usage:ImageUsage,reference:ProviderReference|null){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);if(row.status!=='SUBMITTING'||row.usage)throw new DomainError('CONFLICT',409);
    await tx.update(images).set({usage,reference}).where(where(row.tenantId,row.id));
  });}
  async complete(job:StoredImage,output:{bytes:number;sha256:string}){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);await assertMembership(tx,row.requestedBy,row.tenantId,'generate');await brand(tx,row.tenantId,row.brandId);
    if(row.status!=='SUBMITTING'||!row.usage)throw new DomainError('CONFLICT',409);
    await settleInTransaction(tx,row.tenantId,row.reservationId,'CAPTURE',row.correlationId);
    await tx.update(images).set({...output,status:'READY',finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(where(row.tenantId,row.id));await audit(tx,row,'IMAGE_READY');
  });}
  async fail(job:StoredImage,code:string,definitive:boolean){await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);await terminal(tx,row,row.status==='SUBMITTING'&&!definitive?'RECONCILIATION':'FAILED',row.status==='SUBMITTING'&&!definitive?'RECONCILIATION_REQUIRED':code);});}
  async ready(userId:string,tenantId:string,brandId:string,id:string,approved:boolean){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);const [row]=await tx.select().from(images).where(and(where(tenantId,id),eq(images.brandId,brandId),eq(images.status,'READY')));
    if(!row)throw new DomainError('NOT_FOUND',404);if(approved&&!row.approvedAt)throw new DomainError('CONFLICT',409);return row;
  });}
  async approve(userId:string,tenantId:string,brandId:string,id:string,correlationId?:string){await this.db.transaction(tx=>approveImageInTransaction(tx,userId,tenantId,brandId,id,correlationId));}
  async delete(userId:string,tenantId:string,brandId:string,id:string,correlationId?:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [row]=await tx.select().from(images).where(and(where(tenantId,id),eq(images.brandId,brandId)));if(!row)throw new DomainError('NOT_FOUND',404);
    if(['DELETE_PENDING','DELETED'].includes(row.status))return {status:row.status};
    const [reservation]=await tx.select().from(usageReservations).where(eq(usageReservations.id,row.reservationId));if(reservation?.status==='HELD')await settleInTransaction(tx,tenantId,row.reservationId,'RELEASE',row.correlationId);
    await tx.update(images).set({status:'DELETE_PENDING',approvedAt:null,approvedBy:null,leaseToken:null,leaseExpiresAt:null,deleteAfter:new Date(Math.max(Date.now(),row.leaseExpiresAt?.getTime()??0)+60_000)}).where(where(tenantId,id));await audit(tx,row,'IMAGE_DELETION_REQUESTED',userId,correlationId);return {status:'DELETE_PENDING'};
  });}
  async claimCleanup(){return this.db.transaction(async tx=>{
    const [row]=await tx.select().from(images).where(and(inArray(images.status,['FAILED','RECONCILIATION','DELETE_PENDING','DELETED']),sql`${images.deleteAfter}<=now()`,sql`(${images.leaseExpiresAt} is null or ${images.leaseExpiresAt}<=now())`)).for('update',{skipLocked:true}).limit(1);if(!row)return null;
    const [claimed]=await tx.update(images).set({leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+60_000),deleteAttempts:row.deleteAttempts+1}).where(where(row.tenantId,row.id)).returning();return claimed!;
  });}
  async cleanupFinished(job:StoredImage,success:boolean){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const [row]=await tx.select().from(images).where(and(where(job.tenantId,job.id),eq(images.leaseToken,job.leaseToken!),sql`${images.leaseExpiresAt}>now()`));if(!row)throw new DomainError('CONFLICT',409);
    const deleted=row.status==='DELETE_PENDING',finished=row.deletedAt??row.finishedAt??new Date();
    await tx.update(images).set({leaseToken:null,leaseExpiresAt:null,deleteAfter:success?(Date.now()-finished.getTime()<86_400_000?new Date(Date.now()+3600_000):null):new Date(Date.now()+Math.min(3600_000,5000*2**Math.min(row.deleteAttempts,10))),...(success&&deleted?{status:'DELETED',input:null,name:'[deleted]',reference:null,sha256:null,approvedAt:null,approvedBy:null,deletedAt:new Date()}:{} )}).where(where(row.tenantId,row.id));
    if(success&&deleted)await audit(tx,row,'IMAGE_DELETED');
  });}
}

export async function approveImageInTransaction(tx:Transaction,userId:string,tenantId:string,brandId:string,id:string,correlationId?:string){
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'approve');const [row]=await tx.select().from(images).where(and(where(tenantId,id),eq(images.brandId,brandId),eq(images.status,'READY')));if(!row)throw new DomainError('NOT_FOUND',404);if(row.approvedAt)return;
    await tx.update(images).set({approvedAt:new Date(),approvedBy:userId}).where(where(tenantId,id));await audit(tx,row,'IMAGE_APPROVED',userId,correlationId);
}
