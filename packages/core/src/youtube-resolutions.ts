import {z} from 'zod';
import {reportError} from './error-reporting';
import {YouTubeResolutionRepository,type YouTubeResolutionExecution} from '@contentos/db';
import {DomainError,youtubeResolutionSchema,type YouTubePublishingProvider,type ErrorReporter} from '@contentos/types';
import type {YouTubeService} from './youtube';
import {avatarConsentPolicies} from './avatars';
/** Read-only provider reconciliation; never initiates/resumes uploads or changes visibility. */
export class YouTubeResolutionService{
  constructor(private readonly repository:YouTubeResolutionRepository,private readonly access:Pick<YouTubeService,'accessForPublication'>,private readonly provider:Pick<YouTubePublishingProvider,'video'>|null,private readonly enabled:boolean,private readonly policies:()=>Parameters<YouTubeResolutionRepository['prepare']>[2]=avatarConsentPolicies){}
  async resolve(actorId:string,raw:unknown,correlationId:string,execution?:YouTubeResolutionExecution){
    if(!this.enabled||!this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const input=youtubeResolutionSchema.parse(raw),prepared=await this.repository.prepare(actorId,input,this.policies(),correlationId,execution);
    if(prepared.completed)return prepared.completed;
    const target=prepared.target!,context={tenantId:input.tenantId,internalId:input.jobId,idempotencyKey:input.idempotencyKey,correlationId,signal:AbortSignal.timeout(45000)};
    const access=await this.access.accessForPublication(target.approvedBy,input.tenantId,target.brandId,target.connectionId,target.credentialVersion,context);
    if(access.channelId!==target.channelId)throw new DomainError('NOT_AUTHORIZED',403);
    // Refresh and provider reads happen outside the transaction; all authority is checked again at commit.
    const video=await this.provider.video(access.accessToken,target.videoId,target.channelId,context);
    context.signal.throwIfAborted();if(!video)throw new DomainError('RECONCILIATION_REQUIRED',409);
    // Use the database clock sampled before the remote read, conservatively bounding the whole observation.
    return this.repository.complete(actorId,input,video,target.verificationStartedAt,this.policies(),correlationId,execution);
  }
}

export class YouTubeResolutionQueueService{
  constructor(private readonly repository:YouTubeResolutionRepository,private readonly enabled:boolean,private readonly configured:boolean){}
  request(actorId:string,raw:unknown,correlationId:string){
    if(!this.enabled||!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.enqueue(actorId,youtubeResolutionSchema.parse(raw),avatarConsentPolicies(),correlationId);
  }
  tasks(actorId:string,tenantId:string,jobId:string,correlationId:string){
    if(!this.enabled)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.tasks(actorId,z.uuid().parse(tenantId),z.uuid().parse(jobId),correlationId);
  }
}
export class YouTubeResolutionProcessor{
  constructor(private readonly repository:YouTubeResolutionRepository,private readonly resolver:YouTubeResolutionService,private readonly errors?:ErrorReporter){}
  async run(tenantId:string,id:string){
    const task=await this.repository.claimTask(tenantId,id);if(!task)return;
    try{
      const result=await this.resolver.resolve(task.actorId,task.input,task.correlationId,{id:task.id,leaseToken:task.leaseToken!});
      await this.repository.acknowledgeTask(task,result.id);
    }catch(error){reportError(this.errors,error,{correlationId:task.correlationId,jobId:id});await this.repository.failTask(task,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE');}
  }
}
