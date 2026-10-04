import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {TelegramPublishingProvider,publishingFromEnvironment} from '../packages/providers/src/telegram-publishing';
import {ProviderRequestError,type PublishingProvider} from '../packages/types/src/index';
const credential='123456:fixture_token_not_a_real_credential';
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const input=():Parameters<PublishingProvider['publish']>[0]=>({credential,channel:{provider:'telegram',internalId:randomUUID(),externalId:'-1001234567890',metadata:{public:true,hasLinkedDiscussion:false}},type:'POST',caption:'Проверенный текст',privacy:'PUBLIC',commentsEnabled:false});
const result={message_id:42,date:1791110000,chat:{id:-1001234567890,type:'channel',username:'fixture'}};
describe('Telegram single-attempt publication transport',()=>{
  it('sends bounded multipart video with plain caption and paid broadcasts disabled',async()=>{
    const request=vi.fn<typeof fetch>(async(_url,init)=>{const form=init!.body as FormData;expect(form.get('allow_paid_broadcast')).toBe('false');expect(form.get('chat_id')).toBe('-1001234567890');expect(form.get('video')).toBeInstanceOf(Blob);expect(form.has('parse_mode')).toBe(false);return Response.json({ok:true,result});});
    const log=vi.spyOn(console,'log').mockImplementation(()=>{});try{const provider=new TelegramPublishingProvider(request),ctx=context();const sent=await provider.publish({...input(),type:'SHORT_VIDEO',bytes:new Uint8Array([0,1,2])},ctx);expect(sent.reference.internalId).toBe(ctx.internalId);expect(sent.url).toBe('https://t.me/fixture/42');expect(request).toHaveBeenCalledTimes(1);expect(String(request.mock.calls[0]?.[0])).toMatch(/\/sendVideo$/);expect(JSON.stringify(log.mock.calls)).not.toContain(credential);}finally{log.mockRestore();}
  });
  it('validates platform options and byte/text limits before making a request',async()=>{
    const request=vi.fn<typeof fetch>();const provider=new TelegramPublishingProvider(request);
    for(const changed of [{privacy:'PRIVATE' as const},{commentsEnabled:true},{caption:'a'.repeat(4097)},{type:'SHORT_VIDEO' as const,bytes:new Uint8Array(50_000_001)}])await expect(provider.publish({...input(),...changed},context())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();expect(()=>publishingFromEnvironment({SOCIAL_PROVIDER:'mock',NODE_ENV:'production',PUBLISHING_ENABLED:'true'})).toThrow('CONFIGURATION_REQUIRED');
  });
  it('distinguishes confirmed rejection from uncertain responses and never retries either',async()=>{
    for(const response of [()=>Response.json({ok:false,error_code:400,description:credential},{status:400}),()=>Response.json({ok:false,error_code:429,parameters:{retry_after:5}},{status:429}),()=>new Response('bad',{status:502}),()=>Response.json({ok:true,result:{...result,chat:{...result.chat,id:-1009999999999}}}),()=>{throw new Error(credential);}]){
      const request=vi.fn<typeof fetch>(async()=>response()),provider=new TelegramPublishingProvider(request);
      const error=await provider.publish(input(),context()).catch(error=>error as ProviderRequestError);expect(error).toBeInstanceOf(ProviderRequestError);expect(String(error)).not.toContain(credential);expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('classifies a valid 403 as definitive and network failure as uncertain',async()=>{
    for(const [transport,definitive] of [[async()=>Response.json({ok:false,error_code:403},{status:403}),true],[async()=>{throw new Error('socket ended');},false]] as const){try{await new TelegramPublishingProvider(transport).publish(input(),context());throw new Error('Expected rejection');}catch(error){expect(error).toBeInstanceOf(ProviderRequestError);expect((error as ProviderRequestError).definitiveRejection).toBe(definitive);}}
  });
});
