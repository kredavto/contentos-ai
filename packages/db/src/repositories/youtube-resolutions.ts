import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {and,eq,sql,inArray,asc,desc,or} from 'drizzle-orm';
import {DomainError,youtubeResolutionSchema,youtubeVideoIdSchema,type YouTubeResolutionInput,type YouTubeVideo,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {publishingJobs,youtubeUploads,publications,youtubeResolutions,youtubeResolutionTasks,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
import {assertPlatformOperator} from './admin';
import {publishingSource,transitionPublication} from './publishing';
import type {ConsentPolicy} from './avatars';
const hash=(input:YouTubeResolutionInput)=>createHash('sha256').update(JSON.stringify(youtubeResolutionSchema.parse(input))).digest('hex');
export type YouTubeResolutionExecution={id:string;leaseToken:string};
type Task=typeof youtubeResolutionTasks.$inferSelect;
const taskWhere=(tenantId:string,id:string)=>and(eq(youtubeResolutionTasks.tenantId,tenantId),eq(youtubeResolutionTasks.id,id));
export class YouTubeResolutionRepository{
  constructor(private readonly db:Database){}
  private async authorize(tx:Transaction,actorId:string,input:YouTubeResolutionInput){
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`youtube-resolution:${actorId}:${input.idempotencyKey}`},0))`);
    if((await assertPlatformOperator(tx,actorId)).role!=='ADMIN')throw new DomainError('NOT_AUTHORIZED',403);
    await lockTenant(tx,input.tenantId);
  }
  private async existing(tx:Transaction,actorId:string,input:YouTubeResolutionInput){
    const [row]=await tx.select().from(youtubeResolutions).where(and(eq(youtubeResolutions.actorId,actorId),eq(youtubeResolutions.requestKey,input.idempotencyKey)));
    if(row&&row.inputHash!==hash(input))throw new DomainError('CONFLICT',409);
    return row?{id:row.id,publicationId:row.publicationId}:null;
  }
  private async target(tx:Transaction,input:YouTubeResolutionInput,policies:ConsentPolicy[]){
    const [row]=await tx.select({job:publishingJobs,upload:youtubeUploads}).from(publishingJobs).innerJoin(youtubeUploads,and(eq(youtubeUploads.tenantId,publishingJobs.tenantId),eq(youtubeUploads.jobId,publishingJobs.id)))
      .where(and(eq(publishingJobs.tenantId,input.tenantId),eq(publishingJobs.id,input.jobId),eq(publishingJobs.provider,'youtube')));
    if(!row)throw new DomainError('NOT_FOUND',404);
    const {job,upload}=row,snapshot=job.snapshot.youtube;
    // Missing initiation evidence or an uncertain thumbnail must never be promoted to success.
    if(job.status!=='RECONCILIATION'||!snapshot||upload.revision!==input.expectedRevision||!upload.videoId||upload.nextByte!==upload.totalBytes||!(upload.phase==='VERIFYING'||(upload.phase==='PROCESSING'&&!snapshot.coverKey)))throw new DomainError('RECONCILIATION_REQUIRED',409);
    await assertMembership(tx,job.approvedBy,job.tenantId,'strategy');
    const source=await publishingSource(tx,job.tenantId,job.brandId,job.calendarId,job.calendarRevision,job.connectionId,policies,{categoryId:snapshot.metadata.categoryId,madeForKids:snapshot.metadata.madeForKids,containsSyntheticMedia:snapshot.metadata.containsSyntheticMedia,uploadCover:!!snapshot.coverKey});
    if(source.connection.provider!=='youtube'||source.connection.reference.externalId!==upload.channelId||source.connection.credentialVersion!==job.credentialVersion||!isDeepStrictEqual(source.snapshot,job.snapshot))throw new DomainError('CONFLICT',409);
    return {job,upload,demo:source.connection.reference.metadata.demo===true};
  }
  async prepare(actorId:string,raw:YouTubeResolutionInput,policies:ConsentPolicy[],correlationId:string,execution?:YouTubeResolutionExecution){
    const input=youtubeResolutionSchema.parse(raw);
    return this.db.transaction(async tx=>{
      await this.authorize(tx,actorId,input);if(execution)await this.execution(tx,actorId,input,execution);const existing=await this.existing(tx,actorId,input);if(existing)return {completed:existing,target:null};
      const {job,upload,demo}=await this.target(tx,input,policies);
      await tx.insert(auditLogs).values({tenantId:input.tenantId,userId:actorId,action:'ADMIN_YOUTUBE_RESOLUTION_CHECK',resourceId:job.id,correlationId,metadata:{revision:upload.revision,ticket:input.ticket}});
      return {completed:null,target:{approvedBy:job.approvedBy,brandId:job.brandId,connectionId:job.connectionId,credentialVersion:job.credentialVersion,videoId:upload.videoId!,channelId:upload.channelId,demo}};
    });
  }
  async complete(actorId:string,raw:YouTubeResolutionInput,video:YouTubeVideo,verifiedAt:Date,policies:ConsentPolicy[],correlationId:string,execution?:YouTubeResolutionExecution){
    const input=youtubeResolutionSchema.parse(raw);
    return this.db.transaction(async tx=>{
      await this.authorize(tx,actorId,input);if(execution)await this.execution(tx,actorId,input,execution);const existing=await this.existing(tx,actorId,input);if(existing){if(execution)await this.succeeded(tx,input.tenantId,execution.id,existing.id);return existing;}
      const {job,upload,demo}=await this.target(tx,input,policies);
      const [fresh]=await tx.select({valid:sql<boolean>`${verifiedAt.toISOString()}::timestamptz between clock_timestamp()-interval '60 seconds' and clock_timestamp()`}).from(publishingJobs).where(and(eq(publishingJobs.tenantId,input.tenantId),eq(publishingJobs.id,input.jobId)));
      if(!fresh?.valid||video.state!=='READY'||video.failureCode!==null||video.privacy!==job.snapshot.youtube!.metadata.privacy||video.channelId!==upload.channelId||video.reference.provider!=='youtube'||video.reference.internalId!==job.id||!youtubeVideoIdSchema.safeParse(video.reference.externalId).success||video.reference.externalId!==upload.videoId||(video.reference.metadata.demo===true)!==demo)throw new DomainError('PROVIDER_REJECTED',502);
      const [publication]=await tx.insert(publications).values({tenantId:job.tenantId,jobId:job.id,provider:'youtube',reference:video.reference,url:demo?null:`https://www.youtube.com/watch?v=${video.reference.externalId}`,publishedAt:verifiedAt}).returning({id:publications.id});
      await tx.update(youtubeUploads).set({phase:'COMPLETE',session:null,retryCount:0,lastError:null,revision:upload.revision+1,updatedAt:sql`clock_timestamp()`}).where(and(eq(youtubeUploads.tenantId,job.tenantId),eq(youtubeUploads.id,upload.id)));
      await transitionPublication(tx,{...job,correlationId},'PUBLISHED',null,actorId);
      await tx.update(publishingJobs).set({leaseToken:null}).where(and(eq(publishingJobs.tenantId,job.tenantId),eq(publishingJobs.id,job.id)));
      const [resolution]=await tx.insert(youtubeResolutions).values({tenantId:input.tenantId,jobId:job.id,publicationId:publication!.id,actorId,requestKey:input.idempotencyKey,inputHash:hash(input),ticket:input.ticket,expectedRevision:input.expectedRevision,source:demo?'DEMO':'API',verifiedAt,correlationId}).returning({id:youtubeResolutions.id,publicationId:youtubeResolutions.publicationId});
      await tx.insert(auditLogs).values({tenantId:input.tenantId,userId:actorId,action:'ADMIN_YOUTUBE_PUBLICATION_RESOLVED',resourceId:job.id,correlationId,metadata:{resolutionId:resolution!.id,ticket:input.ticket,revision:input.expectedRevision}});
      if(execution)await this.succeeded(tx,input.tenantId,execution.id,resolution!.id);
      return resolution!;
    });
  }
  private async execution(tx:Transaction,actorId:string,input:YouTubeResolutionInput,execution:YouTubeResolutionExecution){
    const [task]=await tx.select().from(youtubeResolutionTasks).where(and(taskWhere(input.tenantId,execution.id),eq(youtubeResolutionTasks.actorId,actorId),eq(youtubeResolutionTasks.inputHash,hash(input)),eq(youtubeResolutionTasks.status,'RUNNING'),eq(youtubeResolutionTasks.leaseToken,execution.leaseToken),sql`${youtubeResolutionTasks.leaseExpiresAt}>clock_timestamp()`));
    if(!task)throw new DomainError('CONFLICT',409);return task;
  }
  private async succeeded(tx:Transaction,tenantId:string,id:string,resolutionId:string){await tx.update(youtubeResolutionTasks).set({status:'SUCCEEDED',resolutionId,errorCode:null,finishedAt:sql`clock_timestamp()`,leaseToken:null,leaseExpiresAt:null}).where(taskWhere(tenantId,id));}
  async enqueue(actorId:string,raw:YouTubeResolutionInput,policies:ConsentPolicy[],correlationId:string){
    const input=youtubeResolutionSchema.parse(raw);
    return this.db.transaction(async tx=>{
      await this.authorize(tx,actorId,input);
      const [existing]=await tx.select().from(youtubeResolutionTasks).where(and(eq(youtubeResolutionTasks.actorId,actorId),eq(youtubeResolutionTasks.requestKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==hash(input))throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const receipt=await this.existing(tx,actorId,input);if(!receipt)await this.target(tx,input,policies);
      const active=await tx.select({jobId:youtubeResolutionTasks.jobId}).from(youtubeResolutionTasks).where(and(eq(youtubeResolutionTasks.tenantId,input.tenantId),inArray(youtubeResolutionTasks.status,['QUEUED','RUNNING']))).limit(26);
      if(active.some(row=>row.jobId===input.jobId))throw new DomainError('CONFLICT',409);if(active.length>=25)throw new DomainError('RATE_LIMITED',429);
      const [recent]=await tx.select({id:youtubeResolutionTasks.id}).from(youtubeResolutionTasks).where(and(eq(youtubeResolutionTasks.tenantId,input.tenantId),eq(youtubeResolutionTasks.jobId,input.jobId),sql`${youtubeResolutionTasks.createdAt}>clock_timestamp()-interval '1 minute'`)).limit(1);if(recent)throw new DomainError('RATE_LIMITED',429);
      const [task]=await tx.insert(youtubeResolutionTasks).values({tenantId:input.tenantId,jobId:input.jobId,actorId,requestKey:input.idempotencyKey,input,inputHash:hash(input),correlationId,...(receipt?{status:'SUCCEEDED' as const,resolutionId:receipt.id,finishedAt:new Date()}:{} )}).returning({id:youtubeResolutionTasks.id,status:youtubeResolutionTasks.status});
      await tx.insert(auditLogs).values({tenantId:input.tenantId,userId:actorId,action:'ADMIN_YOUTUBE_RESOLUTION_REQUESTED',resourceId:input.jobId,correlationId,metadata:{taskId:task!.id,ticket:input.ticket,revision:input.expectedRevision}});return task!;
    });
  }
  async tasks(actorId:string,tenantId:string,jobId:string,correlationId:string){return this.db.transaction(async tx=>{
    await assertPlatformOperator(tx,actorId);
    const rows=await tx.select({id:youtubeResolutionTasks.id,status:youtubeResolutionTasks.status,attempt:youtubeResolutionTasks.attempt,errorCode:youtubeResolutionTasks.errorCode,resolutionId:youtubeResolutionTasks.resolutionId,createdAt:youtubeResolutionTasks.createdAt,finishedAt:youtubeResolutionTasks.finishedAt}).from(youtubeResolutionTasks).where(and(eq(youtubeResolutionTasks.tenantId,tenantId),eq(youtubeResolutionTasks.jobId,jobId))).orderBy(desc(youtubeResolutionTasks.createdAt),desc(youtubeResolutionTasks.id)).limit(20);
    await tx.insert(auditLogs).values({userId:actorId,action:'ADMIN_YOUTUBE_RESOLUTION_TASKS_READ',correlationId,metadata:{tenantId,jobId}});return rows;
  });}
  async dueTasks(){return this.db.select({tenantId:youtubeResolutionTasks.tenantId,id:youtubeResolutionTasks.id}).from(youtubeResolutionTasks).where(and(sql`${youtubeResolutionTasks.dispatchAfter}<=clock_timestamp()`,or(and(eq(youtubeResolutionTasks.status,'QUEUED'),sql`${youtubeResolutionTasks.nextAttemptAt}<=clock_timestamp()`),and(eq(youtubeResolutionTasks.status,'RUNNING'),sql`${youtubeResolutionTasks.leaseExpiresAt}<=clock_timestamp()`)))).orderBy(asc(youtubeResolutionTasks.nextAttemptAt)).limit(25);}
  async taskDispatched(tenantId:string,id:string){await this.db.update(youtubeResolutionTasks).set({dispatchAfter:sql`clock_timestamp()+interval '10 seconds'`}).where(and(taskWhere(tenantId,id),inArray(youtubeResolutionTasks.status,['QUEUED','RUNNING'])));}
  async claimTask(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);
    const [task]=await tx.select().from(youtubeResolutionTasks).where(and(taskWhere(tenantId,id),inArray(youtubeResolutionTasks.status,['QUEUED','RUNNING']),sql`${youtubeResolutionTasks.nextAttemptAt}<=clock_timestamp() and (${youtubeResolutionTasks.leaseExpiresAt} is null or ${youtubeResolutionTasks.leaseExpiresAt}<=clock_timestamp())`));if(!task)return null;
    if(task.attempt>=3||task.createdAt.getTime()<Date.now()-86400000){await tx.update(youtubeResolutionTasks).set({status:'FAILED',errorCode:'PROVIDER_UNAVAILABLE',finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null}).where(taskWhere(tenantId,id));return null;}
    const [claimed]=await tx.update(youtubeResolutionTasks).set({status:'RUNNING',attempt:task.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:sql`clock_timestamp()+interval '2 minutes'`}).where(taskWhere(tenantId,id)).returning();return claimed!;
  });}
  async acknowledgeTask(task:Task,resolutionId:string){await this.db.transaction(async tx=>{
    await this.authorize(tx,task.actorId,task.input);
    const [current]=await tx.select().from(youtubeResolutionTasks).where(taskWhere(task.tenantId,task.id));if(current?.status==='SUCCEEDED'&&current.resolutionId===resolutionId)return;
    await this.execution(tx,task.actorId,task.input,{id:task.id,leaseToken:task.leaseToken!});
    const receipt=await this.existing(tx,task.actorId,task.input);if(!receipt||receipt.id!==resolutionId)throw new DomainError('CONFLICT',409);await this.succeeded(tx,task.tenantId,task.id,resolutionId);
  });}
  async failTask(task:Task,code:ErrorCode){await this.db.transaction(async tx=>{
    await lockTenant(tx,task.tenantId);
    const [current]=await tx.select().from(youtubeResolutionTasks).where(and(taskWhere(task.tenantId,task.id),eq(youtubeResolutionTasks.status,'RUNNING'),eq(youtubeResolutionTasks.leaseToken,task.leaseToken!),sql`${youtubeResolutionTasks.leaseExpiresAt}>clock_timestamp()`));if(!current)return;
    const retry=code==='PROVIDER_UNAVAILABLE'&&current.attempt<3;
    await tx.update(youtubeResolutionTasks).set({status:retry?'QUEUED':(['NOT_AUTHORIZED','NOT_FOUND','CONSENT_REQUIRED','SOCIAL_TOKEN_EXPIRED'].includes(code)?'CANCELLED':'FAILED'),errorCode:code,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:sql`clock_timestamp()+${5*2**current.attempt}*interval '1 second'`,finishedAt:retry?null:new Date()}).where(taskWhere(task.tenantId,task.id));
    await tx.insert(auditLogs).values({tenantId:task.tenantId,userId:task.actorId,action:'ADMIN_YOUTUBE_RESOLUTION_ATTEMPT_FAILED',resourceId:task.jobId,correlationId:task.correlationId,metadata:{taskId:task.id,code,attempt:current.attempt,retry}});
  });}

}
