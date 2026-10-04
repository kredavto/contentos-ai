import { randomUUID,createHash } from 'node:crypto';
import { and,eq,sql,desc,isNull } from 'drizzle-orm';
import { DomainError,avatarJobInputSchema,type AvatarRequest,type AvatarJobInput,type ConsentType,type ProviderReference } from '@contentos/types';
import type { Database } from '../index';
import { avatars,avatarLooks,mediaAssets,consentSubjects,consentRecords,jobs,outbox,usagePolicies,auditLogs,aiCalls } from '../schema';
import { lockTenant,assertMembership,reserveInTransaction,settleInTransaction,type Transaction } from './ledger';
import { requireConsent } from './consent';
import { ownedJob,type StoredJob } from './jobs';
export type ConsentPolicy = {type:ConsentType;version:string;textHash:string};
export type StoredAvatar = typeof avatars.$inferSelect;
const jobWhere=(tenantId:string,id:string)=>and(eq(jobs.tenantId,tenantId),eq(jobs.id,id));
const avatarWhere=(tenantId:string,id:string)=>and(eq(avatars.tenantId,tenantId),eq(avatars.id,id));
const lookWhere=(tenantId:string,id:string)=>and(eq(avatarLooks.tenantId,tenantId),eq(avatarLooks.id,id));
async function entities(tx:Transaction,job:StoredJob){
  if(job.type!=='CREATE_AVATAR')throw new DomainError('INVALID_INPUT');
  const input=avatarJobInputSchema.parse(job.input);
  const [avatar]=await tx.select().from(avatars).where(avatarWhere(job.tenantId,input.avatarId));
  const [look]=await tx.select().from(avatarLooks).where(and(lookWhere(job.tenantId,input.lookId),eq(avatarLooks.jobId,job.id),eq(avatarLooks.avatarId,input.avatarId)));
  if(!avatar||!look||avatar.brandId!==job.brandId||avatar.subjectId!==input.subjectId||look.sourceAssetId!==input.sourceAssetId)throw new DomainError('NOT_FOUND',404);
  return {input,avatar,look};
}
async function validConsent(tx:Transaction,tenantId:string,input:AvatarJobInput,policies:ConsentPolicy[]){
  if(input.requirements.some(requirement=>!policies.some(policy=>policy.type===requirement.type&&policy.version===requirement.version&&policy.textHash===requirement.textHash)))throw new DomainError('CONSENT_REQUIRED',403);
  await requireConsent(tx,tenantId,input.subjectId,input.requirements);
}
export class AvatarRepository {
  constructor(private readonly db:Database){}
  async enqueue(userId:string,tenantId:string,brandId:string,input:AvatarRequest,policies:ConsentPolicy[],provider:string,correlationId:string){
    const inputHash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [existing]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==inputHash||existing.requestedBy!==userId||existing.type!=='CREATE_AVATAR')throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const [subject]=await tx.select().from(consentSubjects).where(and(eq(consentSubjects.tenantId,tenantId),eq(consentSubjects.brandId,brandId),eq(consentSubjects.id,input.subjectId),eq(consentSubjects.type,'PERSON')));
      const [asset]=await tx.select().from(mediaAssets).where(and(eq(mediaAssets.tenantId,tenantId),eq(mediaAssets.brandId,brandId),eq(mediaAssets.id,input.sourceAssetId),eq(mediaAssets.status,'READY')));
      if(!subject||!asset)throw new DomainError('NOT_FOUND',404);
      const requirements=policies.filter(policy=>policy.type===input.likenessType||policy.type==='CROSS_BORDER_PROCESSING');
      if(requirements.length!==2)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const records=await requireConsent(tx,tenantId,subject.id,requirements);
      let avatar:StoredAvatar|undefined;
      if(input.avatarId){
        [avatar]=await tx.select().from(avatars).where(and(avatarWhere(tenantId,input.avatarId),eq(avatars.brandId,brandId),eq(avatars.subjectId,input.subjectId),eq(avatars.status,'ACTIVE'),eq(avatars.provider,provider)));
        const [ready]=await tx.select({id:avatarLooks.id}).from(avatarLooks).where(and(eq(avatarLooks.tenantId,tenantId),eq(avatarLooks.avatarId,input.avatarId),eq(avatarLooks.status,'READY'))).limit(1);
        if(!avatar?.reference||!ready)throw new DomainError('CONFLICT',409);
      } else [avatar]=await tx.insert(avatars).values({tenantId,brandId,subjectId:subject.id,name:input.name,provider,correlationId}).returning();
      if(!avatar)throw new Error('Avatar insert failed');
      const [policy]=await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,'CREATE_AVATAR'));
      if(!policy)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const reservation=await reserveInTransaction(tx,tenantId,policy.unit,policy.amount,`job:${input.idempotencyKey}`,correlationId);
      const lookId=randomUUID();
      const jobInput:AvatarJobInput={avatarId:avatar.id,lookId,sourceAssetId:asset.id,subjectId:subject.id,requirements:requirements.map((policy,i)=>({...policy,type:policy.type as AvatarJobInput['requirements'][number]['type'],recordId:records[i]!}))};
      const [job]=await tx.insert(jobs).values({tenantId,brandId,requestedBy:userId,type:'CREATE_AVATAR',input:jobInput,inputHash,idempotencyKey:input.idempotencyKey,reservationId:reservation.id,provider,model:'photo-avatar',correlationId}).returning();
      if(!job)throw new Error('Job insert failed');
      await tx.insert(avatarLooks).values({id:lookId,tenantId,avatarId:avatar.id,sourceAssetId:asset.id,jobId:job.id,name:input.name});
      await tx.insert(outbox).values({tenantId,jobId:job.id});
      await tx.insert(auditLogs).values({tenantId,userId,action:'AVATAR_QUEUED',resourceId:avatar.id,correlationId,metadata:{jobId:job.id,lookId}});
      return {id:job.id,status:job.status};
    });
  }
  async list(userId:string,tenantId:string,brandId:string,policies:ConsentPolicy[]){
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const rows=await tx.select({avatar:avatars,look:avatarLooks,input:jobs.input}).from(avatars).innerJoin(avatarLooks,and(eq(avatarLooks.tenantId,avatars.tenantId),eq(avatarLooks.avatarId,avatars.id))).innerJoin(jobs,and(eq(jobs.tenantId,avatarLooks.tenantId),eq(jobs.id,avatarLooks.jobId))).where(and(eq(avatars.tenantId,tenantId),eq(avatars.brandId,brandId),sql`${avatars.status} <> 'DELETED'`)).orderBy(desc(avatars.createdAt),desc(avatarLooks.createdAt)).limit(100);
      const active=await tx.select({id:consentRecords.id}).from(consentRecords).where(and(eq(consentRecords.tenantId,tenantId),isNull(consentRecords.revokedAt)));const ids=new Set(active.map(row=>row.id));
      return rows.map(({avatar,look,input})=>{const requirements=avatarJobInputSchema.parse(input).requirements;return {id:look.id,avatarId:avatar.id,avatarName:avatar.name,voiceId:avatar.voiceId,name:look.name,subjectId:avatar.subjectId,sourceAssetId:look.sourceAssetId,status:look.status,avatarStatus:avatar.status,jobId:look.jobId,errorCode:look.errorCode??avatar.errorCode,consentValid:requirements.every(requirement=>ids.has(requirement.recordId)&&policies.some(policy=>policy.type===requirement.type&&policy.version===requirement.version&&policy.textHash===requirement.textHash))};});
    });
  }
  async claim(tenantId:string,id:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);
      const [job]=await tx.select().from(jobs).where(and(jobWhere(tenantId,id),eq(jobs.type,'CREATE_AVATAR'))).for('update');
      if(!job||!['QUEUED','RETRY','WAITING_EXTERNAL','RUNNING'].includes(job.status)||job.nextAttemptAt.getTime()>Date.now()||(job.status==='RUNNING'&&job.leaseExpiresAt&&job.leaseExpiresAt.getTime()>Date.now()))return null;
      const {look}=await entities(tx,job);
      await tx.update(aiCalls).set({status:'UNKNOWN',errorCode:'WORKER_INTERRUPTED'}).where(and(eq(aiCalls.tenantId,tenantId),eq(aiCalls.jobId,id),eq(aiCalls.status,'STARTED')));
      if(look.mutationState==='STARTED')await tx.update(avatarLooks).set({mutationState:'UNKNOWN'}).where(lookWhere(tenantId,look.id));
      const [claimed]=await tx.update(jobs).set({status:'RUNNING',attempt:job.attempt+1,consecutiveFailures:job.consecutiveFailures+(job.status==='RUNNING'?1:0),pollCount:job.pollCount+(look.reference?1:0),leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+300_000),startedAt:job.startedAt??new Date(),progress:look.reference?60:10}).where(jobWhere(tenantId,id)).returning();return claimed??null;
    });
  }
  async prepare(job:StoredJob,policies:ConsentPolicy[],markSubmitting=false){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);
      await assertMembership(tx,active.requestedBy,active.tenantId,'generate');
      const data=await entities(tx,active);
      if(data.avatar.status!=='ACTIVE')throw new DomainError('CONFLICT',409);
      await validConsent(tx,job.tenantId,data.input,policies);
      if(active.consecutiveFailures>=active.maxAttempts||(!data.look.reference&&data.look.firstSubmittedAt&&Date.now()-data.look.firstSubmittedAt.getTime()>23*3600_000))throw new DomainError('RECONCILIATION_REQUIRED',409);
      const [asset]=await tx.select().from(mediaAssets).where(and(eq(mediaAssets.tenantId,job.tenantId),eq(mediaAssets.id,data.input.sourceAssetId),eq(mediaAssets.brandId,job.brandId)));
      if(!asset||(!data.look.reference&&asset.status!=='READY'))throw new DomainError('INVALID_MEDIA');
      if(markSubmitting&&!data.look.reference){
        await tx.update(avatarLooks).set({status:'PROCESSING',mutationState:data.look.firstSubmittedAt?'UNKNOWN':'STARTED',firstSubmittedAt:data.look.firstSubmittedAt??new Date()}).where(lookWhere(job.tenantId,data.look.id));
        await tx.insert(auditLogs).values({tenantId:job.tenantId,action:'AVATAR_SUBMISSION_AUTHORIZED',resourceId:data.look.id,correlationId:job.correlationId,metadata:{jobId:job.id,attempt:job.attempt}});
      }
      return {...data,asset,job:active};
    });
  }
  async submitted(job:StoredJob,reference:ProviderReference){
    // Retain a late response even after cancellation/lease loss, so deletion can
    // remove the external asset instead of losing its reference.
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const data=await entities(tx,job);
      if(data.avatar.status==='DELETED')return;
      if(reference.provider!==job.provider||typeof reference.metadata.groupId!=='string'||!reference.externalId)throw new DomainError('PROVIDER_REJECTED',502);
      if(data.look.reference&&data.look.reference.externalId!==reference.externalId)throw new DomainError('RECONCILIATION_REQUIRED',409);
      if(data.avatar.reference&&data.avatar.reference.metadata.groupId!==reference.metadata.groupId)throw new DomainError('RECONCILIATION_REQUIRED',409);
      const stored={...reference,internalId:data.look.id};
      await tx.update(avatarLooks).set({reference:stored,mutationState:'ACCEPTED'}).where(lookWhere(job.tenantId,data.look.id));
      if(!data.avatar.reference)await tx.update(avatars).set({reference:stored}).where(avatarWhere(job.tenantId,data.avatar.id));
      await tx.update(jobs).set({externalJobId:reference.externalId}).where(jobWhere(job.tenantId,job.id));
    });
  }
  async wait(job:StoredJob){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);const {look}=await entities(tx,active);const exhausted=active.pollCount>=360;
      await tx.update(jobs).set({status:exhausted?'RECONCILIATION':'WAITING_EXTERNAL',progress:60,consecutiveFailures:0,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(Date.now()+10_000),errorCode:exhausted?'RECONCILIATION_REQUIRED':null}).where(jobWhere(job.tenantId,job.id));
      await tx.update(avatarLooks).set({status:exhausted?'RECONCILIATION':'PROCESSING',errorCode:exhausted?'RECONCILIATION_REQUIRED':null}).where(lookWhere(job.tenantId,look.id));
    });
  }
  async complete(job:StoredJob,policies:ConsentPolicy[]){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,active.tenantId,'generate');
      const data=await entities(tx,active);await validConsent(tx,job.tenantId,data.input,policies);
      if(data.avatar.status!=='ACTIVE'||!data.look.reference)throw new DomainError('CONFLICT',409);
      await settleInTransaction(tx,job.tenantId,job.reservationId,'CAPTURE',job.correlationId);
      await tx.update(avatarLooks).set({status:'READY',errorCode:null}).where(lookWhere(job.tenantId,data.look.id));
      await tx.update(jobs).set({status:'SUCCEEDED',progress:100,result:{internalId:data.avatar.id,version:1},finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(jobWhere(job.tenantId,job.id));
      await tx.insert(auditLogs).values({tenantId:job.tenantId,action:'AVATAR_READY',resourceId:data.look.id,correlationId:job.correlationId,metadata:{jobId:job.id}});
    });
  }
  async fail(job:StoredJob,code:string,definitiveRejection=false){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);const {look}=await entities(tx,active);
      const rejected=definitiveRejection&&look.mutationState==='STARTED'&&!look.reference;
      const uncertain=!look.reference&&!!look.firstSubmittedAt&&!rejected&&look.mutationState!=='REJECTED';
      const failures=active.consecutiveFailures+1;
      const retry=code==='PROVIDER_UNAVAILABLE'&&failures<active.maxAttempts&&(!look.firstSubmittedAt||Date.now()-look.firstSubmittedAt.getTime()<23*3600_000);
      const reconcile=!retry&&(uncertain||code==='RECONCILIATION_REQUIRED'||(!!look.reference&&code==='PROVIDER_UNAVAILABLE'));
      if(!retry&&!reconcile)await settleInTransaction(tx,job.tenantId,job.reservationId,'RELEASE',job.correlationId);
      await tx.update(avatarLooks).set({status:retry?'PROCESSING':reconcile?'RECONCILIATION':'FAILED',errorCode:code,...(rejected?{mutationState:'REJECTED' as const}:uncertain?{mutationState:'UNKNOWN' as const}:{})}).where(lookWhere(job.tenantId,look.id));
      await tx.update(jobs).set({status:retry?'RETRY':reconcile?'RECONCILIATION':'FAILED',errorCode:reconcile?'RECONCILIATION_REQUIRED':code,consecutiveFailures:failures,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(Date.now()+5000*2**Math.min(failures-1,6)),finishedAt:retry||reconcile?null:new Date()}).where(jobWhere(job.tenantId,job.id));
      await tx.insert(auditLogs).values({tenantId:job.tenantId,action:reconcile?'AVATAR_RECONCILIATION_REQUIRED':retry?'AVATAR_RETRY':'AVATAR_FAILED',resourceId:look.id,correlationId:job.correlationId,metadata:{code,jobId:job.id}});
    });
  }
  async resume(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[],correlationId:string){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');const [job]=await tx.select().from(jobs).where(and(jobWhere(tenantId,id),eq(jobs.brandId,brandId),eq(jobs.type,'CREATE_AVATAR'))).for('update');
      if(!job||job.status!=='RECONCILIATION')throw new DomainError('CONFLICT',409);
      const data=await entities(tx,job);await validConsent(tx,tenantId,data.input,policies);
      if(data.avatar.status!=='ACTIVE'||(!data.look.reference&&data.look.firstSubmittedAt&&Date.now()-data.look.firstSubmittedAt.getTime()>=23*3600_000))throw new DomainError('RECONCILIATION_REQUIRED',409);
      await tx.update(jobs).set({status:'RETRY',consecutiveFailures:0,pollCount:0,nextAttemptAt:new Date(),errorCode:null}).where(jobWhere(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'AVATAR_CHECK_RESUMED',resourceId:data.look.id,correlationId});
    });
  }
  async delete(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [avatar]=await tx.select().from(avatars).where(and(avatarWhere(tenantId,id),eq(avatars.brandId,brandId))).for('update');
      if(!avatar)throw new DomainError('NOT_FOUND',404);if(avatar.status!=='ACTIVE')return {status:avatar.status};
      const active=await tx.select({job:jobs}).from(avatarLooks).innerJoin(jobs,and(eq(jobs.tenantId,avatarLooks.tenantId),eq(jobs.id,avatarLooks.jobId))).where(and(eq(avatarLooks.tenantId,tenantId),eq(avatarLooks.avatarId,id),sql`${jobs.status} not in ('SUCCEEDED','FAILED')`));
      for(const {job} of active){await settleInTransaction(tx,tenantId,job.reservationId,'RELEASE',correlationId);await tx.update(jobs).set({status:'FAILED',errorCode:'NOT_AUTHORIZED',finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null}).where(jobWhere(tenantId,job.id));}
      await tx.update(avatars).set({status:'DELETE_PENDING',deleteAfter:new Date(),correlationId}).where(avatarWhere(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'AVATAR_DELETION_REQUESTED',resourceId:id,correlationId});return {status:'DELETE_PENDING' as const};
    });
  }
  async claimDeletion(provider:string){
    return this.db.transaction(async tx=>{
      const [avatar]=await tx.select().from(avatars).where(and(eq(avatars.provider,provider),eq(avatars.status,'DELETE_PENDING'),sql`${avatars.deleteAfter} <= now()`,sql`(${avatars.leaseExpiresAt} is null or ${avatars.leaseExpiresAt} < now())`,sql`not exists (select 1 from ${avatarLooks} l where l.tenant_id = ${avatars.tenantId} and l.avatar_id = ${avatars.id} and l.reference is null and l.mutation_state in ('STARTED','UNKNOWN'))`)).for('update',{skipLocked:true}).limit(1);
      if(!avatar)return null;const [claimed]=await tx.update(avatars).set({leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+120_000),deleteAttempts:avatar.deleteAttempts+1}).where(avatarWhere(avatar.tenantId,avatar.id)).returning();return claimed??null;
    });
  }
  async finishDeletion(avatar:StoredAvatar,succeeded:boolean){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,avatar.tenantId);
      const updated=await tx.update(avatars).set(succeeded?{status:'DELETED',name:'[deleted]',reference:null,deletedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}:{errorCode:'PROVIDER_UNAVAILABLE',deleteAfter:new Date(Date.now()+Math.min(3_600_000,5000*2**Math.min(avatar.deleteAttempts,10))),leaseToken:null,leaseExpiresAt:null}).where(and(avatarWhere(avatar.tenantId,avatar.id),eq(avatars.leaseToken,avatar.leaseToken!),sql`${avatars.leaseExpiresAt} > now()`)).returning({id:avatars.id});
      if(!updated.length)throw new DomainError('CONFLICT',409);
      if(succeeded){await tx.update(avatarLooks).set({reference:null,name:'[deleted]',status:'FAILED',errorCode:'NOT_AUTHORIZED'}).where(and(eq(avatarLooks.tenantId,avatar.tenantId),eq(avatarLooks.avatarId,avatar.id)));await tx.insert(auditLogs).values({tenantId:avatar.tenantId,action:'AVATAR_DELETED',resourceId:avatar.id,correlationId:avatar.correlationId});}
    });
  }
}
