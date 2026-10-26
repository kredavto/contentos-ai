import { S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadObjectCommand,HeadBucketCommand } from '@aws-sdk/client-s3';
import {createPresignedPost} from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { DomainError,maxMediaSourceBytes,mediaSourceMimeSchema,type DirectUploadProvider,type RangeStorageProvider,type OperationContext } from '@contentos/types';
const settingsSchema=z.object({region:z.string().min(1),bucket:z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),accessKeyId:z.string().min(1),secretAccessKey:z.string().min(1),endpoint:z.url().optional(),forcePathStyle:z.boolean().default(false),production:z.boolean().default(true),encryption:z.enum(['AES256','aws:kms']).optional(),kmsKeyId:z.string().optional()});
export type S3Settings=z.input<typeof settingsSchema>;
export function storageFromEnvironment(env: Record<string, string | undefined>) {
  if (env.STORAGE_PROVIDER !== 's3' || !env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return new S3StorageProvider({region:env.S3_REGION,bucket:env.S3_BUCKET,accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY,endpoint:env.S3_ENDPOINT,forcePathStyle:env.S3_FORCE_PATH_STYLE==='true',production:env.NODE_ENV!=='development'&&env.NODE_ENV!=='test',encryption:env.S3_ENCRYPTION as S3Settings['encryption'],kmsKeyId:env.S3_KMS_KEY_ID});
}
const maxObjectBytes=256*1024*1024;
/** A private bucket is mandatory; no ACL is ever set to public. */
export class S3StorageProvider implements RangeStorageProvider,DirectUploadProvider {
  private readonly client:S3Client;
  private readonly settings:z.output<typeof settingsSchema>;
  constructor(settings:S3Settings){
    this.settings=settingsSchema.parse(settings);
    if(settings.endpoint){const url=new URL(settings.endpoint);if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new DomainError('CONFIGURATION_REQUIRED',503);if(url.protocol!=='https:'&&(this.settings.production||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new DomainError('CONFIGURATION_REQUIRED',503);}
    if(this.settings.encryption==='aws:kms'&&!this.settings.kmsKeyId)throw new DomainError('CONFIGURATION_REQUIRED',503);
    this.client=new S3Client({region:this.settings.region,...(this.settings.endpoint?{endpoint:this.settings.endpoint}:{}),forcePathStyle:this.settings.forcePathStyle,credentials:{accessKeyId:this.settings.accessKeyId,secretAccessKey:this.settings.secretAccessKey},maxAttempts:1});
  }
  private key(key:string,context:OperationContext){
    if(!z.uuid().safeParse(context.tenantId).success||!key.startsWith(`${context.tenantId}/`)||key.length>512||!/^[A-Za-z0-9/_.-]+$/.test(key)||key.split('/').some(part=>!part||part==='.'||part==='..'))throw new DomainError('NOT_AUTHORIZED',403);
    return key;
  }
  private async operation<T>(name:string,context:OperationContext,action:(signal:AbortSignal)=>Promise<T>){
    const start=Date.now();let status='SUCCEEDED';
    try{return await action(AbortSignal.any([context.signal,AbortSignal.timeout(60_000)]));}
    catch(error){status='FAILED';if(error instanceof DomainError)throw error;throw new DomainError('PROVIDER_UNAVAILABLE',503);}
    finally{console.log(JSON.stringify({event:'provider_request',provider:'s3',operation:name,requestId:context.correlationId,jobId:context.internalId,durationMs:Date.now()-start,status}));}
  }
  async put(key:string,bytes:Uint8Array,mimeType:string,context:OperationContext){
    this.key(key,context);
    if(!bytes.byteLength||bytes.byteLength>maxObjectBytes||!['image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/wav','text/vtt','application/x-subrip'].includes(mimeType))throw new DomainError('INVALID_MEDIA');
    await this.operation('put',context,signal=>this.client.send(new PutObjectCommand({Bucket:this.settings.bucket,Key:key,Body:bytes,ContentType:mimeType,ContentLength:bytes.byteLength,CacheControl:'private, no-store',...(this.settings.encryption?{ServerSideEncryption:this.settings.encryption}:{}),...(this.settings.kmsKeyId?{SSEKMSKeyId:this.settings.kmsKeyId}:{})}),{abortSignal:signal}));
  }
  async signedUpload(input:Parameters<DirectUploadProvider['signedUpload']>[0],context:OperationContext){
    this.key(input.key,context);context.signal.throwIfAborted();
    // Client uploads may only target quarantined source objects, never ready media.
    if(input.key!==`${context.tenantId}/uploads/${context.internalId}/source`||!z.uuid().safeParse(context.internalId).success)throw new DomainError('NOT_AUTHORIZED',403);
    if(!mediaSourceMimeSchema.safeParse(input.mimeType).success||!Number.isSafeInteger(input.bytes)||input.bytes<12||input.bytes>maxMediaSourceBytes||!Number.isInteger(input.expiresSeconds)||input.expiresSeconds<1||input.expiresSeconds>300)throw new DomainError('INVALID_INPUT');
    const fields:Record<string,string>={'Content-Type':input.mimeType,'Cache-Control':'private, no-store',success_action_status:'204',...(this.settings.encryption?{'x-amz-server-side-encryption':this.settings.encryption}:{}),...(this.settings.kmsKeyId?{'x-amz-server-side-encryption-aws-kms-key-id':this.settings.kmsKeyId}:{})};
    return this.operation('sign_upload',context,async()=>{
      const result=await createPresignedPost(this.client,{Bucket:this.settings.bucket,Key:input.key,Expires:input.expiresSeconds,Fields:fields,Conditions:[['content-length-range',input.bytes,input.bytes],...Object.entries(fields).map(([key,value])=>({[key]:value}))]});
      context.signal.throwIfAborted();return {...result,expiresInSeconds:input.expiresSeconds};
    });
  }
  async signedDownload(key:string,expiresSeconds:number,context:OperationContext){
    this.key(key,context);context.signal.throwIfAborted();
    if(!Number.isInteger(expiresSeconds)||expiresSeconds<1||expiresSeconds>900)throw new DomainError('INVALID_INPUT');
    return this.operation('sign_download',context,async()=>getSignedUrl(this.client,new GetObjectCommand({Bucket:this.settings.bucket,Key:key,ResponseCacheControl:'private, no-store'}),{expiresIn:expiresSeconds}));
  }
  async head(key:string,context:OperationContext){
    this.key(key,context);const result=await this.operation('head',context,signal=>this.client.send(new HeadObjectCommand({Bucket:this.settings.bucket,Key:key}),{abortSignal:signal}));
    return {bytes:result.ContentLength??null,mimeType:result.ContentType??null};
  }
  async inspectObject(key:string,context:OperationContext){
    this.key(key,context);
    return this.operation('inspect_object',context,async signal=>{
      const result=await this.client.send(new HeadObjectCommand({Bucket:this.settings.bucket,Key:key}),{abortSignal:signal});
      if(!Number.isSafeInteger(result.ContentLength)||!result.ContentLength||result.ContentLength<1||result.ContentLength>maxObjectBytes||!validEtag(result.ETag))throw new DomainError('INVALID_MEDIA');
      return {bytes:result.ContentLength,etag:result.ETag!,mimeType:result.ContentType??null};
    });
  }
  async getRange(key:string,input:Parameters<RangeStorageProvider['getRange']>[1],context:OperationContext){
    this.key(key,context);
    const {offset,length,totalBytes,etag}=input;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>8*1024*1024||!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>maxObjectBytes||offset+length>totalBytes||!validEtag(etag))throw new DomainError('INVALID_INPUT');
    return this.operation('get_range',context,async signal=>{
      const result=await this.client.send(new GetObjectCommand({Bucket:this.settings.bucket,Key:key,Range:`bytes=${offset}-${offset+length-1}`,IfMatch:etag}),{abortSignal:signal});
      if(!result.Body)throw new DomainError('INVALID_MEDIA');
      const reader=result.Body.transformToWebStream().getReader(),chunks:Uint8Array[]=[];let size=0;
      try{
        if(result.$metadata.httpStatusCode!==206||result.ContentLength!==length||result.ContentRange!==`bytes ${offset}-${offset+length-1}/${totalBytes}`||result.ETag!==etag)throw new DomainError('INVALID_MEDIA');
        for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>length)throw new DomainError('INVALID_MEDIA');chunks.push(chunk.value);}
        if(size!==length)throw new DomainError('INVALID_MEDIA');
        return new Uint8Array(Buffer.concat(chunks,size));
      }finally{await reader.cancel();}
    });
  }
  async get(key:string,maxBytes:number,context:OperationContext){
    this.key(key,context);if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>maxObjectBytes)throw new DomainError('INVALID_INPUT');
    return this.operation('get',context,async signal=>{
      const result=await this.client.send(new GetObjectCommand({Bucket:this.settings.bucket,Key:key}),{abortSignal:signal});
      if(!result.Body)throw new DomainError('INVALID_MEDIA');
      const stream=result.Body.transformToWebStream();const reader=stream.getReader();const chunks:Uint8Array[]=[];let size=0;
      try{if(result.ContentLength&&result.ContentLength>maxBytes)throw new DomainError('INVALID_MEDIA');for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw new DomainError('INVALID_MEDIA');chunks.push(chunk.value);}return new Uint8Array(Buffer.concat(chunks));}
      finally{await reader.cancel();}
    });
  }
  async delete(key:string,context:OperationContext){this.key(key,context);await this.operation('delete',context,signal=>this.client.send(new DeleteObjectCommand({Bucket:this.settings.bucket,Key:key}),{abortSignal:signal}));}
  async ready(signal:AbortSignal){
    signal.throwIfAborted();
    await this.client.send(new HeadBucketCommand({Bucket:this.settings.bucket}),{abortSignal:AbortSignal.any([signal,AbortSignal.timeout(1200)])});
  }
  close(){this.client.destroy();}
}

function validEtag(value:string|undefined):boolean{return typeof value==='string'&&/^"[A-Za-z0-9_-]{1,128}"$/.test(value);}
