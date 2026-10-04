import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {TelegramConnectionProvider,socialFromEnvironment} from '../packages/providers/src/telegram';
const token='123456:fixture_token_not_a_real_credential';
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
function fixture(method:string,canPost=true){return method==='getMe'?{id:123456,is_bot:true,username:'fixture_bot'}:method==='getChat'?{id:-1001234567890,type:'channel',title:'Fixture channel',username:'fixture_channel'}:{status:'administrator',user:{id:123456,is_bot:true},can_post_messages:canPost};}
describe('official Telegram connection inspection',()=>{
  it('only reads bot/channel rights and never logs or returns the credential',async()=>{
    const methods:string[]=[],logs=vi.spyOn(console,'log').mockImplementation(()=>{});
    try{const provider=new TelegramConnectionProvider(async(input,init)=>{const url=new URL(String(input));expect(url.origin).toBe('https://api.telegram.org');expect(init?.redirect).toBe('error');expect(init?.method).toBe('POST');const method=url.pathname.split('/').at(-1)!;methods.push(method);const body=JSON.parse(String(init?.body));if(method==='getChatMember')expect(body).toEqual({chat_id:-1001234567890,user_id:123456});return Response.json({ok:true,result:fixture(method)});});
      const result=await provider.inspect(token,'@fixture_channel',context());expect(methods.sort()).toEqual(['getChat','getChatMember','getMe']);expect(result.canPublish).toBe(true);expect(result.reference.externalId).toBe('-1001234567890');expect(JSON.stringify(result)).not.toContain(token);expect(JSON.stringify(logs.mock.calls)).not.toContain(token);
    }finally{logs.mockRestore();}
  });
  it('reports limited rights and rejects non-channel destinations or another bot',async()=>{
    const limited=new TelegramConnectionProvider(async input=>Response.json({ok:true,result:fixture(new URL(String(input)).pathname.split('/').at(-1)!,false)}));expect((await limited.inspect(token,'@news',context())).canPublish).toBe(false);
    const invalid=new TelegramConnectionProvider(async input=>{const method=new URL(String(input)).pathname.split('/').at(-1)!;return Response.json({ok:true,result:method==='getChat'?{id:123,type:'private',title:'Wrong'}:fixture(method)});});await expect(invalid.inspect(token,'@fixture_channel',context())).rejects.toThrow('PROVIDER_REJECTED');
    const different=new TelegramConnectionProvider(async input=>{const method=new URL(String(input)).pathname.split('/').at(-1)!;return Response.json({ok:true,result:method==='getChatMember'?{...fixture(method),user:{id:999,is_bot:true}}:fixture(method)});});await expect(different.inspect(token,'@fixture_channel',context())).rejects.toThrow('PROVIDER_REJECTED');
  });
  it('normalizes errors without forwarding token-bearing exceptions or retrying',async()=>{
    let calls=0;const provider=new TelegramConnectionProvider(async()=>{calls++;throw new Error(`sensitive https://api.telegram.org/bot${token}`);});await expect(provider.inspect(token,'@fixture_channel',context())).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(calls).toBe(2);
    const revoked=new TelegramConnectionProvider(async()=>Response.json({ok:false},{status:401}));await expect(revoked.inspect(token,'@fixture_channel',context())).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
    expect(()=>socialFromEnvironment({SOCIAL_PROVIDER:'mock',NODE_ENV:'production'})).toThrow('CONFIGURATION_REQUIRED');
  });
});
