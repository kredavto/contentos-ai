import {createHash} from 'node:crypto';
import {z} from 'zod';
import {LibraryMediaRepository,libraryOutputKey,libraryChunkKey,type StoredLibraryMedia} from '@contentos/db';
import {DomainError,libraryUploadSchema,libraryResumeSchema,preparedMediaSchema,maxMediaSourceBytes,maxBrowserMediaBytes,mediaChunkIndexSchema,type DirectUploadProvider,type MediaPreparationProvider,type StorageProvider,type OperationContext,type ErrorReporter} from '@contentos/types';
import {reportError} from './error-reporting';

const uuid=z.uuid();
function context(row:StoredLibraryMedia,timeout=60_000):OperationContext{return {tenantId:row.tenantId,internalId:row.id,idempotencyKey:row.idempotencyKey,correlationId:row.correlationId,signal:AbortSignal.timeout(timeout)};}
export class LibraryMediaService{
  constructor(private readonly repository:LibraryMediaRepository,private readonly storage:(StorageProvider&DirectUploadProvider)|null,private readonly enabled=false,private readonly provider='s3'){}
  async overview(userId:string,tenantId:string,brandId:string){
    return {assets:await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:this.enabled&&!!this.storage,code:this.enabled&&this.storage?null:'CONFIGURATION_REQUIRED'}};
  }
  async begin(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    await this.repository.authorize(userId,uuid.parse(tenantId),uuid.parse(brandId));
    if(!this.enabled||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const input=libraryUploadSchema.parse(raw);
    if(input.chunkHashes)throw new DomainError('INVALID_INPUT');
    const row=await this.repository.begin(userId,tenantId,brandId,input,this.provider,correlationId);
    if(row.status!=='UPLOADING')return {id:row.id,status:row.status,upload:null};
    // Allow signing latency without moving the persisted cleanup deadline.
    const expiresSeconds=Math.min(300,Math.floor((row.uploadExpiresAt.getTime()-Date.now())/1000)-5);
    if(expiresSeconds<1)throw new DomainError('CONFLICT',409);
    const upload=await this.storage.signedUpload({key:row.sourceKey,mimeType:row.sourceMime,bytes:row.sourceBytes,expiresSeconds},context(row));
    if(Date.now()+expiresSeconds*1000>row.uploadExpiresAt.getTime())throw new DomainError('PROVIDER_UNAVAILABLE',503);
    return {id:row.id,status:row.status,upload};
  }
  async confirm(userId:string,tenantId:string,brandId:string,id:string){
    await this.repository.authorize(userId,uuid.parse(tenantId),uuid.parse(brandId));
    if(!this.enabled||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.confirm(userId,tenantId,brandId,uuid.parse(id));
  }
  async beginBrowserUpload(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    await this.repository.authorize(userId,uuid.parse(tenantId),uuid.parse(brandId));
    if(!this.enabled||!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const input=libraryUploadSchema.parse(raw);
    if(input.source.bytes>maxBrowserMediaBytes&&!input.chunkHashes)throw new DomainError('INVALID_MEDIA',413);
    const row=await this.repository.begin(userId,tenantId,brandId,input,this.provider,correlationId);
    if(row.status==='UPLOADING'&&row.uploadExpiresAt.getTime()<=Date.now())throw new DomainError('CONFLICT',409);
    return {id:row.id,status:row.status,uploadedChunks:row.uploadedChunks,expiresAt:row.uploadExpiresAt.toISOString()};
  }
  async authorizeSource(userId:string,tenantId:string,brandId:string,id:string){
    const row=await this.repository.uploadSource(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(!this.enabled||!this.storage||row.provider!==this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    if(row.chunkHashes.length)throw new DomainError('CONFLICT',409);
    if(row.sourceBytes>maxBrowserMediaBytes)throw new DomainError('INVALID_MEDIA',413);
  }
  async resumeUpload(userId:string,tenantId:string,brandId:string,id:string){
    const row=await this.repository.uploadSource(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(!this.enabled||!this.storage||row.provider!==this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    if(row.status!=='UPLOADING'||(row.sourceBytes>maxBrowserMediaBytes&&!row.chunkHashes.length))throw new DomainError('CONFLICT',409);
    return libraryResumeSchema.parse({id:row.id,input:{name:row.name,source:{mimeType:row.sourceMime,bytes:row.sourceBytes,sha256:row.sourceSha256},idempotencyKey:row.idempotencyKey,...(row.chunkHashes.length?{chunkHashes:row.chunkHashes}:{})},expiresAt:row.uploadExpiresAt.toISOString(),uploadedChunks:row.uploadedChunks});
  }
  async uploadSource(userId:string,tenantId:string,brandId:string,id:string,bytes:Uint8Array,mimeType:string){
    const row=await this.repository.uploadSource(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(!this.enabled||!this.storage||row.provider!==this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    if(row.chunkHashes.length)throw new DomainError('CONFLICT',409);
    if(bytes.byteLength>maxBrowserMediaBytes)throw new DomainError('INVALID_MEDIA',413);
    if(bytes.byteLength!==row.sourceBytes||mimeType!==row.sourceMime||createHash('sha256').update(bytes).digest('hex')!==row.sourceSha256)throw new DomainError('INVALID_MEDIA',422);
    // Identical replays never rewrite a source already handed to the worker.
    if(row.status!=='UPLOADING')return {id:row.id,status:row.status};
    const operation=context(row,Math.max(1,Math.min(60_000,row.uploadExpiresAt.getTime()-Date.now())));
    operation.signal.throwIfAborted();
    await this.storage.put(row.sourceKey,bytes,row.sourceMime,operation);
    // Recheck deletion, expiry and current permissions after the storage write.
    return this.repository.confirm(userId,tenantId,brandId,id);
  }
  private async chunkSource(userId:string,tenantId:string,brandId:string,id:string,index:number){
    mediaChunkIndexSchema.parse(index);
    const row=await this.repository.uploadSource(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(!this.enabled||!this.storage||row.provider!==this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    if(!row.chunkHashes[index])throw new DomainError('INVALID_INPUT');
    return row;
  }
  async authorizeChunk(userId:string,tenantId:string,brandId:string,id:string,index:number){await this.chunkSource(userId,tenantId,brandId,id,index);}
  async uploadChunk(userId:string,tenantId:string,brandId:string,id:string,index:number,bytes:Uint8Array,mimeType:string){
    const row=await this.chunkSource(userId,tenantId,brandId,id,index);
    const expectedBytes=Math.min(maxBrowserMediaBytes,row.sourceBytes-index*maxBrowserMediaBytes);
    if(bytes.byteLength!==expectedBytes||mimeType!==row.sourceMime||createHash('sha256').update(bytes).digest('hex')!==row.chunkHashes[index])throw new DomainError('INVALID_MEDIA',422);
    if(row.status!=='UPLOADING'||row.uploadedChunks.includes(index))return {id,status:row.status};
    const operation=context(row,Math.max(1,Math.min(60_000,row.uploadExpiresAt.getTime()-Date.now())));
    operation.signal.throwIfAborted();
    // Immutable per-part hashes make concurrent retries safe even after an uncertain PUT.
    await this.storage!.put(libraryChunkKey(row,index),bytes,row.sourceMime,operation);
    return this.repository.recordChunk(userId,tenantId,brandId,id,index);
  }
  async download(userId:string,tenantId:string,brandId:string,id:string){
    const row=await this.repository.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if(!this.storage||row.provider!==this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {url:await this.storage.signedDownload(row.storageKey!,60,context(row)),expiresInSeconds:60};
  }
  delete(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){return this.repository.requestDeletion(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),correlationId);}
}

export class LibraryMediaProcessor{
  constructor(private readonly repository:LibraryMediaRepository,private readonly storage:StorageProvider|null,private readonly preparer:MediaPreparationProvider|null,private readonly enabled=false,private readonly provider='s3',private readonly errors?:ErrorReporter){}
  async run(tenantId:string,id:string){
    const job=await this.repository.claim(tenantId,id,this.provider);if(!job)return;
    const operation=context(job,240_000);
    try{
      await this.repository.prepare(job);
      if(!this.enabled||!this.storage||!this.preparer)throw new DomainError('CONFIGURATION_REQUIRED',503);
      let bytes:Uint8Array;
      if(job.chunkHashes.length){
        bytes=new Uint8Array(job.sourceBytes);
        for(let index=0;index<job.chunkHashes.length;index++){
          const length=Math.min(maxBrowserMediaBytes,job.sourceBytes-index*maxBrowserMediaBytes);
          const chunk=await this.storage.get(libraryChunkKey(job,index),length,operation);
          if(chunk.byteLength!==length||createHash('sha256').update(chunk).digest('hex')!==job.chunkHashes[index])throw new DomainError('INVALID_MEDIA',422);
          bytes.set(chunk,index*maxBrowserMediaBytes);
        }
      }else bytes=await this.storage.get(job.sourceKey,job.sourceBytes,operation);
      if(bytes.byteLength!==job.sourceBytes||createHash('sha256').update(bytes).digest('hex')!==job.sourceSha256)throw new DomainError('INVALID_MEDIA',422);
      const output=await this.preparer.prepare({bytes,mimeType:job.sourceMime},operation);
      const parsed=preparedMediaSchema.safeParse({mimeType:output.mimeType,bytes:output.bytes.byteLength,durationMs:output.durationMs,width:output.width,height:output.height,hasAudio:output.hasAudio});
      if(!parsed.success||output.bytes.byteLength>maxMediaSourceBytes||(job.sourceMime==='video/mp4')!==(output.mimeType==='video/mp4'))throw new DomainError('INVALID_MEDIA',422);
      await this.repository.prepare(job);operation.signal.throwIfAborted();
      // Attempt-specific keys prevent an expired worker from overwriting a newer result.
      await this.storage.put(libraryOutputKey(job),output.bytes,output.mimeType,operation);
      await this.repository.complete(job,parsed.data);
    }catch(error){
      reportError(this.errors,error,{correlationId:job.correlationId,jobId:id});
      const code=error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';
      try{await this.repository.fail(job,code);}catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}
    }
  }
  async cleanupOne(){
    if(!this.storage)return false;
    const job=await this.repository.claimCleanup(this.provider);if(!job)return false;
    const operation=context(job);let succeeded=false;
    try{
      await this.storage.delete(job.sourceKey,operation);
      for(let start=0;start<job.chunkHashes.length;start+=4){
        const results=await Promise.allSettled(job.chunkHashes.slice(start,start+4).map((_,offset)=>this.storage!.delete(libraryChunkKey(job,start+offset),operation)));
        for(const result of results)if(result.status==='rejected')throw result.reason;
      }
      for(let attempt=1;attempt<=3;attempt++){
        const key=libraryOutputKey(job,attempt);
        if(job.status==='READY'&&key===job.storageKey)continue;
        await this.storage.delete(key,operation);
      }
      succeeded=true;
    }catch(error){reportError(this.errors,error,{correlationId:job.correlationId,jobId:job.id});}
    try{await this.repository.finishCleanup(job,succeeded);}catch(error){if(!(error instanceof DomainError&&error.code==='CONFLICT'))throw error;}
    return true;
  }
}
