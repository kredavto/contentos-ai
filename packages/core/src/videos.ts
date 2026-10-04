import {z} from 'zod';
import {VideoRepository,JobRepository,AICallRepository,type Database} from '@contentos/db';
import {DomainError,ProviderRequestError,videoRequestSchema,videoDimensions,type VideoProvider,type VideoProcessingProvider,type StorageProvider,type OperationContext} from '@contentos/types';
import {avatarConsentPolicies} from './avatars';
export type VideoConnection={provider:VideoProvider;name:string}|null;
const uuid=z.uuid();
export class VideoService {
  constructor(private readonly repository:VideoRepository,private readonly connection:VideoConnection,private readonly storage:StorageProvider|null,private readonly enabled:boolean){}
  async overview(userId:string,tenantId:string,brandId:string){return {projects:await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:this.enabled&&!!this.connection&&!!this.storage,provider:this.connection?.name??'disabled'}};}
  create(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){
    if(!this.enabled||!this.connection||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.enqueue(userId,uuid.parse(tenantId),uuid.parse(brandId),videoRequestSchema.parse(input),avatarConsentPolicies(),this.connection.name,correlationId);
  }
  async download(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){
    const project=await this.repository.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),avatarConsentPolicies());
    if(!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const context:OperationContext={tenantId,internalId:project.id,idempotencyKey:project.id,correlationId,signal:AbortSignal.timeout(15_000)};
    const [videoUrl,coverUrl]=await Promise.all([this.storage.signedDownload(project.finalKey,120,context),this.storage.signedDownload(project.coverKey,120,context)]);
    return {videoUrl,coverUrl,expiresIn:120};
  }
  async approve(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){await this.repository.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),avatarConsentPolicies(),true,correlationId);return {approved:true};}
  history(userId:string,tenantId:string,brandId:string,id:string){return this.repository.history(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));}
}
export class VideoProcessor {
  private readonly repository:VideoRepository;
  private readonly jobs:JobRepository;
  constructor(private readonly db:Database,private readonly connection:VideoConnection,private readonly storage:StorageProvider|null,private readonly processing:VideoProcessingProvider|null,private readonly enabled:boolean){this.repository=new VideoRepository(db);this.jobs=new JobRepository(db);}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job?.leaseToken)return;
    const abort=new AbortController(),context:OperationContext={tenantId,internalId:id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:abort.signal};
    const heartbeat=setInterval(()=>{void this.jobs.heartbeat(tenantId,id,job.leaseToken!).then(owned=>{if(!owned)abort.abort();}).catch(()=>abort.abort());},30_000);
    const calls=new AICallRepository(this.db,job);let polling=false;
    try{
      if(!this.connection||this.connection.name!==job.provider||!this.storage||!this.processing)throw new DomainError('CONFIGURATION_REQUIRED',503);
      let project=await this.repository.prepare(job,avatarConsentPolicies());
      if(!project.reference){
        if(!this.enabled)throw new DomainError('CONFIGURATION_REQUIRED',503);
        await calls.started(1,job.provider,'avatar-video');
        project=await this.repository.prepare(job,avatarConsentPolicies(),true);abort.signal.throwIfAborted();
        const start=Date.now();let reference;
        try{reference=await this.connection.provider.submit({script:project.scriptText,avatar:project.avatarReference,voice:project.voiceReference,...videoDimensions(project.options.orientation,project.options.resolution)},context);}
        catch(error){await calls.failed(1,error instanceof ProviderRequestError&&error.definitiveRejection?error.code:'PROVIDER_UNAVAILABLE',Date.now()-start);throw error;}
        await this.repository.submitted(job,reference);
        await calls.succeeded(1,{json:reference,usage:{model:'avatar-video',inputUnits:project.scriptText.length,outputUnits:1,costMicrounits:null,currency:'USD'}},Date.now()-start);
        await this.repository.wait(job);return;
      }
      polling=true;
      const result=await this.connection.provider.status(project.reference,context);
      polling=false;
      if(result.status==='FAILED'){await this.repository.fail(job,'PROVIDER_REJECTED');return;}
      if(result.status==='PROCESSING'){await this.repository.wait(job);return;}
      if(!result.downloadUrl)throw new DomainError('RECONCILIATION_REQUIRED',409);
      await this.repository.prepare(job,avatarConsentPolicies());
      const original=await this.connection.provider.download(result.downloadUrl,context);
      await this.repository.stage(job,'POST_PROCESSING');
      await this.storage.put(project.originalKey,original,'video/mp4',context);
      const final=await this.processing.process({bytes:original,options:project.options,onStage:async(stage,details)=>{await this.repository.prepare(job,avatarConsentPolicies());await this.repository.stage(job,stage,details);}},context);
      await this.repository.prepare(job,avatarConsentPolicies());
      await this.storage.put(project.finalKey,final.bytes,'video/mp4',context);
      await this.storage.put(project.coverKey,final.thumbnail,'image/jpeg',context);
      await this.repository.complete(job,avatarConsentPolicies(),final.durationSeconds,final.bytes.byteLength);
    }catch(error){
      const code=polling&&error instanceof DomainError&&error.code==='PROVIDER_REJECTED'?'RECONCILIATION_REQUIRED':error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';
      try{await this.repository.fail(job,code,error instanceof ProviderRequestError&&error.definitiveRejection);}
      catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}
      console.log(JSON.stringify({event:'video_job_error',jobId:id,correlationId:job.correlationId,code}));
    }finally{clearInterval(heartbeat);}
  }
}
