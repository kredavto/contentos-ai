import {assertManagedFeature} from './feature-policy';
import {isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {and,eq,lte,or,inArray,desc,asc,ne,sql} from 'drizzle-orm';
import {DomainError,telegramVideoByteLimit,validateTelegramPublication,youtubeMetadataSchema,type PublishingApproval,type PublishingSnapshot,type PublishingState,type PublishingProvider,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {publishingJobs,publications,calendarEntries,contentItems,socialConnections,videoProjects,brands,auditLogs,youtubeUploads} from '../schema';
import {lockTenant,assertMembership,type Transaction} from './ledger';
import {validateVideo} from './videos';
import type {ConsentPolicy} from './avatars';
type Job=typeof publishingJobs.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.id,id));
const frozen:PublishingState[]=['SCHEDULED','PREPARING','SUBMITTING','RECONCILIATION','PUBLISHED'];
export async function assertCalendarEditable(tx:Transaction,tenantId:string,calendarId:string){const [job]=await tx.select({id:publishingJobs.id}).from(publishingJobs).where(and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.calendarId,calendarId),inArray(publishingJobs.status,frozen))).limit(1);if(job)throw new DomainError('CONFLICT',409);}
export async function transitionPublication(tx:Transaction,job:Job,status:PublishingState,code:string|null=null,actor=job.approvedBy){
  await tx.update(publishingJobs).set({status,errorCode:code,...(['PUBLISHED','FAILED','CANCELLED'].includes(status)?{finishedAt:new Date(),leaseExpiresAt:null}:{})}).where(where(job.tenantId,job.id));
  const contentStatus=status==='PUBLISHED'?'PUBLISHED':status==='SUBMITTING'||status==='RECONCILIATION'?'PUBLISHING':status==='FAILED'?'FAILED':status==='CANCELLED'?'APPROVED':'SCHEDULED';
  await tx.update(contentItems).set({status:contentStatus}).where(and(eq(contentItems.tenantId,job.tenantId),eq(contentItems.id,job.contentItemId)));
  await tx.insert(auditLogs).values({tenantId:job.tenantId,userId:actor,action:`PUBLICATION_${status}`,resourceId:job.id,correlationId:job.correlationId,metadata:{from:job.status,to:status,code,attempt:job.attempt}});
}
export async function cancelConnectionPublishing(tx:Transaction,tenantId:string,connectionId:string,actor:string){
  const rows=await tx.select().from(publishingJobs).where(and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.connectionId,connectionId),inArray(publishingJobs.status,['SCHEDULED','PREPARING'])));
  for(const row of rows)await transitionPublication(tx,row,'CANCELLED','SOCIAL_TOKEN_EXPIRED',actor);
}
export async function publishingSource(tx:Transaction,tenantId:string,brandId:string,calendarId:string,revision:number,connectionId:string,policies:ConsentPolicy[],youtube?:PublishingApproval['youtube']){
  const [entry]=await tx.select().from(calendarEntries).where(and(eq(calendarEntries.tenantId,tenantId),eq(calendarEntries.brandId,brandId),eq(calendarEntries.id,calendarId)));
  if(!entry)throw new DomainError('NOT_FOUND',404);
  if(entry.status!=='PLANNED'||entry.revision!==revision||entry.platform!==(youtube?'YOUTUBE':'TELEGRAM')||entry.publishingMode!=='APPROVAL')throw new DomainError('CONFLICT',409);
  const [content]=await tx.select().from(contentItems).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.brandId,brandId),eq(contentItems.id,entry.contentItemId)));
  const [connection]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,connectionId)));
  if(!content||!connection)throw new DomainError('NOT_FOUND',404);
  if(connection.status!=='ACTIVE'||!connection.credential)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
  const caption=[entry.caption.trim(),entry.hashtags.map(tag=>`#${tag}`).join(' ')].filter(Boolean).join('\n\n');
  if(youtube){if(connection.provider!=='youtube'||content.type!=='SHORT_VIDEO')throw new DomainError('INVALID_INPUT');}
  else validateTelegramPublication({type:content.type,caption,privacy:entry.privacy,commentsEnabled:entry.commentsEnabled},connection.reference);
  let finalKey:string|null=null;let videoApproval:Pick<PublishingSnapshot,'videoRevision'|'videoApprovedAt'>={};let youtubeSnapshot:PublishingSnapshot['youtube'];
  if(content.type==='SHORT_VIDEO'){
    const [video]=await tx.select().from(videoProjects).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.brandId,brandId),eq(videoProjects.id,entry.videoProjectId??'00000000-0000-0000-0000-000000000000')));
    if(!video||video.stage!=='READY'||!video.approvedAt||!video.finalBytes||video.finalBytes>(youtube?256*1024*1024:telegramVideoByteLimit))throw new DomainError('INVALID_MEDIA');
    await validateVideo(tx,video,policies);finalKey=video.finalKey;videoApproval={videoRevision:video.stageRevision,videoApprovedAt:video.approvedAt.toISOString()};
    if(youtube)youtubeSnapshot={metadata:youtubeMetadataSchema.parse({title:content.title,description:caption,tags:entry.hashtags,categoryId:youtube.categoryId,privacy:entry.privacy,madeForKids:youtube.madeForKids,containsSyntheticMedia:youtube.containsSyntheticMedia}),totalBytes:video.finalBytes,coverKey:youtube.uploadCover?video.coverKey:null,coverRevision:youtube.uploadCover?video.coverRevision:null};
  }else if(entry.videoProjectId)throw new DomainError('INVALID_INPUT');
  const snapshot:PublishingSnapshot={title:content.title,type:content.type as 'POST'|'SHORT_VIDEO',caption,privacy:entry.privacy,commentsEnabled:entry.commentsEnabled,timeZone:entry.timeZone,videoProjectId:entry.videoProjectId,finalKey,...videoApproval,...(youtubeSnapshot?{youtube:youtubeSnapshot}:{})};
  return {entry,connection,snapshot};
}
export class PublishingRepository{
  constructor(private readonly db:Database,private readonly now:()=>Date=()=>new Date()){}
  /** Read stored publication evidence only; never contact providers or expose raw snapshots. */
  async publication(userId:string,tenantId:string,brandId:string,publicationId:string){
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const [publication]=await tx.select({id:publications.id,brandId:publishingJobs.brandId,brandName:brands.name,contentTitle:contentItems.title,
        title:sql<string>`${publishingJobs.snapshot}->>'title'`,caption:sql<string>`${publishingJobs.snapshot}->>'caption'`,type:sql<string>`${publishingJobs.snapshot}->>'type'`,privacy:sql<string>`${publishingJobs.snapshot}->>'privacy'`,commentsEnabled:sql<boolean>`(${publishingJobs.snapshot}->>'commentsEnabled')::boolean`,timeZone:sql<string>`${publishingJobs.snapshot}->>'timeZone'`,
        provider:publications.provider,status:publishingJobs.status,publishedAt:publications.publishedAt,recordedAt:publications.recordedAt,scheduledAt:publishingJobs.scheduledAt})
        .from(publications)
        .innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId)))
        .innerJoin(brands,and(eq(brands.tenantId,publishingJobs.tenantId),eq(brands.id,publishingJobs.brandId)))
        .innerJoin(contentItems,and(eq(contentItems.tenantId,publishingJobs.tenantId),eq(contentItems.brandId,publishingJobs.brandId),eq(contentItems.id,publishingJobs.contentItemId)))
        .where(and(eq(publications.tenantId,tenantId),eq(publishingJobs.brandId,brandId),eq(publications.id,publicationId)));
      if(!publication)throw new DomainError('NOT_FOUND',404);
      return {...publication,role:member.role};
    });
  }

  async list(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);
    const rows=await tx.select({job:publishingJobs,url:publications.url,publishedAt:publications.publishedAt,recordedAt:publications.recordedAt,uploadPhase:youtubeUploads.phase,uploadedBytes:youtubeUploads.nextByte,totalBytes:youtubeUploads.totalBytes,remoteVideoId:youtubeUploads.videoId}).from(publishingJobs).leftJoin(publications,and(eq(publications.tenantId,publishingJobs.tenantId),eq(publications.jobId,publishingJobs.id))).leftJoin(youtubeUploads,and(eq(youtubeUploads.tenantId,publishingJobs.tenantId),eq(youtubeUploads.jobId,publishingJobs.id))).where(and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.brandId,brandId))).orderBy(desc(publishingJobs.createdAt)).limit(100);
    return rows.map(({job,url,publishedAt,recordedAt,uploadPhase,uploadedBytes,totalBytes,remoteVideoId})=>({id:job.id,calendarId:job.calendarId,calendarRevision:job.calendarRevision,connectionId:job.connectionId,title:job.snapshot.title,caption:job.snapshot.caption,type:job.snapshot.type,status:job.status,scheduledAt:job.scheduledAt,timeZone:job.snapshot.timeZone,errorCode:job.errorCode,attempt:job.attempt,url,publishedAt,recordedAt,provider:job.provider,...(job.provider==='youtube'?{uploadPhase,uploadedBytes,totalBytes,reviewUrl:remoteVideoId?`https://www.youtube.com/watch?v=${remoteVideoId}`:null}:{})}));
  });}
  async approve(userId:string,tenantId:string,brandId:string,input:PublishingApproval,provider:string,policies:ConsentPolicy[],correlationId:string){
    const hash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');await assertManagedFeature(tx,provider==='youtube'?'youtube_publishing':'telegram_publishing',userId,tenantId);
      const [existing]=await tx.select().from(publishingJobs).where(and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==hash||existing.approvedBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      const data=await publishingSource(tx,tenantId,brandId,input.calendarId,input.revision,input.connectionId,policies,input.youtube);
      await assertCalendarEditable(tx,tenantId,input.calendarId);
      if(data.connection.provider!==provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
      if(data.entry.plannedAt<=this.now()||data.entry.plannedAt.getTime()>this.now().getTime()+366*86400000)throw new DomainError('INVALID_INPUT');
      const [prior]=await tx.select({id:publishingJobs.id}).from(publishingJobs).where(and(eq(publishingJobs.calendarId,input.calendarId),eq(publishingJobs.calendarRevision,input.revision)));if(prior)throw new DomainError('CONFLICT',409);
      const [job]=await tx.insert(publishingJobs).values({tenantId,brandId,calendarId:input.calendarId,calendarRevision:input.revision,contentItemId:data.entry.contentItemId,connectionId:input.connectionId,credentialVersion:data.connection.credentialVersion,provider,snapshot:data.snapshot,scheduledAt:data.entry.plannedAt,nextAttemptAt:data.entry.plannedAt,idempotencyKey:input.idempotencyKey,inputHash:hash,approvedBy:userId,correlationId}).returning();
      await transitionPublication(tx,job!,'SCHEDULED');return {id:job!.id,status:job!.status};
    });
  }
  async cancel(userId:string,tenantId:string,brandId:string,id:string){await this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');const [job]=await tx.select().from(publishingJobs).where(and(where(tenantId,id),eq(publishingJobs.brandId,brandId)));if(!job)throw new DomainError('NOT_FOUND',404);if(job.status==='CANCELLED')return;if(!['SCHEDULED','PREPARING'].includes(job.status))throw new DomainError('CONFLICT',409);await transitionPublication(tx,job,'CANCELLED',null,userId);});}
  async due(){const now=this.now();return this.db.select({tenantId:publishingJobs.tenantId,id:publishingJobs.id}).from(publishingJobs).where(and(ne(publishingJobs.provider,'youtube'),lte(publishingJobs.dispatchAfter,now),or(and(eq(publishingJobs.status,'SCHEDULED'),lte(publishingJobs.nextAttemptAt,now)),and(inArray(publishingJobs.status,['PREPARING','SUBMITTING']),lte(publishingJobs.leaseExpiresAt,now))))).orderBy(asc(publishingJobs.nextAttemptAt)).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(publishingJobs).set({dispatchAfter:new Date(this.now().getTime()+10000)}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);const [job]=await tx.select().from(publishingJobs).where(where(tenantId,id));if(!job||job.provider==='youtube')return null;const now=this.now();
    if(job.status==='SUBMITTING'&&job.leaseExpiresAt&&job.leaseExpiresAt<=now){await transitionPublication(tx,job,'RECONCILIATION','RECONCILIATION_REQUIRED');return null;}
    if(!['SCHEDULED','PREPARING'].includes(job.status)||job.nextAttemptAt>now||(job.status==='PREPARING'&&job.leaseExpiresAt&&job.leaseExpiresAt>now))return null;
    if(job.attempt>=3||now.getTime()-job.scheduledAt.getTime()>86400000){await transitionPublication(tx,job,'FAILED','PUBLISHING_FAILED');return null;}
    const leaseToken=randomUUID();await transitionPublication(tx,job,'PREPARING');const [claimed]=await tx.update(publishingJobs).set({attempt:job.attempt+1,leaseToken,leaseExpiresAt:new Date(now.getTime()+180000)}).where(where(tenantId,id)).returning();return claimed!;
  });}
  async prepare(job:Job,policies:ConsentPolicy[]){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);await this.owned(tx,job,'PREPARING');await assertMembership(tx,job.approvedBy,job.tenantId,'strategy');await assertManagedFeature(tx,job.provider==='youtube'?'youtube_publishing':'telegram_publishing',job.approvedBy,job.tenantId);const data=await publishingSource(tx,job.tenantId,job.brandId,job.calendarId,job.calendarRevision,job.connectionId,policies);if(data.connection.credentialVersion!==job.credentialVersion||data.connection.provider!==job.provider||!isDeepStrictEqual(data.snapshot,job.snapshot))throw new DomainError('CONFLICT',409);return data.connection;});}
  async begin(job:Job,policies:ConsentPolicy[]){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);await this.owned(tx,job,'PREPARING');await assertMembership(tx,job.approvedBy,job.tenantId,'strategy');await assertManagedFeature(tx,job.provider==='youtube'?'youtube_publishing':'telegram_publishing',job.approvedBy,job.tenantId);const data=await publishingSource(tx,job.tenantId,job.brandId,job.calendarId,job.calendarRevision,job.connectionId,policies);if(data.connection.credentialVersion!==job.credentialVersion||!isDeepStrictEqual(data.snapshot,job.snapshot))throw new DomainError('CONFLICT',409);await transitionPublication(tx,job,'SUBMITTING');await tx.update(publishingJobs).set({submittedAt:this.now()}).where(where(job.tenantId,job.id));});}
  async complete(job:Job,result:Awaited<ReturnType<PublishingProvider['publish']>>){await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(publishingJobs).where(where(job.tenantId,job.id));if(!current||current.leaseToken!==job.leaseToken)throw new DomainError('CONFLICT',409);if(current.status==='PUBLISHED')return;if(!['SUBMITTING','RECONCILIATION'].includes(current.status)||result.reference.provider!==job.provider||result.reference.internalId!==job.id)throw new DomainError('CONFLICT',409);
    await tx.insert(publications).values({tenantId:job.tenantId,jobId:job.id,provider:job.provider,reference:result.reference,url:result.url,publishedAt:new Date(result.publishedAt)});await transitionPublication(tx,current,'PUBLISHED');
  });}
  async fail(job:Job,code:ErrorCode,definitive=false){await this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(publishingJobs).where(where(job.tenantId,job.id));if(!current||current.leaseToken!==job.leaseToken||!['PREPARING','SUBMITTING','RECONCILIATION'].includes(current.status))return;
    if(current.status!=='PREPARING'){await transitionPublication(tx,current,definitive?'FAILED':'RECONCILIATION',definitive?code:'RECONCILIATION_REQUIRED');return;}
    if(code==='PROVIDER_UNAVAILABLE'&&current.attempt<3){await transitionPublication(tx,current,'SCHEDULED',code);await tx.update(publishingJobs).set({nextAttemptAt:new Date(this.now().getTime()+5000*2**current.attempt),leaseToken:null,leaseExpiresAt:null}).where(where(job.tenantId,job.id));}else await transitionPublication(tx,current,'FAILED',code);
  });}
  private async owned(tx:Transaction,job:Job,status:PublishingState){const [current]=await tx.select().from(publishingJobs).where(where(job.tenantId,job.id));if(!current||current.status!==status||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=this.now())throw new DomainError('CONFLICT',409);return current;}
}
