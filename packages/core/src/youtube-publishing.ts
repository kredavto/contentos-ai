import {z} from 'zod';
import {YouTubeUploadRepository,PublishingRepository} from '@contentos/db';
import {DomainError,ProviderRequestError,type ErrorReporter,type OperationContext,type RangeStorageProvider,type YouTubePublishingProvider,type YouTubeUploadResult} from '@contentos/types';
import {CredentialVault} from './credential-vault';
import {YouTubeService} from './youtube';
import {avatarConsentPolicies} from './avatars';
import {reportError} from './error-reporting';
type Policies=Parameters<YouTubeUploadRepository['prepare']>[1];
function retryAfter(error:unknown){
  if(error instanceof ProviderRequestError&&'retryAfterSeconds' in error&&typeof error.retryAfterSeconds==='number'&&Number.isInteger(error.retryAfterSeconds))return Math.max(0,Math.min(86400,error.retryAfterSeconds));
  return 0;
}
/** One bounded delivery. Every resumed byte transfer probes the persisted session before sending media. */
export class YouTubePublishingProcessor{
  constructor(private readonly repository:YouTubeUploadRepository,private readonly publishing:PublishingRepository,private readonly access:Pick<YouTubeService,'accessForPublication'>,private readonly provider:YouTubePublishingProvider|null,private readonly vault:CredentialVault|null,private readonly storage:RangeStorageProvider|null,private readonly errors?:ErrorReporter,private readonly policies:()=>Policies=avatarConsentPolicies){}
  async run(tenantId:string,id:string){
    z.uuid().parse(tenantId);z.uuid().parse(id);
    const claimed=await this.repository.claim(tenantId,id);if(!claimed)return;
    const {job}=claimed,context:OperationContext={tenantId,internalId:id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:AbortSignal.timeout(120000)};
    let phase=job.status==='PREPARING'?'PREPARING':claimed.upload?.phase??'STARTING';
    const scope={tenantId,brandId:job.brandId,connectionId:id,provider:'youtube-upload'};
    try{
      if(!this.provider||!this.vault||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const prepared=await this.repository.prepare(job,this.policies()),snapshot=prepared.job.snapshot,youtube=snapshot.youtube;
      if(!youtube||!snapshot.finalKey)throw new DomainError('INVALID_INPUT');
      const grant=await this.access.accessForPublication(job.approvedBy,tenantId,job.brandId,job.connectionId,job.credentialVersion,context);
      if(grant.channelId!==prepared.connection.reference.externalId)throw new DomainError('CONFLICT',409);
      if(job.status==='PREPARING'){
        const source=await this.storage.inspectObject(snapshot.finalKey,context);
        if(source.bytes!==youtube.totalBytes||source.mimeType!=='video/mp4')throw new DomainError('INVALID_MEDIA');
        await this.repository.begin(job,source.etag,this.policies());phase='STARTING';
        const session=await this.provider.startUpload(grant.accessToken,youtube.metadata,youtube.totalBytes,context);
        await this.repository.saveSession(job,this.vault.encrypt(session,scope));phase='UPLOADING';
        await this.repository.reschedule(job);return;
      }
      const upload=prepared.upload;
      if(!upload||upload.channelId!==grant.channelId||!upload.session)throw new DomainError('CONFLICT',409);
      if(upload.phase==='UPLOADING'){
        const session=this.vault.decrypt(upload.session,scope);
        const probed=await this.provider.probeUpload(grant.accessToken,session,upload.totalBytes,upload.channelId,context);
        await this.repository.acknowledge(job,probed);
        if(probed.state==='EXPIRED')return;
        if(probed.state==='COMPLETE'){phase='PROCESSING';if(probed.video.state!=='FAILED')await this.repository.reschedule(job,{retryAfterSeconds:5});return;}
        if(probed.nextByte===upload.totalBytes){await this.repository.reschedule(job,{error:'PROVIDER_UNAVAILABLE',retryAfterSeconds:probed.retryAfterSeconds??5});return;}
        const length=Math.min(8*1024*1024,upload.totalBytes-probed.nextByte);
        const bytes=await this.storage.getRange(snapshot.finalKey,{offset:probed.nextByte,length,totalBytes:upload.totalBytes,etag:upload.sourceEtag},context);
        // Consent or the grant may have changed during the source read.
        await this.repository.prepare(job,this.policies());context.signal.throwIfAborted();
        const result=await this.provider.upload(grant.accessToken,session,{totalBytes:upload.totalBytes,offset:probed.nextByte,bytes,channelId:upload.channelId},context);
        await this.repository.acknowledge(job,result);
        if(result.state==='COMPLETE')phase='PROCESSING';
        await this.afterTransfer(job,result,probed.nextByte);return;
      }
      if(!upload.videoId||!['PROCESSING','VERIFYING'].includes(upload.phase))throw new DomainError('CONFLICT',409);
      const video=await this.provider.video(grant.accessToken,upload.videoId,upload.channelId,context);
      if(!video){await this.repository.reschedule(job,{error:'PROVIDER_UNAVAILABLE',retryAfterSeconds:10});return;}
      if(video.state==='FAILED'||video.privacy!==youtube.metadata.privacy){await this.repository.reconcile(job,'PUBLISHING_FAILED');return;}
      if(video.state==='PROCESSING'){await this.repository.reschedule(job,{retryAfterSeconds:15});return;}
      if(upload.phase==='VERIFYING'){await this.repository.complete(job,video);return;}
      const cover=youtube.coverKey?await this.storage.get(youtube.coverKey,50_000_000,context):null;
      await this.repository.processed(job,video,this.policies());phase=cover?'THUMBNAIL':'VERIFYING';
      if(cover){
        context.signal.throwIfAborted();
        const mimeType=cover[0]===137?'image/png' as const:'image/jpeg' as const;
        await this.provider.thumbnail(grant.accessToken,upload.videoId,{bytes:cover,mimeType},context);
        await this.repository.thumbnailSaved(job);phase='VERIFYING';
      }
      await this.repository.reschedule(job,{retryAfterSeconds:5});
    }catch(error){
      const code=error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';
      reportError(this.errors,error,{correlationId:job.correlationId,jobId:id,code});
      if(phase==='PREPARING'){await this.publishing.fail(job,code==='RATE_LIMITED'?'PROVIDER_UNAVAILABLE':code);return;}
      if(phase==='STARTING'&&error instanceof ProviderRequestError&&error.definitiveRejection){
        if(code==='RATE_LIMITED'||code==='PROVIDER_UNAVAILABLE')await this.repository.rejectedStart(job,code,retryAfter(error));
        else await this.publishing.fail(job,code,true);
        return;
      }
      const resumable=phase==='UPLOADING'&&['PROVIDER_UNAVAILABLE','RECONCILIATION_REQUIRED','RATE_LIMITED'].includes(code);
      const readRetry=['PROCESSING','VERIFYING'].includes(phase)&&['PROVIDER_UNAVAILABLE','RATE_LIMITED'].includes(code);
      if(resumable||readRetry)await this.repository.reschedule(job,{error:code,retryAfterSeconds:retryAfter(error)});
      else await this.repository.reconcile(job,code);
    }
  }
  private async afterTransfer(job:Parameters<YouTubeUploadRepository['reschedule']>[0],result:YouTubeUploadResult,previous:number){
    if(result.state==='EXPIRED'||(result.state==='COMPLETE'&&result.video.state==='FAILED'))return;
    if(result.state==='COMPLETE'){await this.repository.reschedule(job,{retryAfterSeconds:5});return;}
    await this.repository.reschedule(job,{...(result.nextByte<=previous?{error:'PROVIDER_UNAVAILABLE' as const}:{}),retryAfterSeconds:result.retryAfterSeconds??1});
  }
}
