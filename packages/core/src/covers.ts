import type {ErrorReporter} from '@contentos/types';
import {reportError} from './error-reporting';
import {z} from 'zod';
import {CoverRepository} from '@contentos/db';
import {DomainError,coverRequestSchema,coverSelectionSchema,coverDesignSchema,type StorageProvider,type CoverRenderingProvider,type OperationContext} from '@contentos/types';
import {avatarConsentPolicies} from './avatars';
const uuid=z.uuid();
export class CoverService{
  constructor(private readonly repository:CoverRepository,private readonly storage:StorageProvider|null){}
  overview(userId:string,tenantId:string,brandId:string,id:string){return this.repository.overview(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),avatarConsentPolicies());}
  request(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){if(!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repository.request(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),coverRequestSchema.parse(raw),avatarConsentPolicies(),correlationId);}
  select(userId:string,tenantId:string,brandId:string,id:string,raw:unknown,correlationId:string){return this.repository.select(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),coverSelectionSchema.parse(raw),avatarConsentPolicies(),correlationId);}
  async download(userId:string,tenantId:string,brandId:string,id:string,version:string,correlationId:string){
    const key=await this.repository.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),z.coerce.number().int().min(0).max(50).parse(version),avatarConsentPolicies());
    if(!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {url:await this.storage.signedDownload(key,120,{tenantId,internalId:id,idempotencyKey:id,correlationId,signal:AbortSignal.timeout(15000)}),expiresIn:120};
  }
}
export class CoverProcessor{
  constructor(private readonly repository:CoverRepository,private readonly storage:StorageProvider|null,private readonly renderer:CoverRenderingProvider|null,private readonly errors?:ErrorReporter){}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id);if(!job)return;
    const context:OperationContext={tenantId,internalId:id,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:AbortSignal.timeout(240_000)};
    try{
      if(!this.storage||!this.renderer)throw new DomainError('CONFIGURATION_REQUIRED',503);
      const project=await this.repository.prepare(job,avatarConsentPolicies());
      const bytes=await this.storage.get(project.finalKey,256*1024*1024,context);
      const output=await this.renderer.renderCover({bytes,design:coverDesignSchema.parse(job.design)},context);
      if(!output.bytes.byteLength||output.bytes.byteLength>3*1024*1024)throw new DomainError('INVALID_MEDIA',422);
      await this.repository.prepare(job,avatarConsentPolicies());context.signal.throwIfAborted();
      await this.storage.put(job.storageKey,output.bytes,'image/jpeg',context);
      await this.repository.complete(job,avatarConsentPolicies());
    }catch(error){reportError(this.errors,error,{correlationId:job.correlationId,jobId:id});const code=error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';try{await this.repository.fail(job,code);}catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}}
  }
}
