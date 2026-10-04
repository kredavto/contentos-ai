import { S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { DomainError,type StorageProvider,type OperationContext } from '@contentos/types';
const settingsSchema=z.object({region:z.string().min(1),bucket:z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),accessKeyId:z.string().min(1),secretAccessKey:z.string().min(1),endpoint:z.url().optional(),forcePathStyle:z.boolean().default(false),production:z.boolean().default(true),encryption:z.enum(['AES256','aws:kms']).optional(),kmsKeyId:z.string().optional()});
export type S3Settings=z.input<typeof settingsSchema>;
export function storageFromEnvironment(env: Record<string, string | undefined>) {
  if (env.STORAGE_PROVIDER !== 's3' || !env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return new S3StorageProvider({region:env.S3_REGION,bucket:env.S3_BUCKET,accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY,endpoint:env.S3_ENDPOINT,forcePathStyle:env.S3_FORCE_PATH_STYLE==='true',production:env.NODE_ENV!=='development'&&env.NODE_ENV!=='test',encryption:env.S3_ENCRYPTION as S3Settings['encryption'],kmsKeyId:env.S3_KMS_KEY_ID});
}
const maxObjectBytes=256*1024*1024;
/** A private bucket is mandatory; no ACL is ever set to public. */
export class S3StorageProvider implements StorageProvider {
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
  async signedDownload(key:string,expiresSeconds:number,context:OperationContext){
    this.key(key,context);context.signal.throwIfAborted();
    if(!Number.isInteger(expiresSeconds)||expiresSeconds<1||expiresSeconds>900)throw new DomainError('INVALID_INPUT');
    return this.operation('sign_download',context,async()=>getSignedUrl(this.client,new GetObjectCommand({Bucket:this.settings.bucket,Key:key,ResponseCacheControl:'private, no-store'}),{expiresIn:expiresSeconds}));
  }
  async head(key:string,context:OperationContext){
    this.key(key,context);const result=await this.operation('head',context,signal=>this.client.send(new HeadObjectCommand({Bucket:this.settings.bucket,Key:key}),{abortSignal:signal}));
    return {bytes:result.ContentLength??null,mimeType:result.ContentType??null};
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
  close(){this.client.destroy();}
}
