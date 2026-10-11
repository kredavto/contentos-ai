import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ImageRepository} from '@contentos/db';
import {DomainError,ProviderRequestError,imageRequestSchema,imageGenerationSchema,type ImageProvider,type StorageProvider,type OperationContext,type ErrorReporter} from '@contentos/types';
import {normalizeGeneratedImage} from './photo';
import {reportError} from './error-reporting';
const uuid=z.uuid();
const usageSchema=z.object({model:z.string().min(1).max(100),inputUnits:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),outputUnits:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),costMicrounits:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),currency:z.string().regex(/^[A-Z]{3}$/)}).strict();
export class ImageService{
  constructor(private readonly repo:ImageRepository,private readonly provider:ImageProvider|null,private readonly storage:StorageProvider|null){}
  async overview(userId:string,tenantId:string,brandId:string){return {...await this.repo.overview(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:!!this.provider&&!!this.storage,provider:this.provider?.name??'disabled',model:this.provider?.model??null}};}
  request(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){if(!this.provider||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repo.request(userId,uuid.parse(tenantId),uuid.parse(brandId),imageRequestSchema.parse(raw),this.provider.name,this.provider.model,this.provider.currency,correlationId);}
  approve(userId:string,tenantId:string,brandId:string,id:string,correlationId?:string){return this.repo.approve(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),correlationId);}
  delete(userId:string,tenantId:string,brandId:string,id:string,correlationId?:string){return this.repo.delete(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),correlationId);}
  async download(userId:string,tenantId:string,brandId:string,id:string,approved:boolean,correlationId:string){
    const row=await this.repo.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),approved);if(!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {url:await this.storage.signedDownload(row.storageKey,60,{internalId:id,tenantId,idempotencyKey:id,correlationId,signal:AbortSignal.timeout(15_000)}),expiresInSeconds:60};
  }
}
export class ImageProcessor{
  constructor(private readonly repo:ImageRepository,private readonly provider:ImageProvider|null,private readonly storage:StorageProvider|null,private readonly errors?:ErrorReporter){}
  async run(tenantId:string,id:string){
    const job=await this.repo.claim(tenantId,id);if(!job)return;
    const context:OperationContext={internalId:id,tenantId,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:AbortSignal.timeout(240_000)};
    try{
      if(!this.provider||!this.storage||this.provider.name!==job.provider||this.provider.model!==job.model||this.provider.currency!==job.currency)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const input=imageGenerationSchema.parse(job.input);await this.repo.verify(job);context.signal.throwIfAborted();
      await this.repo.submit(job);
      const result=await this.provider.generate(input,context),usage=usageSchema.parse(result.usage);
      if(usage.model!==job.model||usage.currency!==job.currency||result.reference&&(result.reference.provider!==job.provider||result.reference.internalId!==id||!z.string().min(1).max(200).safeParse(result.reference.externalId).success))throw new DomainError('PROVIDER_REJECTED',502);
      const reference=result.reference?{provider:job.provider,internalId:id,externalId:result.reference.externalId,metadata:{kind:'request',demo:job.provider==='mock-image'}}:null;
      await this.repo.metering(job,usage,reference);
      const output=await normalizeGeneratedImage(result.bytes,result.mimeType,input);
      await this.repo.verify(job);context.signal.throwIfAborted();
      await this.storage.put(job.storageKey,output.bytes,output.mimeType,context);
      await this.repo.complete(job,{bytes:output.bytes.byteLength,sha256:createHash('sha256').update(output.bytes).digest('hex')});
    }catch(error){
      reportError(this.errors,error,{correlationId:job.correlationId,jobId:id});
      try{await this.repo.fail(job,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE',error instanceof ProviderRequestError&&error.definitiveRejection);}catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}
    }
  }
  async cleanupOne(){
    if(!this.storage)return false;const job=await this.repo.claimCleanup();if(!job)return false;
    let success=false;try{await this.storage.delete(job.storageKey,{internalId:job.id,tenantId:job.tenantId,idempotencyKey:job.id,correlationId:job.correlationId,signal:AbortSignal.timeout(30_000)});success=true;}catch(error){reportError(this.errors,error,{correlationId:job.correlationId,jobId:job.id});}
    await this.repo.cleanupFinished(job,success);return true;
  }
}
