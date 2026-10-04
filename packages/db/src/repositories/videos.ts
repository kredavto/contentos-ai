import {randomUUID,createHash} from 'node:crypto';
import {and,eq,desc,sql} from 'drizzle-orm';
import {DomainError,avatarJobInputSchema,videoJobInputSchema,videoProcessingSchema,videoStages,videoReservationSeconds,captionSegmentsSchema,type CaptionEdit,type CaptionSegment,type VideoRequest,type VideoStage,type ProviderReference} from '@contentos/types';
import type {Database} from '../index';
import {videoProjects,videoTransitions,jobs,outbox,scripts,scriptVersions,avatars,avatarLooks,voiceProfiles,usagePolicies,auditLogs,aiCalls,captions} from '../schema';
import {lockTenant,assertMembership,reserveInTransaction,settleInTransaction,type Transaction} from './ledger';
import {ownedJob,type StoredJob} from './jobs';
import {requireConsent} from './consent';
import type {ConsentPolicy} from './avatars';
export type StoredVideo=typeof videoProjects.$inferSelect;
const projectWhere=(tenantId:string,id:string)=>and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.id,id));
const jobWhere=(job:Pick<StoredJob,'tenantId'|'id'>)=>and(eq(jobs.tenantId,job.tenantId),eq(jobs.id,job.id));
async function projectFor(tx:Transaction,job:StoredJob){
  if(job.type!=='GENERATE_VIDEO')throw new DomainError('INVALID_INPUT');const input=videoJobInputSchema.parse(job.input);
  const [project]=await tx.select().from(videoProjects).where(and(projectWhere(job.tenantId,input.projectId),eq(videoProjects.jobId,job.id),eq(videoProjects.brandId,job.brandId)));
  if(!project)throw new DomainError('NOT_FOUND',404);return project;
}
async function validate(tx:Transaction,project:StoredVideo,policies:ConsentPolicy[]){
  if(project.lifecycle!=='ACTIVE')throw new DomainError('NOT_FOUND',404);
  if(project.consent.requirements.some(requirement=>!policies.some(policy=>policy.type===requirement.type&&policy.version===requirement.version&&policy.textHash===requirement.textHash)))throw new DomainError('CONSENT_REQUIRED',403);
  await requireConsent(tx,project.tenantId,project.consent.subjectId,project.consent.requirements);
  const [look]=await tx.select({look:avatarLooks,avatar:avatars}).from(avatarLooks).innerJoin(avatars,and(eq(avatars.tenantId,avatarLooks.tenantId),eq(avatars.id,avatarLooks.avatarId))).where(and(eq(avatarLooks.tenantId,project.tenantId),eq(avatarLooks.id,project.lookId),eq(avatars.brandId,project.brandId)));
  if(!look||look.avatar.status!=='ACTIVE'||look.look.status!=='READY'||!look.look.reference||look.look.reference.externalId!==project.avatarReference.externalId||look.avatar.subjectId!==project.consent.subjectId)throw new DomainError('CONSENT_REQUIRED',403);
  const [script]=await tx.select().from(scripts).where(and(eq(scripts.tenantId,project.tenantId),eq(scripts.id,project.scriptId),eq(scripts.brandId,project.brandId)));
  if(!script||script.currentVersion!==project.scriptVersion||script.approvedVersion!==project.scriptVersion)throw new DomainError('CONFLICT',409);
}
async function transition(tx:Transaction,project:StoredVideo,next:VideoStage,correlationId:string,details:Record<string,unknown>={}){
  if(project.stage===next)return project;
  const currentIndex=videoStages.indexOf(project.stage),nextIndex=videoStages.indexOf(next);
  if(project.stage==='READY'||project.stage==='FAILED'||(next!=='FAILED'&&nextIndex!==currentIndex+1))throw new DomainError('CONFLICT',409);
  const revision=project.stageRevision+1;
  await tx.insert(videoTransitions).values({tenantId:project.tenantId,projectId:project.id,revision,fromStage:project.stage,toStage:next,details,correlationId});
  const [updated]=await tx.update(videoProjects).set({stage:next,stageRevision:revision}).where(projectWhere(project.tenantId,project.id)).returning();return updated!;
}
export class VideoRepository {
  constructor(private readonly db:Database){}
  async enqueue(userId:string,tenantId:string,brandId:string,input:VideoRequest,policies:ConsentPolicy[],provider:string,correlationId:string,captionConfig:{provider:string;model:string}|null=null){
    const inputHash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [existing]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.type!=='GENERATE_VIDEO'||existing.inputHash!==inputHash||existing.requestedBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const [script]=await tx.select().from(scripts).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,input.scriptId)));
      if(!script)throw new DomainError('NOT_FOUND',404);
      if(script.currentVersion!==input.scriptVersion||script.approvedVersion!==input.scriptVersion)throw new DomainError('CONFLICT',409);
      const [version]=await tx.select().from(scriptVersions).where(and(eq(scriptVersions.tenantId,tenantId),eq(scriptVersions.scriptId,script.id),eq(scriptVersions.version,input.scriptVersion)));
      const [owned]=await tx.select({look:avatarLooks,avatar:avatars,input:jobs.input}).from(avatarLooks).innerJoin(avatars,and(eq(avatars.tenantId,avatarLooks.tenantId),eq(avatars.id,avatarLooks.avatarId))).innerJoin(jobs,and(eq(jobs.tenantId,avatarLooks.tenantId),eq(jobs.id,avatarLooks.jobId))).where(and(eq(avatarLooks.tenantId,tenantId),eq(avatarLooks.id,input.lookId),eq(avatars.brandId,brandId),eq(avatars.status,'ACTIVE'),eq(avatarLooks.status,'READY')));
      if(!version||!owned?.look.reference||!owned.avatar.voiceId)throw new DomainError('INVALID_INPUT');
      const [voice]=await tx.select().from(voiceProfiles).where(and(eq(voiceProfiles.tenantId,tenantId),eq(voiceProfiles.brandId,brandId),eq(voiceProfiles.id,owned.avatar.voiceId)));
      if(!voice||voice.provider!==provider||owned.avatar.provider!==provider||voice.reference.metadata.public!==true)throw new DomainError('INVALID_INPUT');
      const consent=avatarJobInputSchema.parse(owned.input);
      if(consent.requirements.some(requirement=>!policies.some(policy=>policy.type===requirement.type&&policy.version===requirement.version&&policy.textHash===requirement.textHash)))throw new DomainError('CONSENT_REQUIRED',403);
      await requireConsent(tx,tenantId,consent.subjectId,consent.requirements);
      const [policy]=await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,'GENERATE_VIDEO'));
      if(!policy||policy.unit!=='VIDEO_SECONDS'||policy.amount>180)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const budget=videoReservationSeconds(script.duration,policy.amount);
      const reservation=await reserveInTransaction(tx,tenantId,policy.unit,budget,`job:${input.idempotencyKey}`,correlationId);
      let captionReservationId:string|null=null;
      if(input.captionMode==='AUTO'){
        if(!captionConfig)throw new DomainError('CONFIGURATION_REQUIRED',503);
        const [captionPolicy]=await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,'AUTO_CAPTIONS'));
        if(!captionPolicy||captionPolicy.unit!=='AI_CREDITS')throw new DomainError('CONFIGURATION_REQUIRED',503);
        captionReservationId=(await reserveInTransaction(tx,tenantId,captionPolicy.unit,captionPolicy.amount,`captions:${input.idempotencyKey}`,correlationId)).id;
      }
      const projectId=randomUUID(),jobId=randomUUID(),prefix=`${tenantId}/videos/${projectId}`;
      const [job]=await tx.insert(jobs).values({id:jobId,tenantId,brandId,requestedBy:userId,type:'GENERATE_VIDEO',input:{projectId},inputHash,idempotencyKey:input.idempotencyKey,reservationId:reservation.id,provider,model:'avatar-video',correlationId}).returning();
      const text=[version.content.hook,version.content.context,version.content.core,version.content.proof,version.content.cta].join('\n\n');
      if(text.length>20000)throw new DomainError('INVALID_INPUT');
      await tx.insert(videoProjects).values({id:projectId,tenantId,brandId,jobId,scriptId:script.id,scriptVersion:input.scriptVersion,lookId:owned.look.id,voiceId:voice.id,captionMode:input.captionMode,captionLanguage:input.captionLanguage,captionProvider:captionConfig?.provider,captionModel:captionConfig?.model,captionReservationId,scriptText:text,title:version.content.hook.slice(0,200),platform:script.platform,plannedDuration:script.duration,avatarReference:owned.look.reference,voiceReference:voice.reference,consent:{subjectId:consent.subjectId,requirements:consent.requirements},options:videoProcessingSchema.parse({orientation:input.orientation,resolution:input.resolution,fit:input.fit}),maxDurationSeconds:budget,provider,originalKey:`${prefix}/original.mp4`,finalKey:`${prefix}/final.mp4`,coverKey:`${prefix}/cover.jpg`});
      await tx.insert(videoTransitions).values({tenantId,projectId,revision:0,toStage:'VIDEO_REQUESTED',correlationId});await tx.insert(outbox).values({tenantId,jobId});
      await tx.insert(auditLogs).values({tenantId,userId,action:'VIDEO_QUEUED',resourceId:projectId,correlationId,metadata:{jobId,scriptVersion:input.scriptVersion,maxVideoSeconds:budget}});return {id:job!.id,status:job!.status};
    });
  }
  async list(userId:string,tenantId:string,brandId:string){
    return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);return tx.select({id:videoProjects.id,jobId:videoProjects.jobId,title:videoProjects.title,scriptId:videoProjects.scriptId,scriptVersion:videoProjects.scriptVersion,lookId:videoProjects.lookId,voiceId:videoProjects.voiceId,stage:videoProjects.stage,captionMode:videoProjects.captionMode,captionMutationState:videoProjects.captionMutationState,lifecycle:videoProjects.lifecycle,deleteError:videoProjects.deleteError,options:videoProjects.options,provider:videoProjects.provider,durationMs:videoProjects.durationMs,approvedAt:videoProjects.approvedAt,createdAt:videoProjects.createdAt,jobStatus:jobs.status,errorCode:jobs.errorCode}).from(videoProjects).innerJoin(jobs,and(eq(jobs.tenantId,videoProjects.tenantId),eq(jobs.id,videoProjects.jobId))).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.brandId,brandId),sql`${videoProjects.lifecycle} <> 'DELETED'`)).orderBy(desc(videoProjects.createdAt)).limit(50);});
  }
  async claim(tenantId:string,id:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,id),eq(jobs.type,'GENERATE_VIDEO'))).for('update');
      if(!job||!['QUEUED','RETRY','WAITING_EXTERNAL','RUNNING'].includes(job.status)||job.nextAttemptAt.getTime()>Date.now()||(job.status==='RUNNING'&&job.leaseExpiresAt&&job.leaseExpiresAt.getTime()>Date.now()))return null;
      const project=await projectFor(tx,job);
      if(project.captionMutationState==='STARTED')await tx.update(videoProjects).set({captionMutationState:'UNKNOWN'}).where(projectWhere(tenantId,project.id));
      if(project.mutationState==='STARTED')await tx.update(videoProjects).set({mutationState:'UNKNOWN'}).where(projectWhere(tenantId,project.id));
      await tx.update(aiCalls).set({status:'UNKNOWN',errorCode:'WORKER_INTERRUPTED'}).where(and(eq(aiCalls.tenantId,tenantId),eq(aiCalls.jobId,id),eq(aiCalls.status,'STARTED')));
      const [claimed]=await tx.update(jobs).set({status:'RUNNING',attempt:job.attempt+1,consecutiveFailures:job.consecutiveFailures+(job.status==='RUNNING'?1:0),pollCount:job.pollCount+(project.reference?1:0),leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+300_000),startedAt:job.startedAt??new Date()}).where(jobWhere(job)).returning();return claimed??null;
    });
  }
  async prepare(job:StoredJob,policies:ConsentPolicy[],markSubmitting=false){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,job.tenantId,'generate');let project=await projectFor(tx,active);await validate(tx,project,policies);
      if(project.captionMode==='AUTO'&&project.captionMutationState==='UNKNOWN')throw new DomainError('RECONCILIATION_REQUIRED',409);
      if(active.consecutiveFailures>=active.maxAttempts||(!project.reference&&project.firstSubmittedAt&&Date.now()-project.firstSubmittedAt.getTime()>23*3600_000))throw new DomainError('RECONCILIATION_REQUIRED',409);
      if(project.stage==='VIDEO_REQUESTED')project=await transition(tx,project,'VOICE_PREPARING',job.correlationId,{voiceId:project.voiceId,publicVoice:true});
      if(project.stage==='VOICE_PREPARING')project=await transition(tx,project,'AVATAR_RENDERING',job.correlationId);
      if(markSubmitting&&!project.reference)await tx.update(videoProjects).set({firstSubmittedAt:project.firstSubmittedAt??new Date(),mutationState:project.firstSubmittedAt?'UNKNOWN':'STARTED'}).where(projectWhere(job.tenantId,project.id));
      return project;
    });
  }
  async submitted(job:StoredJob,reference:ProviderReference){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const project=await projectFor(tx,job);
      if(reference.provider!==job.provider||!reference.externalId||(project.reference&&project.reference.externalId!==reference.externalId))throw new DomainError('RECONCILIATION_REQUIRED',409);
      await tx.update(videoProjects).set({reference:{...reference,internalId:project.id},mutationState:'ACCEPTED',...(project.lifecycle==='DELETE_PENDING'?{deleteError:null}:{})}).where(projectWhere(job.tenantId,project.id));await tx.update(jobs).set({externalJobId:reference.externalId}).where(jobWhere(job));
    });
  }
  async wait(job:StoredJob){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await tx.update(jobs).set({status:active.pollCount>=360?'RECONCILIATION':'WAITING_EXTERNAL',errorCode:active.pollCount>=360?'RECONCILIATION_REQUIRED':null,consecutiveFailures:0,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(Date.now()+10_000),progress:35}).where(jobWhere(job));});
  }
  async stage(job:StoredJob,next:VideoStage,details:Record<string,unknown>={}){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);const project=await projectFor(tx,active);
      // Retried local processing may revisit a completed intermediate stage.
      if(videoStages.indexOf(next)<videoStages.indexOf(project.stage))return;
      await transition(tx,project,next,job.correlationId,details);await tx.update(jobs).set({progress:Math.min(95,40+videoStages.indexOf(next)*6)}).where(jobWhere(job));
    });
  }
  async storeOriginal(job:StoredJob,policies:ConsentPolicy[],durationSeconds?:number){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,job.tenantId,'generate');const project=await projectFor(tx,active);await validate(tx,project,policies);
      if(durationSeconds!==undefined&&(!Number.isFinite(durationSeconds)||durationSeconds<=0||Math.ceil(durationSeconds)>project.maxDurationSeconds))throw new DomainError('INVALID_MEDIA',422);
      const [updated]=await tx.update(videoProjects).set({originalStoredAt:project.originalStoredAt??new Date(),...(durationSeconds===undefined?{}:{sourceDurationMs:Math.round(durationSeconds*1000)})}).where(projectWhere(job.tenantId,project.id)).returning();return updated!;
    });
  }
  async captionsConfirmed(job:StoredJob){
    return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);const project=await projectFor(tx,active);const [track]=await tx.select().from(captions).where(and(eq(captions.tenantId,job.tenantId),eq(captions.projectId,project.id)));return !!track&&track.confirmedRevision===track.revision;});
  }
  async markCaptionSubmission(job:StoredJob,policies:ConsentPolicy[]){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,job.tenantId,'generate');const project=await projectFor(tx,active);await validate(tx,project,policies);
      if(project.captionMode!=='AUTO'||project.captionMutationState!=='NONE'||!project.originalStoredAt||!project.sourceDurationMs)throw new DomainError('RECONCILIATION_REQUIRED',409);
      await tx.update(videoProjects).set({captionMutationState:'STARTED'}).where(projectWhere(job.tenantId,project.id));
    });
  }
  async captionDraft(job:StoredJob,policies:ConsentPolicy[],segments:CaptionSegment[]){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,job.tenantId,'generate');const project=await projectFor(tx,active);await validate(tx,project,policies);
      if(project.captionMode==='NONE'||!project.originalStoredAt||!project.sourceDurationMs||(project.captionMode==='AUTO'&&project.captionMutationState!=='STARTED'))throw new DomainError('CONFLICT',409);
      const parsed=captionSegmentsSchema.parse(segments);if(parsed.some(segment=>segment.end>project.sourceDurationMs!/1000+.05))throw new DomainError('INVALID_MEDIA',422);
      await tx.insert(captions).values({tenantId:job.tenantId,projectId:project.id,source:project.captionMode,segments:parsed});
      await tx.update(videoProjects).set({captionMutationState:project.captionMode==='AUTO'?'ACCEPTED':'NONE'}).where(projectWhere(job.tenantId,project.id));
      await tx.update(jobs).set({status:'WAITING_REVIEW',leaseToken:null,leaseExpiresAt:null,consecutiveFailures:0,progress:60,errorCode:null}).where(jobWhere(job));
    });
  }
  async captionReview(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[]){
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId);const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId)));if(!project)throw new DomainError('NOT_FOUND',404);await validate(tx,project,policies);
      const [track]=await tx.select().from(captions).where(and(eq(captions.tenantId,tenantId),eq(captions.projectId,id)));const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,project.jobId)));
      if(!track||!project.originalStoredAt)throw new DomainError('NOT_FOUND',404);return {project,track,editable:job?.status==='WAITING_REVIEW'};
    });
  }
  async editCaptions(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[],input:CaptionEdit,correlationId:string,confirm=false){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId)));if(!project)throw new DomainError('NOT_FOUND',404);await validate(tx,project,policies);
      const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,project.jobId)));const [track]=await tx.select().from(captions).where(and(eq(captions.tenantId,tenantId),eq(captions.projectId,id)));
      if(!job||job.status!=='WAITING_REVIEW'||!track||track.revision!==input.revision||!project.sourceDurationMs)throw new DomainError('CONFLICT',409);
      const segments=captionSegmentsSchema.parse(confirm?track.segments:input.segments);if(segments.some(segment=>segment.end>project.sourceDurationMs!/1000+.05))throw new DomainError('INVALID_INPUT');
      const revision=confirm?track.revision:track.revision+1;
      await tx.update(captions).set(confirm?{confirmedRevision:revision,updatedAt:new Date()}:{segments,style:input.style,revision,confirmedRevision:null,updatedAt:new Date()}).where(eq(captions.id,track.id));
      if(confirm){await tx.update(videoProjects).set({options:{...project.options,captions:segments,captionStyle:track.style}}).where(projectWhere(tenantId,id));await tx.update(jobs).set({status:'RETRY',nextAttemptAt:new Date(),consecutiveFailures:0,pollCount:0,errorCode:null}).where(jobWhere(job));}
      await tx.insert(auditLogs).values({tenantId,userId,action:confirm?'CAPTIONS_CONFIRMED':'CAPTIONS_UPDATED',resourceId:id,correlationId,metadata:{revision}});return {revision};
    });
  }
  async manualCaptions(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[],correlationId:string){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId)));if(!project)throw new DomainError('NOT_FOUND',404);await validate(tx,project,policies);
      const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,project.jobId)));
      if(!job||job.status!=='RECONCILIATION'||project.captionMode!=='AUTO'||project.captionMutationState!=='UNKNOWN'||!project.originalStoredAt||!project.sourceDurationMs)throw new DomainError('CONFLICT',409);
      if(project.captionReservationId)await settleInTransaction(tx,tenantId,project.captionReservationId,'RELEASE',correlationId);
      await tx.insert(captions).values({tenantId,projectId:id,source:'MANUAL',segments:[]});
      await tx.update(videoProjects).set({captionMode:'MANUAL',captionReservationId:null}).where(projectWhere(tenantId,id));
      await tx.update(jobs).set({status:'WAITING_REVIEW',errorCode:null,progress:60}).where(jobWhere(job));
      await tx.insert(auditLogs).values({tenantId,userId,action:'CAPTIONS_MANUAL_FALLBACK',resourceId:id,correlationId});
    });
  }
  async complete(job:StoredJob,policies:ConsentPolicy[],durationSeconds:number,bytes:number){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);await assertMembership(tx,active.requestedBy,job.tenantId,'generate');const project=await projectFor(tx,active);await validate(tx,project,policies);
      const charged=Math.ceil(durationSeconds);if(!Number.isSafeInteger(charged)||charged<1||charged>project.maxDurationSeconds||!Number.isSafeInteger(bytes)||bytes<1||bytes>256*1024*1024)throw new DomainError('INVALID_MEDIA',422);
      if(project.captionMode!=='NONE'){const [track]=await tx.select().from(captions).where(and(eq(captions.tenantId,job.tenantId),eq(captions.projectId,project.id)));if(!track||track.confirmedRevision!==track.revision)throw new DomainError('CONFLICT',409);}
      await settleInTransaction(tx,job.tenantId,job.reservationId,'CAPTURE',job.correlationId,charged);
      if(project.captionReservationId)await settleInTransaction(tx,job.tenantId,project.captionReservationId,'CAPTURE',job.correlationId);
      await transition(tx,project,'READY',job.correlationId,{durationMs:Math.round(durationSeconds*1000),chargedSeconds:charged});
      await tx.update(videoProjects).set({durationMs:Math.round(durationSeconds*1000),finalBytes:bytes}).where(projectWhere(job.tenantId,project.id));
      await tx.update(jobs).set({status:'SUCCEEDED',progress:100,result:{internalId:project.id,version:1},finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(jobWhere(job));
      await tx.insert(auditLogs).values({tenantId:job.tenantId,action:'VIDEO_READY',resourceId:project.id,correlationId:job.correlationId,metadata:{chargedSeconds:charged}});
    });
  }
  async fail(job:StoredJob,code:string,definitive=false){
    await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const active=await ownedJob(tx,job.tenantId,job.id,job.leaseToken!);const project=await projectFor(tx,active);
      const rejected=definitive&&project.mutationState==='STARTED'&&!project.reference,uncertain=!project.reference&&!!project.firstSubmittedAt&&!rejected&&project.mutationState!=='REJECTED';const failures=active.consecutiveFailures+1;
      const captionUnknown=project.captionMode==='AUTO'&&['STARTED','UNKNOWN'].includes(project.captionMutationState)&&!definitive;
      if(captionUnknown)await tx.update(videoProjects).set({captionMutationState:'UNKNOWN'}).where(projectWhere(job.tenantId,project.id));
      if(definitive&&project.captionMutationState==='STARTED')await tx.update(videoProjects).set({captionMutationState:'REJECTED'}).where(projectWhere(job.tenantId,project.id));
      const retry=!captionUnknown&&code==='PROVIDER_UNAVAILABLE'&&failures<active.maxAttempts&&(!!project.reference||!project.firstSubmittedAt||Date.now()-project.firstSubmittedAt.getTime()<23*3600_000);
      const reconcile=!retry&&(captionUnknown||uncertain||code==='RECONCILIATION_REQUIRED'||(!!project.reference&&code==='PROVIDER_UNAVAILABLE'));
      if(!retry&&!reconcile){await settleInTransaction(tx,job.tenantId,job.reservationId,'RELEASE',job.correlationId);if(project.captionReservationId)await settleInTransaction(tx,job.tenantId,project.captionReservationId,'RELEASE',job.correlationId);await transition(tx,project,'FAILED',job.correlationId,{code});}
      if(rejected||uncertain)await tx.update(videoProjects).set({mutationState:rejected?'REJECTED':'UNKNOWN'}).where(projectWhere(job.tenantId,project.id));
      await tx.update(jobs).set({status:retry?'RETRY':reconcile?'RECONCILIATION':'FAILED',errorCode:reconcile?'RECONCILIATION_REQUIRED':code,consecutiveFailures:failures,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(Date.now()+5000*2**Math.min(failures-1,6)),finishedAt:retry||reconcile?null:new Date()}).where(jobWhere(job));
      await tx.insert(auditLogs).values({tenantId:job.tenantId,action:reconcile?'VIDEO_RECONCILIATION_REQUIRED':retry?'VIDEO_RETRY':'VIDEO_FAILED',resourceId:project.id,correlationId:job.correlationId,metadata:{code}});
    });
  }
  async ready(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[],approve=false,correlationId:string=randomUUID()){
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,approve?'approve':'read');const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId),eq(videoProjects.stage,'READY'),eq(videoProjects.lifecycle,'ACTIVE')));if(!project)throw new DomainError('NOT_FOUND',404);await validate(tx,project,policies);
      if(approve&&!project.approvedAt){await tx.update(videoProjects).set({approvedBy:userId,approvedAt:new Date()}).where(projectWhere(tenantId,id));await tx.insert(auditLogs).values({tenantId,userId,action:'VIDEO_APPROVED',resourceId:id,correlationId,metadata:{scriptVersion:project.scriptVersion}});}return project;
    });
  }
  async history(userId:string,tenantId:string,brandId:string,id:string){
    await this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);const [project]=await tx.select({id:videoProjects.id}).from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId)));if(!project)throw new DomainError('NOT_FOUND',404);});
    return this.db.select({revision:videoTransitions.revision,from:videoTransitions.fromStage,to:videoTransitions.toStage,details:videoTransitions.details,createdAt:videoTransitions.createdAt}).from(videoTransitions).where(and(eq(videoTransitions.tenantId,tenantId),eq(videoTransitions.projectId,id))).orderBy(videoTransitions.revision);
  }
  async resume(userId:string,tenantId:string,brandId:string,id:string,policies:ConsentPolicy[],correlationId:string){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');
      const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId))).for('update');
      if(!project)throw new DomainError('NOT_FOUND',404);await validate(tx,project,policies);
      const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,project.jobId))).for('update');
      if(!job||job.status!=='RECONCILIATION')throw new DomainError('CONFLICT',409);
      if(project.captionMode==='AUTO'&&project.captionMutationState==='UNKNOWN')throw new DomainError('RECONCILIATION_REQUIRED',409);
      if(!project.reference&&project.firstSubmittedAt&&Date.now()-project.firstSubmittedAt.getTime()>=23*3600_000)throw new DomainError('RECONCILIATION_REQUIRED',409);
      await tx.update(jobs).set({status:'RETRY',consecutiveFailures:0,pollCount:0,nextAttemptAt:new Date(),errorCode:null}).where(jobWhere(job));
      await tx.insert(auditLogs).values({tenantId,userId,action:'VIDEO_CHECK_RESUMED',resourceId:id,correlationId});
    });
  }
  async delete(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [project]=await tx.select().from(videoProjects).where(and(projectWhere(tenantId,id),eq(videoProjects.brandId,brandId))).for('update');
      if(!project)throw new DomainError('NOT_FOUND',404);if(project.lifecycle!=='ACTIVE')return {status:project.lifecycle};
      const [job]=await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.id,project.jobId))).for('update');if(!job)throw new DomainError('NOT_FOUND',404);
      const running=job.status==='RUNNING';
      if(!['SUCCEEDED','FAILED'].includes(job.status)){
        await settleInTransaction(tx,tenantId,job.reservationId,'RELEASE',correlationId);
        if(project.captionReservationId)await settleInTransaction(tx,tenantId,project.captionReservationId,'RELEASE',correlationId);
        await transition(tx,project,'FAILED',correlationId,{code:'DELETION_REQUESTED'});
        await tx.update(jobs).set({status:'FAILED',errorCode:'DELETION_REQUESTED',finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null}).where(jobWhere(job));
      }
      // Fence active worker writes before removing objects. The worker has bounded
      // requests, a 30s heartbeat and a 5m lease; retain one extra request timeout.
      const after=running?Math.max(Date.now()+120_000,(job.leaseExpiresAt?.getTime()??Date.now())+60_000):Date.now();
      const unknown=!project.reference&&['STARTED','UNKNOWN'].includes(project.mutationState);
      await tx.update(videoProjects).set({lifecycle:'DELETE_PENDING',deleteAfter:new Date(after),deleteCorrelationId:correlationId,deleteError:unknown?'RECONCILIATION_REQUIRED':null,approvedAt:null,approvedBy:null}).where(projectWhere(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'VIDEO_DELETION_REQUESTED',resourceId:id,correlationId});return {status:'DELETE_PENDING' as const};
    });
  }
  async claimDeletion(provider:string){
    return this.db.transaction(async tx=>{
      const [project]=await tx.select().from(videoProjects).where(and(eq(videoProjects.provider,provider),eq(videoProjects.lifecycle,'DELETE_PENDING'),sql`${videoProjects.deleteAfter} <= now()`,sql`(${videoProjects.deleteLeaseExpiresAt} is null or ${videoProjects.deleteLeaseExpiresAt} < now())`,sql`(${videoProjects.reference} is not null or ${videoProjects.mutationState} in ('NONE','REJECTED'))`)).orderBy(videoProjects.deleteAfter).limit(1).for('update',{skipLocked:true});
      if(!project)return null;
      const [claimed]=await tx.update(videoProjects).set({deleteLeaseToken:randomUUID(),deleteLeaseExpiresAt:new Date(Date.now()+300_000),deleteAttempts:project.deleteAttempts+1}).where(projectWhere(project.tenantId,project.id)).returning();return claimed!;
    });
  }
  async finishDeletion(project:StoredVideo,succeeded:boolean){
    await this.db.transaction(async tx=>{
      await lockTenant(tx,project.tenantId);
      const [active]=await tx.select().from(videoProjects).where(and(projectWhere(project.tenantId,project.id),eq(videoProjects.lifecycle,'DELETE_PENDING'),eq(videoProjects.deleteLeaseToken,project.deleteLeaseToken!))).for('update');
      if(!active)return;
      const lease={deleteLeaseToken:null,deleteLeaseExpiresAt:null};
      if(!succeeded){await tx.update(videoProjects).set({...lease,deleteError:'PROVIDER_UNAVAILABLE',deleteAfter:new Date(Date.now()+Math.min(3600_000,5000*2**Math.min(active.deleteAttempts,10)))}).where(projectWhere(project.tenantId,project.id));return;}
      const tombstone={provider:project.provider,externalId:'deleted',internalId:project.id,metadata:{}};
      await tx.update(videoProjects).set({...lease,lifecycle:'DELETED',deletedAt:new Date(),deleteError:null,scriptText:'',title:'Удалённое видео',reference:null,avatarReference:tombstone,voiceReference:tombstone,options:{...active.options,captions:[]}}).where(projectWhere(project.tenantId,project.id));
      await tx.update(captions).set({segments:[]}).where(and(eq(captions.tenantId,project.tenantId),eq(captions.projectId,project.id)));
      await tx.update(aiCalls).set({output:null}).where(and(eq(aiCalls.tenantId,project.tenantId),eq(aiCalls.jobId,project.jobId)));
      await tx.insert(auditLogs).values({tenantId:project.tenantId,action:'VIDEO_DELETED',resourceId:project.id,correlationId:project.deleteCorrelationId!,metadata:{attempts:active.deleteAttempts}});
    });
  }
}
