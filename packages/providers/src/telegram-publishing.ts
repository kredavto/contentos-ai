import {z} from 'zod';
import {DomainError,ProviderRequestError,telegramTokenSchema,telegramTargetSchema,telegramVideoByteLimit,validateTelegramPublication,type PublishingProvider,type OperationContext} from '@contentos/types';
const messageSchema=z.object({message_id:z.number().int().positive().safe(),date:z.number().int().positive(),chat:z.object({id:z.number().int().negative().safe(),type:z.literal('channel'),username:z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional()})});
/** One HTTP attempt only. An unverified response is never safe to replay. */
export class TelegramPublishingProvider implements PublishingProvider{
  constructor(private readonly transport:typeof fetch=fetch){}
  async publish(input:Parameters<PublishingProvider['publish']>[0],context:OperationContext){
    validateTelegramPublication(input,input.channel);
    const token=telegramTokenSchema.parse(input.credential),target=telegramTargetSchema.parse(input.channel.externalId);
    if(target.startsWith('@')||input.channel.provider!=='telegram')throw new DomainError('INVALID_INPUT');
    const form=new FormData();form.set('chat_id',target);form.set('allow_paid_broadcast','false');
    const method=input.type==='SHORT_VIDEO'?'sendVideo':'sendMessage';
    if(input.type==='SHORT_VIDEO'){
      if(!input.bytes?.length||input.bytes.length>telegramVideoByteLimit)throw new DomainError('INVALID_MEDIA');
      form.set('video',new Blob([Uint8Array.from(input.bytes)],{type:'video/mp4'}),'video.mp4');form.set('caption',input.caption);form.set('supports_streaming','true');
    }else{form.set('text',input.caption);form.set('link_preview_options',JSON.stringify({is_disabled:true}));}
    let status=0;const started=Date.now();
    try{
      const response=await this.transport(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body:form,redirect:'error',signal:AbortSignal.any([context.signal,AbortSignal.timeout(45000)])});status=response.status;
      const reader=response.body?.getReader();if(!reader)throw new Error('Missing response');const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>256000)throw new Error('Response too large');chunks.push(next.value);}}finally{await reader.cancel();}
      const envelope=z.object({ok:z.boolean(),result:z.unknown().optional(),error_code:z.number().int().optional()}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if(!envelope.ok&&envelope.error_code&&[400,401,403,404,429].includes(envelope.error_code))throw new ProviderRequestError(envelope.error_code===401?'SOCIAL_TOKEN_EXPIRED':'PROVIDER_REJECTED',502,true);
      if(!response.ok||!envelope.ok)throw new Error('Uncertain response');
      const message=messageSchema.parse(envelope.result);if(String(message.chat.id)!==target)throw new Error('Unexpected destination');
      return {reference:{provider:'telegram',internalId:context.internalId,externalId:String(message.message_id),metadata:{channelId:target}},status:'PUBLISHED' as const,url:message.chat.username?`https://t.me/${message.chat.username}/${message.message_id}`:null,publishedAt:new Date(message.date*1000).toISOString()};
    }catch(error){if(error instanceof ProviderRequestError)throw error;throw new ProviderRequestError('RECONCILIATION_REQUIRED',409,false);}
    finally{console.log(JSON.stringify({event:'provider_request',provider:'telegram',operation:method,requestId:context.correlationId,jobId:context.internalId,durationMs:Date.now()-started,status}));}
  }
}
export function publishingFromEnvironment(env:{SOCIAL_PROVIDER:string;NODE_ENV:string;PUBLISHING_ENABLED:string}):{name:string;provider:PublishingProvider}|null{
  if(env.PUBLISHING_ENABLED!=='true')return null;
  if(env.SOCIAL_PROVIDER==='telegram')return {name:'telegram',provider:new TelegramPublishingProvider()};
  if(env.SOCIAL_PROVIDER==='mock'){
    if(!['development','test'].includes(env.NODE_ENV))throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {name:'mock-telegram',provider:{publish:async(input,context)=>{validateTelegramPublication(input,input.channel);return {reference:{provider:'mock-telegram',internalId:context.internalId,externalId:context.idempotencyKey,metadata:{channelId:input.channel.externalId}},status:'PUBLISHED',url:null,publishedAt:new Date().toISOString()};}}};
  }
  return null;
}
