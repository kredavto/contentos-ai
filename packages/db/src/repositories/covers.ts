import {randomUUID,createHash} from 'node:crypto';
import {and,eq,desc,sql,inArray} from 'drizzle-orm';
import {DomainError,coverRequestSchema,type CoverRequest,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {covers,videoProjects,publishingJobs,usagePolicies,auditLogs} from '../schema';
import {assertMembership,lockTenant,reserveInTransaction,settleInTransaction,type Transaction} from './ledger';
import {validateVideo} from './videos';
import type {ConsentPolicy} from './avatars';
export type StoredCover=typeof covers.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(covers.tenantId,tenantId),eq(covers.id,id));
async function project(tx:Transaction,tenantId:string,id:string,policies:ConsentPolicy[],brandId?:string){
  const [row]=await tx.select().from(videoProjects).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.id,id),...(brandId?[eq(videoProjects.brandId,brandId)]:[])));
  if(!row||row.stage!=='READY'||row.lifecycle!=='ACTIVE')throw new DomainError('NOT_FOUND',404);
  await validateVideo(tx,row,policies);return row;
}
async function policy(tx:Transaction){const [row]=await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,'GENERATE_COVER'));if(!row||row.unit!=='AI_CREDITS')throw new DomainError('CONFIGURATION_REQUIRED',503);return row;}
async function transition(tx:Transaction,cover:StoredCover,status:StoredCover['status'],code:string|null=null){
  await tx.update(covers).set({status,errorCode:code,leaseToken:null,leaseExpiresAt:null,...(['READY','FAILED'].includes(status)?{finishedAt:new Date()}:{})}).where(where(cover.tenantId,cover.id));
  await tx.insert(auditLogs).values({tenantId:cover.tenantId,userId:cover.requestedBy,action:`COVER_${status}`,resourceId:cover.id,correlationId:cover.correlationId,metadata:{version:cover.version,attempt:cover.attempt,code}});
}
/** Part of the video's deletion transaction; fences all cover writes and releases held reserves. */
export async function cancelVideoCovers(tx:Transaction,tenantId:string,projectId:string,correlationId:string){
  const rows=await tx.select().from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.projectId,projectId),inArray(covers.status,['QUEUED','RUNNING'])));
  let after=Date.now();
  for(const row of rows){if(row.status==='RUNNING')after=Math.max(after,(row.leaseExpiresAt?.getTime()??Date.now())+60_000);await settleInTransaction(tx,tenantId,row.reservationId,'RELEASE',correlationId);await transition(tx,row,'CANCELLED','DELETION_REQUESTED');}
  return after;
}
export class CoverRepository {
  constructor(private readonly db:Database){}
  async overview(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[]){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);const video=await project(tx,tenantId,id,policies,brandId);
    const versions=await tx.select({id:covers.id,version:covers.version,design:covers.design,status:covers.status,errorCode:covers.errorCode,createdAt:covers.createdAt}).from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.projectId,id))).orderBy(desc(covers.version)).limit(50);
    return {versions,revision:video.coverRevision,selectedVersion:video.coverVersion,initialDesign:video.options.cover??null,cost:(await policy(tx)).amount};
  });}
  async request(userId:string,tenantId:string,brandId:string,id:string,raw:CoverRequest,policies:ConsentPolicy[],correlationId:string){
    const input=coverRequestSchema.parse(raw),inputHash=createHash('sha256').update(JSON.stringify({projectId:id,design:input.design})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');await project(tx,tenantId,id,policies,brandId);
      const [existing]=await tx.select().from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.requestedBy!==userId||existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const rows=await tx.select({version:covers.version,status:covers.status}).from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.projectId,id))).orderBy(desc(covers.version)).limit(50);
      if(rows.some(row=>['QUEUED','RUNNING'].includes(row.status)))throw new DomainError('CONFLICT',409);
      if(rows.length>=50)throw new DomainError('PLAN_LIMIT_REACHED',403);
      const price=await policy(tx),reservation=await reserveInTransaction(tx,tenantId,'AI_CREDITS',price.amount,`cover:${input.idempotencyKey}`,correlationId);
      const coverId=randomUUID(),version=(rows[0]?.version??0)+1;
      const [cover]=await tx.insert(covers).values({id:coverId,tenantId,projectId:id,requestedBy:userId,version,design:input.design,storageKey:`${tenantId}/videos/${id}/covers/${coverId}.jpg`,reservationId:reservation.id,idempotencyKey:input.idempotencyKey,inputHash,correlationId}).returning();
      await transition(tx,cover!,'QUEUED');return {id:coverId,status:'QUEUED' as const};
    });
  }
  async ready(userId:string,tenantId:string,brandId:string,id:string,version:number,policies:ConsentPolicy[]){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);await project(tx,tenantId,id,policies,brandId);
    if(version===0)return `${tenantId}/videos/${id}/cover.jpg`;
    const [row]=await tx.select().from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.projectId,id),eq(covers.version,version),eq(covers.status,'READY')));
    if(!row)throw new DomainError('NOT_FOUND',404);return row.storageKey;
  });}
  async select(userId:string,tenantId:string,brandId:string,id:string,input:{version:number;revision:number},policies:ConsentPolicy[],correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const video=await project(tx,tenantId,id,policies,brandId);
    if(video.coverRevision!==input.revision)throw new DomainError('CONFLICT',409);
    if(video.coverVersion===input.version)return {revision:video.coverRevision};
    const [pending]=await tx.select({id:publishingJobs.id}).from(publishingJobs).where(and(eq(publishingJobs.tenantId,tenantId),sql`${publishingJobs.snapshot}->>'videoProjectId' = ${id}`,inArray(publishingJobs.status,['SCHEDULED','PREPARING','SUBMITTING','RECONCILIATION']))).limit(1);
    if(pending)throw new DomainError('CONFLICT',409);
    let key=`${tenantId}/videos/${id}/cover.jpg`;
    if(input.version!==0){const [row]=await tx.select().from(covers).where(and(eq(covers.tenantId,tenantId),eq(covers.projectId,id),eq(covers.version,input.version),eq(covers.status,'READY')));if(!row)throw new DomainError('NOT_FOUND',404);key=row.storageKey;}
    await tx.update(videoProjects).set({coverKey:key,coverVersion:input.version,coverRevision:video.coverRevision+1,approvedAt:null,approvedBy:null}).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.id,id)));
    await tx.insert(auditLogs).values({tenantId,userId,action:'COVER_SELECTED',resourceId:id,correlationId,metadata:{version:input.version,revision:video.coverRevision+1}});return {revision:video.coverRevision+1};
  });}
  async due(){return this.db.select({tenantId:covers.tenantId,id:covers.id}).from(covers).where(and(sql`${covers.dispatchAfter} <= now()`,sql`((${covers.status} = 'QUEUED' and ${covers.nextAttemptAt} <= now()) or (${covers.status} = 'RUNNING' and ${covers.leaseExpiresAt} <= now()))`)).orderBy(covers.nextAttemptAt).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(covers).set({dispatchAfter:new Date(Date.now()+10000)}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const [row]=await tx.select().from(covers).where(where(tenantId,id));
    if(!row||!['QUEUED','RUNNING'].includes(row.status)||row.nextAttemptAt>new Date()||(row.status==='RUNNING'&&row.leaseExpiresAt&&row.leaseExpiresAt>new Date()))return null;
    if(row.attempt>=3){await settleInTransaction(tx,tenantId,row.reservationId,'RELEASE',row.correlationId);await transition(tx,row,'FAILED','PROVIDER_UNAVAILABLE');return null;}
    const [claimed]=await tx.update(covers).set({status:'RUNNING',attempt:row.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+300_000)}).where(where(tenantId,id)).returning();
    await tx.insert(auditLogs).values({tenantId,action:'COVER_RUNNING',resourceId:id,correlationId:row.correlationId,metadata:{attempt:row.attempt+1}});return claimed!;
  });}
  private async owned(tx:Transaction,job:StoredCover){const [row]=await tx.select().from(covers).where(where(job.tenantId,job.id));if(!row||row.status!=='RUNNING'||row.leaseToken!==job.leaseToken||!row.leaseExpiresAt||row.leaseExpiresAt<=new Date())throw new DomainError('CONFLICT',409);return row;}
  async prepare(job:StoredCover,policies:ConsentPolicy[]){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);await this.owned(tx,job);await assertMembership(tx,job.requestedBy,job.tenantId,'generate');return project(tx,job.tenantId,job.projectId,policies);});}
  async complete(job:StoredCover,policies:ConsentPolicy[]){await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);await this.owned(tx,job);await assertMembership(tx,job.requestedBy,job.tenantId,'generate');await project(tx,job.tenantId,job.projectId,policies);await settleInTransaction(tx,job.tenantId,job.reservationId,'CAPTURE',job.correlationId);await transition(tx,job,'READY');});}
  async fail(job:StoredCover,code:ErrorCode){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);await this.owned(tx,job);const retry=code==='PROVIDER_UNAVAILABLE'&&job.attempt<3;
    if(!retry)await settleInTransaction(tx,job.tenantId,job.reservationId,'RELEASE',job.correlationId);
    await transition(tx,job,retry?'QUEUED':'FAILED',code);
    if(retry)await tx.update(covers).set({nextAttemptAt:new Date(Date.now()+5000*2**job.attempt),dispatchAfter:new Date()}).where(where(job.tenantId,job.id));
  });}
}
