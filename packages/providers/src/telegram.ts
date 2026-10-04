import {z} from 'zod';
import {DomainError,telegramTokenSchema,telegramTargetSchema,type ChannelAnalyticsProvider,type SocialConnectionProvider,type OperationContext} from '@contentos/types';
const id=z.number().int().safe();
const username=z.string().regex(/^[A-Za-z0-9_]{1,32}$/);
const botSchema=z.object({id:id.positive(),is_bot:z.literal(true),username});
const chatSchema=z.object({id:id.negative(),type:z.literal('channel'),title:z.string().min(1).max(256),username:username.optional(),linked_chat_id:id.optional()});
const memberSchema=z.object({status:z.enum(['creator','administrator','member','restricted','left','kicked']),user:z.object({id:id.positive(),is_bot:z.literal(true)}),can_post_messages:z.boolean().optional()});
/** Read-only account inspection. Requests never emit credentials or full URLs. */
export class TelegramConnectionProvider implements SocialConnectionProvider,ChannelAnalyticsProvider{
  constructor(private readonly transport:typeof fetch=fetch){}
  private async request<T>(token:string,method:'getMe'|'getChat'|'getChatMember'|'getChatMemberCount',body:Record<string,unknown>,schema:z.ZodType<T>,context:OperationContext):Promise<T>{
    const started=Date.now();let status=0;
    try{
      const response=await this.transport(`https://api.telegram.org/bot${telegramTokenSchema.parse(token)}/${method}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([context.signal,AbortSignal.timeout(10000)])});status=response.status;
      if(status===401)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
      if(status===403)throw new DomainError('NOT_AUTHORIZED',403);
      if(status===429||status>=500)throw new DomainError('PROVIDER_UNAVAILABLE',503);
      if(!response.ok)throw new DomainError('PROVIDER_REJECTED',502);
      const reader=response.body?.getReader();if(!reader)throw new DomainError('PROVIDER_REJECTED',502);const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>256000)throw new DomainError('PROVIDER_REJECTED',502);chunks.push(next.value);}}finally{await reader.cancel();}
      const envelope=z.object({ok:z.boolean(),result:z.unknown().optional(),error_code:z.number().optional()}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if(!envelope.ok){if(envelope.error_code===401)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);if(envelope.error_code===403)throw new DomainError('NOT_AUTHORIZED',403);if(envelope.error_code===429||(envelope.error_code??0)>=500)throw new DomainError('PROVIDER_UNAVAILABLE',503);throw new DomainError('PROVIDER_REJECTED',502);}
      return schema.parse(envelope.result);
    }catch(error){if(error instanceof DomainError)throw error;if(error instanceof z.ZodError||error instanceof SyntaxError)throw new DomainError('PROVIDER_REJECTED',502);throw new DomainError('PROVIDER_UNAVAILABLE',503);}
    finally{console.log(JSON.stringify({event:'provider_request',provider:'telegram',operation:method,requestId:context.correlationId,jobId:context.internalId,durationMs:Date.now()-started,status}));}
  }
  async fetchChannel(reference:Parameters<ChannelAnalyticsProvider['fetchChannel']>[0],credential:string,context:OperationContext){
    if(reference.provider!=='telegram'||!/^-[1-9][0-9]{0,15}$/.test(reference.externalId)||!Number.isSafeInteger(Number(reference.externalId)))throw new DomainError('INVALID_INPUT');
    const memberCount=await this.request(credential,'getChatMemberCount',{chat_id:reference.externalId},z.number().int().min(0).max(1_000_000_000_000),context);
    return {memberCount,observedAt:new Date().toISOString(),rawResult:memberCount};
  }
  async inspect(credential:string,target:string,context:OperationContext){
    const token=telegramTokenSchema.parse(credential),channel=telegramTargetSchema.parse(target);
    const [bot,chat]=await Promise.all([this.request(token,'getMe',{},botSchema,context),this.request(token,'getChat',{chat_id:channel},chatSchema,context)]);
    const member=await this.request(token,'getChatMember',{chat_id:chat.id,user_id:bot.id},memberSchema,context);
    if(member.user.id!==bot.id)throw new DomainError('PROVIDER_REJECTED',502);
    const canPublish=member.status==='administrator'&&member.can_post_messages===true;
    return {name:chat.title,username:chat.username??null,canPublish,reference:{provider:'telegram',externalId:String(chat.id),internalId:context.internalId,metadata:{botId:String(bot.id),botUsername:bot.username,hasLinkedDiscussion:!!chat.linked_chat_id,public:!!chat.username}}};
  }
}
export function socialFromEnvironment(env:{SOCIAL_PROVIDER:string;NODE_ENV:string}):{name:string;provider:SocialConnectionProvider}|null{
  if(env.SOCIAL_PROVIDER==='telegram')return {name:'telegram',provider:new TelegramConnectionProvider()};
  if(env.SOCIAL_PROVIDER==='mock'){
    if(!['development','test'].includes(env.NODE_ENV))throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {name:'mock-telegram',provider:{inspect:async(_credential,_target,context)=>({name:'Демонстрационный канал',username:'contentos_demo',canPublish:true,reference:{provider:'mock-telegram',externalId:'-1001234567890',internalId:context.internalId,metadata:{botId:'123456',botUsername:'contentos_demo_bot',hasLinkedDiscussion:false,public:true}}})}};
  }
  return null;
}

export function channelAnalyticsFromEnvironment(env:{ANALYTICS_ENABLED:string;SOCIAL_PROVIDER:string;NODE_ENV:string}):{name:string;source:'API'|'DEMO';provider:ChannelAnalyticsProvider}|null{
  if(env.ANALYTICS_ENABLED!=='true')return null;
  if(env.SOCIAL_PROVIDER==='telegram')return {name:'telegram',source:'API',provider:new TelegramConnectionProvider()};
  if(env.SOCIAL_PROVIDER==='mock'){
    if(!['development','test'].includes(env.NODE_ENV))throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {name:'mock-telegram',source:'DEMO',provider:{fetchChannel:async()=>({memberCount:1000,rawResult:1000,observedAt:new Date().toISOString()})}};
  }
  return null;
}
