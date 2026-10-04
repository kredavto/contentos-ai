import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {TelegramConnectionProvider,channelAnalyticsFromEnvironment} from '../packages/providers/src/telegram';
const token='123456:fixture_token_not_a_real_credential';
const ctx=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const ref=()=>({provider:'telegram',internalId:randomUUID(),externalId:'-1001234567890',metadata:{}});
describe('Telegram channel membership adapter',()=>{
  it('uses the official read-only endpoint, preserves zero and retains only numeric evidence',async()=>{
    let calls=0;const logs=vi.spyOn(console,'log').mockImplementation(()=>{});
    try{const provider=new TelegramConnectionProvider(async(input,init)=>{calls++;expect(String(input)).toBe(`https://api.telegram.org/bot${token}/getChatMemberCount`);expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');expect(JSON.parse(String(init?.body))).toEqual({chat_id:'-1001234567890'});return Response.json({ok:true,result:0,extra:'not retained'});});
      expect(await provider.fetchChannel(ref(),token,ctx())).toEqual({memberCount:0,rawResult:0,observedAt:expect.any(String)});expect(calls).toBe(1);expect(JSON.stringify(logs.mock.calls)).not.toContain(token);
    }finally{logs.mockRestore();}
  });
  it('rejects invalid counts and destinations without inventing missing data',async()=>{
    for(const value of [null,'4',-1,1.1,1e13,{},false]){const provider=new TelegramConnectionProvider(async()=>Response.json({ok:true,result:value}));await expect(provider.fetchChannel(ref(),token,ctx())).rejects.toThrow('PROVIDER_REJECTED');}
    const transport=vi.fn(async()=>Response.json({ok:true,result:1})),provider=new TelegramConnectionProvider(transport);
    for(const externalId of ['@someone','123','https://example.test','-9999999999999999'])await expect(provider.fetchChannel({...ref(),externalId},token,ctx())).rejects.toThrow('INVALID_INPUT');expect(transport).not.toHaveBeenCalled();
  });
  it('classifies errors safely, bounds payloads and leaves retries to the worker',async()=>{
    for(const [status,code] of [[401,'SOCIAL_TOKEN_EXPIRED'],[403,'NOT_AUTHORIZED'],[429,'PROVIDER_UNAVAILABLE'],[503,'PROVIDER_UNAVAILABLE'],[400,'PROVIDER_REJECTED']] as const){const provider=new TelegramConnectionProvider(async()=>Response.json({ok:false},{status}));await expect(provider.fetchChannel(ref(),token,ctx())).rejects.toThrow(code);}
    const transient=new TelegramConnectionProvider(async()=>Response.json({ok:false,error_code:503}));await expect(transient.fetchChannel(ref(),token,ctx())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    let calls=0;const network=new TelegramConnectionProvider(async()=>{calls++;throw new Error(token);});await expect(network.fetchChannel(ref(),token,ctx())).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(calls).toBe(1);
    const huge=new TelegramConnectionProvider(async()=>new Response(' '.repeat(256001)));await expect(huge.fetchChannel(ref(),token,ctx())).rejects.toThrow('PROVIDER_REJECTED');
    expect(channelAnalyticsFromEnvironment({ANALYTICS_ENABLED:'false',SOCIAL_PROVIDER:'telegram',NODE_ENV:'production'})).toBeNull();
    expect(()=>channelAnalyticsFromEnvironment({ANALYTICS_ENABLED:'true',SOCIAL_PROVIDER:'mock',NODE_ENV:'production'})).toThrow('CONFIGURATION_REQUIRED');
    expect(channelAnalyticsFromEnvironment({ANALYTICS_ENABLED:'true',SOCIAL_PROVIDER:'mock',NODE_ENV:'test'})?.source).toBe('DEMO');
  });
});
