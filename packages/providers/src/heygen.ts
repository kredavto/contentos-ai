import { z } from 'zod';
import { DomainError, type AvatarProvider, type VideoProvider, type OperationContext, type ProviderReference } from '@contentos/types';
const externalId = z.string().min(1).max(255);
const httpsUrl = z.url().refine(value=>new URL(value).protocol === 'https:');
const lookSchema = z.object({id:externalId,name:z.string(),group_id:externalId,status:z.enum(['processing','completed','failed']),preview_image_url:httpsUrl.nullish()});
const pageSchema = <T extends z.ZodType>(item:T)=>z.object({data:z.array(item),has_more:z.boolean(),next_token:z.string().nullish()});
const voiceSchema = z.object({voice_id:externalId,name:z.string(),language:z.string().nullish(),type:z.enum(['public','private']),preview_audio_url:httpsUrl.nullish()});
function reference(context:OperationContext,id:string,metadata:Record<string,unknown>={}):ProviderReference{return {provider:'heygen',externalId:id,internalId:context.internalId,metadata};}
function checkReference(value:ProviderReference){if(value.provider!=='heygen')throw new DomainError('INVALID_INPUT');return encodeURIComponent(externalId.parse(value.externalId));}
/** Official v3 transport. No implicit mutation retries; durable jobs own replay. */
export class HeyGenClient {
  constructor(private readonly apiKey:string,private readonly transport:typeof fetch=fetch) {if(!apiKey)throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async request<T>(path:string,method:'GET'|'POST'|'DELETE',schema:z.ZodType<T>,context:OperationContext,body?:unknown):Promise<T> {
    if(!path.startsWith('/v3/')||path.includes('://'))throw new DomainError('INVALID_INPUT');
    const start=Date.now();let status=0;
    try{
      const response=await this.transport(`https://api.heygen.com${path}`,{method,redirect:'error',signal:AbortSignal.any([context.signal,AbortSignal.timeout(30_000)]),headers:{'X-Api-Key':this.apiKey,...(body?{'Content-Type':'application/json'}:{}),...(method==='POST'?{'Idempotency-Key':context.idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
      status=response.status;
      if(method==='DELETE'&&status===404)return schema.parse(null);
      if(status===401||status===403)throw new DomainError('CONFIGURATION_REQUIRED',503);
      if(status===429||status===408||status===409||status>=500)throw new DomainError('PROVIDER_UNAVAILABLE',503);
      if(!response.ok)throw new DomainError('PROVIDER_REJECTED',502);
      if(status===204)return schema.parse(null);
      const reader=response.body?.getReader();if(!reader)throw new DomainError('PROVIDER_REJECTED',502);
      let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2_000_000)throw new DomainError('PROVIDER_REJECTED',502);chunks.push(chunk.value);}}
      finally{await reader.cancel();}
      const parsed=schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
      return parsed.data;
    }catch(error){if(error instanceof DomainError)throw error;if(error instanceof SyntaxError||error instanceof z.ZodError)throw new DomainError('PROVIDER_REJECTED',502);throw new DomainError('PROVIDER_UNAVAILABLE',503);}
    finally{console.log(JSON.stringify({event:'provider_request',requestId:context.correlationId,jobId:context.internalId,provider:'heygen',method,durationMs:Date.now()-start,status}));}
  }
  async pages<T>(path:string,schema:z.ZodType<T>,context:OperationContext):Promise<T[]> {
    const items:T[]=[];let token:string|undefined;const seen=new Set<string>();
    for(let page=0;page<100;page++){
      const result=await this.request(`${path}${path.includes('?')?'&':'?'}limit=50${token?`&token=${encodeURIComponent(token)}`:''}`,'GET',pageSchema(schema),context);
      items.push(...result.data);if(!result.has_more)return items;
      if(!result.next_token||seen.has(result.next_token))throw new DomainError('PROVIDER_REJECTED',502);
      token=result.next_token;seen.add(token);
    }
    throw new DomainError('PROVIDER_REJECTED',502);
  }
}
export class HeyGenAvatarProvider implements AvatarProvider {
  constructor(private readonly client:HeyGenClient) {}
  async create(input:Parameters<AvatarProvider['create']>[0],context:OperationContext) {
    const photoUrl=httpsUrl.parse(input.photoUrl);
    if(input.groupReference)checkReference(input.groupReference);
    const result=await this.client.request('/v3/avatars','POST',z.object({data:z.object({avatar_item:lookSchema})}),context,{type:'photo',name:z.string().min(1).max(120).parse(input.name),file:{type:'url',url:photoUrl},...(input.groupReference?{avatar_group_id:externalId.parse(input.groupReference.metadata.groupId)}:{})});
    return reference(context,result.data.avatar_item.id,{groupId:result.data.avatar_item.group_id,status:result.data.avatar_item.status});
  }
  async list(context:OperationContext) {
    // A shared server account can contain many tenants' private avatars. Never
    // expose that catalog. Private references are read via tenant-owned records.
    const looks=await this.client.pages('/v3/avatars/looks?ownership=public',lookSchema,context);
    return looks.filter(look=>look.status==='completed').map(look=>({reference:reference(context,look.id,{groupId:look.group_id,public:true}),name:look.name,previewUrl:look.preview_image_url??null}));
  }
  async status(value:ProviderReference,context:OperationContext) {
    const result=await this.client.request(`/v3/avatars/looks/${checkReference(value)}`,'GET',z.object({data:lookSchema}),context);
    return {status:result.data.status==='completed'?'READY' as const:result.data.status==='failed'?'FAILED' as const:'PROCESSING' as const,previewUrl:result.data.preview_image_url??null};
  }
  async delete(value:ProviderReference,context:OperationContext) {
    checkReference(value);if(value.metadata.public===true)throw new DomainError('NOT_AUTHORIZED',403);
    const group=encodeURIComponent(externalId.parse(value.metadata.groupId));
    await this.client.request(`/v3/avatars/${group}`,'DELETE',z.unknown(),context);
  }
}
export class HeyGenVideoProvider implements VideoProvider {
  constructor(private readonly client:HeyGenClient) {}
  async submit(input:Parameters<VideoProvider['submit']>[0],context:OperationContext) {
    checkReference(input.avatar);checkReference(input.voice);
    const ratio=input.width/input.height;
    const aspect=ratio===1?'1:1':Math.abs(ratio-9/16)<0.001?'9:16':Math.abs(ratio-16/9)<0.001?'16:9':null;
    if(!aspect||!Number.isInteger(input.width)||!Number.isInteger(input.height))throw new DomainError('INVALID_INPUT');
    const result=await this.client.request('/v3/videos','POST',z.object({data:z.object({video_id:externalId,status:z.string()})}),context,{type:'avatar',avatar_id:input.avatar.externalId,voice_id:input.voice.externalId,script:z.string().min(1).max(20000).parse(input.script),aspect_ratio:aspect,resolution:Math.min(input.width,input.height)<=720?'720p':'1080p',output_format:'mp4',callback_id:context.internalId});
    return reference(context,result.data.video_id);
  }
  async status(value:ProviderReference,context:OperationContext) {
    const result=await this.client.request(`/v3/videos/${checkReference(value)}`,'GET',z.object({data:z.object({id:externalId,status:z.enum(['waiting','pending','processing','completed','failed']),video_url:httpsUrl.nullish(),failure_code:z.string().nullish()})}),context);
    if(result.data.id!==value.externalId)throw new DomainError('PROVIDER_REJECTED',502);
    if(result.data.status==='completed'){if(!result.data.video_url)throw new DomainError('PROVIDER_REJECTED',502);return {status:'READY' as const,downloadUrl:result.data.video_url};}
    if(result.data.status==='failed')return {status:'FAILED' as const,errorCode:'PROVIDER_REJECTED'};
    return {status:'PROCESSING' as const};
  }
  async listPublicVoices(context:OperationContext) {
    const voices=await this.client.pages('/v3/voices?type=public',voiceSchema,context);
    return voices.filter(voice=>voice.type==='public').map(voice=>({reference:reference(context,voice.voice_id,{public:true}),name:voice.name,language:voice.language??null,previewUrl:voice.preview_audio_url??null}));
  }
}
