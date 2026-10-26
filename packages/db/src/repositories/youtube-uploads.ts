import {assertManagedFeature} from './feature-policy';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {and,eq,inArray,sql,asc} from 'drizzle-orm';
import {DomainError,youtubeVideoIdSchema,type EncryptedCredential,type YouTubeUploadResult,type YouTubeVideo,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {publishingJobs,youtubeUploads,publications} from '../schema';
import {lockTenant,assertMembership,type Transaction} from './ledger';
import {publishingSource,transitionPublication} from './publishing';
import type {ConsentPolicy} from './avatars';
type Job=typeof publishingJobs.$inferSelect;
type Upload=typeof youtubeUploads.$inferSelect;
export type YouTubeUploadLease=Pick<Job,'id'|'tenantId'|'leaseToken'>;
const jobWhere=(tenantId:string,id:string)=>and(eq(publishingJobs.tenantId,tenantId),eq(publishingJobs.id,id),eq(publishingJobs.provider,'youtube'));
const uploadWhere=(job:YouTubeUploadLease)=>and(eq(youtubeUploads.tenantId,job.tenantId),eq(youtubeUploads.jobId,job.id));
/** Internal worker repository. A tenant-bound current lease is the capability for recording remote evidence.
 * Permission/consent checks apply again before remote work, but losing permission must not erase its outcome. */
export class YouTubeUploadRepository{
  constructor(private readonly db:Database){}
  async due(){return this.db.select({tenantId:publishingJobs.tenantId,id:publishingJobs.id}).from(publishingJobs).where(and(eq(publishingJobs.provider,'youtube'),inArray(publishingJobs.status,['SCHEDULED','PREPARING','SUBMITTING']),sql`${publishingJobs.nextAttemptAt}<=clock_timestamp() and ${publishingJobs.dispatchAfter}<=clock_timestamp() and (${publishingJobs.leaseExpiresAt} is null or ${publishingJobs.leaseExpiresAt}<=clock_timestamp())`)).orderBy(asc(publishingJobs.nextAttemptAt)).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(publishingJobs).set({dispatchAfter:sql`clock_timestamp()+interval '10 seconds'`}).where(jobWhere(tenantId,id));}
  async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);
    const [job]=await tx.select().from(publishingJobs).where(and(jobWhere(tenantId,id),inArray(publishingJobs.status,['SCHEDULED','PREPARING','SUBMITTING']),sql`${publishingJobs.nextAttemptAt}<=clock_timestamp() and (${publishingJobs.leaseExpiresAt} is null or ${publishingJobs.leaseExpiresAt}<=clock_timestamp())`));if(!job)return null;
    const [upload]=await tx.select().from(youtubeUploads).where(uploadWhere(job));
    const [age]=await tx.select({expired:sql<boolean>`${publishingJobs.scheduledAt}<clock_timestamp()-interval '1 day'`}).from(publishingJobs).where(jobWhere(tenantId,id));
    if(job.status==='SUBMITTING'){
      if(!upload||['STARTING','THUMBNAIL','COMPLETE'].includes(upload.phase)||age?.expired||upload.retryCount>=8){await transitionPublication(tx,job,'RECONCILIATION','RECONCILIATION_REQUIRED');return null;}
    }else{
      const safeStart=upload?.phase==='STARTING'&&['RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(upload.lastError??'');
      if((upload&&!safeStart)||job.attempt>=3||age?.expired){await transitionPublication(tx,job,upload&&!safeStart?'RECONCILIATION':'FAILED',upload&&!safeStart?'RECONCILIATION_REQUIRED':'PUBLISHING_FAILED');return null;}
    }
    const status=job.status==='SUBMITTING'?'SUBMITTING':'PREPARING';
    if(job.status!==status)await transitionPublication(tx,job,status);
    const [claimed]=await tx.update(publishingJobs).set({status,leaseToken:randomUUID(),leaseExpiresAt:sql`clock_timestamp()+interval '3 minutes'`,attempt:status==='PREPARING'?job.attempt+1:job.attempt}).where(jobWhere(tenantId,id)).returning();
    return {job:claimed!,upload:upload??null};
  });}
  async prepare(lease:YouTubeUploadLease,policies:ConsentPolicy[],write=false){return this.db.transaction(async tx=>{
    await lockTenant(tx,lease.tenantId);const job=await this.owned(tx,lease);const data=await this.source(tx,job,policies);if(write)await assertManagedFeature(tx,'youtube_publishing',job.approvedBy,job.tenantId);
    const [upload]=await tx.select().from(youtubeUploads).where(uploadWhere(job));return {job,connection:data.connection,upload:upload??null};
  });}
  async begin(lease:YouTubeUploadLease,etag:string,policies:ConsentPolicy[]){
    if(!/^"[A-Za-z0-9_-]{1,128}"$/.test(etag))throw new DomainError('INVALID_INPUT');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,lease.tenantId);const job=await this.owned(tx,lease);if(job.status!=='PREPARING')throw new DomainError('CONFLICT',409);await assertManagedFeature(tx,'youtube_publishing',job.approvedBy,job.tenantId);
      const data=await this.source(tx,job,policies),youtube=job.snapshot.youtube!;
      const [prior]=await tx.select().from(youtubeUploads).where(uploadWhere(job));
      if(prior){
        if(prior.phase!=='STARTING'||!['RATE_LIMITED','PROVIDER_UNAVAILABLE'].includes(prior.lastError??'')||prior.sourceEtag!==etag||prior.channelId!==data.connection.reference.externalId||prior.totalBytes!==youtube.totalBytes)throw new DomainError('CONFLICT',409);
        await this.update(tx,prior,{lastError:null});await transitionPublication(tx,job,'SUBMITTING');await tx.update(publishingJobs).set({submittedAt:sql`clock_timestamp()`}).where(jobWhere(job.tenantId,job.id));return {...prior,lastError:null};
      }
      const [upload]=await tx.insert(youtubeUploads).values({tenantId:job.tenantId,jobId:job.id,totalBytes:youtube.totalBytes,sourceEtag:etag,channelId:data.connection.reference.externalId}).returning();
      await transitionPublication(tx,job,'SUBMITTING');await tx.update(publishingJobs).set({submittedAt:sql`clock_timestamp()`}).where(jobWhere(job.tenantId,job.id));return upload!;
    });
  }
  /** Only the processor's verified definitive rejection path may call this. Unknown outcomes stay STARTING/SUBMITTING. */
  async rejectedStart(lease:YouTubeUploadLease,code:'RATE_LIMITED'|'PROVIDER_UNAVAILABLE',retryAfterSeconds=0){
    if(!Number.isInteger(retryAfterSeconds)||retryAfterSeconds<0||retryAfterSeconds>86400)throw new DomainError('INVALID_INPUT');
    return this.mutate(lease,async(tx,job,upload)=>{
      if(upload.phase!=='STARTING')throw new DomainError('CONFLICT',409);
      await this.update(tx,upload,{lastError:code});
      if(job.attempt>=3){await transitionPublication(tx,job,'FAILED',code);return;}
      const delay=Math.max(retryAfterSeconds,5*2**job.attempt);await transitionPublication(tx,job,'SCHEDULED',code);
      await tx.update(publishingJobs).set({leaseToken:null,leaseExpiresAt:null,nextAttemptAt:sql`clock_timestamp()+${delay}*interval '1 second'`,dispatchAfter:sql`clock_timestamp()+${delay}*interval '1 second'`}).where(jobWhere(job.tenantId,job.id));
    });
  }
  async saveSession(lease:YouTubeUploadLease,session:EncryptedCredential){return this.mutate(lease,async(tx,_job,upload)=>{
    if(upload.phase!=='STARTING')throw new DomainError('CONFLICT',409);
    await this.update(tx,upload,{phase:'UPLOADING',session});
  },true);}
  async acknowledge(lease:YouTubeUploadLease,result:YouTubeUploadResult){return this.mutate(lease,async(tx,job,upload)=>{
    if(upload.phase!=='UPLOADING')throw new DomainError('CONFLICT',409);
    if(result.state==='EXPIRED'){await transitionPublication(tx,job,'RECONCILIATION','RECONCILIATION_REQUIRED');return;}
    if(result.state==='UPLOADING'){
      if(!Number.isSafeInteger(result.nextByte)||result.nextByte<upload.nextByte||result.nextByte>upload.totalBytes)throw new DomainError('PROVIDER_REJECTED',502);
      await this.update(tx,upload,{nextByte:result.nextByte,...(result.nextByte>upload.nextByte?{retryCount:0,lastError:null}:{})});return;
    }
    this.video(job,upload,result.video);
    await this.update(tx,upload,{phase:'PROCESSING',nextByte:upload.totalBytes,videoId:result.video.reference.externalId,retryCount:0,lastError:result.video.failureCode});
    if(result.video.state==='FAILED')await transitionPublication(tx,job,'RECONCILIATION','PUBLISHING_FAILED');
  },true);}
  /** Persist THUMBNAIL before its non-read-only request. A lost acknowledgement is never blindly replayed. */
  async processed(lease:YouTubeUploadLease,video:YouTubeVideo,policies:ConsentPolicy[]){return this.mutate(lease,async(tx,job,upload)=>{
    await this.source(tx,job,policies);this.video(job,upload,video);if(job.snapshot.youtube?.coverKey)await assertManagedFeature(tx,'youtube_publishing',job.approvedBy,job.tenantId);
    if(upload.phase!=='PROCESSING'||video.state!=='READY')throw new DomainError('CONFLICT',409);
    await this.update(tx,upload,{phase:job.snapshot.youtube!.coverKey?'THUMBNAIL':'VERIFYING',retryCount:0,lastError:null});
  });}
  async thumbnailSaved(lease:YouTubeUploadLease){return this.mutate(lease,async(tx,_job,upload)=>{
    if(upload.phase!=='THUMBNAIL')throw new DomainError('CONFLICT',409);await this.update(tx,upload,{phase:'VERIFYING'});
  },true);}
  async complete(lease:YouTubeUploadLease,video:YouTubeVideo){return this.mutate(lease,async(tx,job,upload)=>{
    this.video(job,upload,video);if(upload.phase!=='VERIFYING'||video.state!=='READY'||video.privacy!==job.snapshot.youtube?.metadata.privacy)throw new DomainError('CONFLICT',409);
    await tx.insert(publications).values({tenantId:job.tenantId,jobId:job.id,provider:'youtube',reference:video.reference,url:`https://www.youtube.com/watch?v=${video.reference.externalId}`,publishedAt:sql`clock_timestamp()`});
    await this.update(tx,upload,{phase:'COMPLETE',session:null,retryCount:0,lastError:null});await transitionPublication(tx,job,'PUBLISHED');
  });}
  async reschedule(lease:YouTubeUploadLease,options:{error?:ErrorCode;retryAfterSeconds?:number}={}){
    const seconds=options.retryAfterSeconds??0;if(!Number.isInteger(seconds)||seconds<0||seconds>86400)throw new DomainError('INVALID_INPUT');
    return this.mutate(lease,async(tx,job,upload)=>{
      const retryCount=upload.retryCount+(options.error?1:0);
      if(['STARTING','THUMBNAIL','COMPLETE'].includes(upload.phase)||retryCount>=8){await this.update(tx,upload,{retryCount:Math.min(retryCount,8),lastError:options.error??'RECONCILIATION_REQUIRED'});await transitionPublication(tx,job,'RECONCILIATION','RECONCILIATION_REQUIRED');return;}
      const delay=Math.max(seconds,options.error?Math.min(300,5*2**retryCount):1);
      await this.update(tx,upload,{retryCount,lastError:options.error??upload.lastError});
      await tx.update(publishingJobs).set({leaseToken:null,leaseExpiresAt:null,nextAttemptAt:sql`clock_timestamp()+${delay}*interval '1 second'`,dispatchAfter:sql`clock_timestamp()+${delay}*interval '1 second'`}).where(jobWhere(job.tenantId,job.id));
    });
  }
  async reconcile(lease:YouTubeUploadLease,code:ErrorCode='RECONCILIATION_REQUIRED'){return this.mutate(lease,async(tx,job,upload)=>{
    await this.update(tx,upload,{lastError:code});await transitionPublication(tx,job,'RECONCILIATION',code);
  },true);}
  private async source(tx:Transaction,job:Job,policies:ConsentPolicy[]){
    await assertMembership(tx,job.approvedBy,job.tenantId,'strategy');const snapshot=job.snapshot.youtube;if(!snapshot)throw new DomainError('INVALID_INPUT');
    const data=await publishingSource(tx,job.tenantId,job.brandId,job.calendarId,job.calendarRevision,job.connectionId,policies,{categoryId:snapshot.metadata.categoryId,madeForKids:snapshot.metadata.madeForKids,containsSyntheticMedia:snapshot.metadata.containsSyntheticMedia,uploadCover:!!snapshot.coverKey});
    if(data.connection.provider!=='youtube'||data.connection.credentialVersion!==job.credentialVersion||!isDeepStrictEqual(data.snapshot,job.snapshot))throw new DomainError('CONFLICT',409);return data;
  }
  private async owned(tx:Transaction,lease:YouTubeUploadLease,evidence=false){
    if(!lease.leaseToken)throw new DomainError('CONFLICT',409);
    const [job]=await tx.select().from(publishingJobs).where(and(jobWhere(lease.tenantId,lease.id),eq(publishingJobs.leaseToken,lease.leaseToken),inArray(publishingJobs.status,evidence?['SUBMITTING','RECONCILIATION']:['PREPARING','SUBMITTING']),...(evidence?[]:[sql`${publishingJobs.leaseExpiresAt}>clock_timestamp()`])));
    if(!job)throw new DomainError('CONFLICT',409);return job;
  }
  private async mutate<T>(lease:YouTubeUploadLease,action:(tx:Transaction,job:Job,upload:Upload)=>Promise<T>,evidence=false){return this.db.transaction(async tx=>{
    await lockTenant(tx,lease.tenantId);const job=await this.owned(tx,lease,evidence);const [upload]=await tx.select().from(youtubeUploads).where(uploadWhere(job));if(!upload)throw new DomainError('CONFLICT',409);return action(tx,job,upload);
  });}
  private async update(tx:Transaction,upload:Upload,value:Partial<Pick<Upload,'phase'|'session'|'nextByte'|'videoId'|'retryCount'|'lastError'>>){await tx.update(youtubeUploads).set({...value,revision:upload.revision+1,updatedAt:sql`clock_timestamp()`}).where(and(eq(youtubeUploads.tenantId,upload.tenantId),eq(youtubeUploads.id,upload.id)));}
  private video(job:Job,upload:Upload,video:YouTubeVideo){
    if(video.reference.provider!=='youtube'||video.reference.internalId!==job.id||video.channelId!==upload.channelId||!youtubeVideoIdSchema.safeParse(video.reference.externalId).success||(upload.videoId&&upload.videoId!==video.reference.externalId))throw new DomainError('PROVIDER_REJECTED',502);
  }
}
