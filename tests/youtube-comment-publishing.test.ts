import {randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {YouTubeProvider} from '../packages/providers/src/youtube';
const options={clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-not-real',redirectUri:'https://contentos.example/api/social/youtube/callback'};
const token='fixture-not-real-access',channelId='UC'+'a'.repeat(22),value={parentId:'root-a',channelId,text:'Проверенный ответ <plain text>'};
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const receipt=()=>({id:'reply-a',snippet:{channelId,parentId:value.parentId,authorChannelId:{value:channelId},textOriginal:value.text,publishedAt:'2026-10-24T00:00:00Z'}});
afterEach(()=>vi.restoreAllMocks());
it('inserts exactly once using the approved original text and returns a bound receipt without secret logs',async()=>{
 const log=vi.spyOn(console,'log').mockImplementation(()=>{}),transport=vi.fn<typeof fetch>(async()=>Response.json(receipt(),{status:201})),ctx=context();
 const result=await new YouTubeProvider(options,transport).insertCommentReply(token,value,ctx);
 expect(result).toEqual({reference:{provider:'youtube',internalId:ctx.internalId,externalId:'reply-a',metadata:{kind:'comment-reply',parentId:'root-a',channelId}},publishedAt:'2026-10-24T00:00:00.000Z'});
 expect(transport).toHaveBeenCalledOnce();const [url,request]=transport.mock.calls[0]!;
 expect(url).toBe('https://www.googleapis.com/youtube/v3/comments?part=snippet');expect(request?.method).toBe('POST');expect(request?.redirect).toBe('manual');
 expect(JSON.parse(String(request?.body))).toEqual({snippet:{parentId:'root-a',textOriginal:value.text}});
 expect(request?.headers).toEqual({Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8'});
 for(const secret of [token,value.text,ctx.idempotencyKey])expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});
it('rejects invalid local input and pre-aborted work before any transport',async()=>{
 const transport=vi.fn<typeof fetch>(),adapter=new YouTubeProvider(options,transport);
 for(const input of [{...value,parentId:'https://evil.test'},{...value,channelId:'bad'},{...value,text:''},{...value,text:'x'.repeat(2001)},{...value,text:'bad\u0000'},{...value,approved:true}])await expect(adapter.insertCommentReply(token,input,context())).rejects.toThrow('INVALID_INPUT');
 const controller=new AbortController();controller.abort();await expect(adapter.insertCommentReply(token,value,{...context(),signal:controller.signal})).rejects.toMatchObject({definitiveRejection:true});expect(transport).not.toHaveBeenCalled();
});
it('classifies lost transport, malformed success and ambiguous rejection as uncertain without retry',async()=>{
 const responses=[()=>{throw new Error(token);},()=>new Response('not-json'),()=>Response.json({}),()=>new Response('x'.repeat(256001)),()=>Response.json({error:{code:500,errors:[{reason:'backendError'}]}},{status:500}),()=>Response.json({error:{code:400,errors:[{reason:'processingFailure'}]}},{status:400}),()=>Response.json({error:{code:403,errors:[{reason:'unknownReason'}]}},{status:403}),()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})];
 for(const make of responses){const transport=vi.fn<typeof fetch>(async()=>make());await expect(new YouTubeProvider(options,transport).insertCommentReply(token,value,context())).rejects.toMatchObject({code:'RECONCILIATION_REQUIRED',definitiveRejection:false});expect(transport).toHaveBeenCalledOnce();}
});
it('does not accept a success receipt for another parent, channel, author or text',async()=>{
 const wrong='UC'+'b'.repeat(22);
 for(const patch of [{parentId:'other'},{channelId:wrong},{authorChannelId:{value:wrong}},{authorChannelId:undefined},{textOriginal:'Changed'},{publishedAt:'bad'}]){
  const row=receipt(),transport=vi.fn<typeof fetch>(async()=>Response.json({...row,snippet:{...row.snippet,...patch}}));
  await expect(new YouTubeProvider(options,transport).insertCommentReply(token,value,context())).rejects.toMatchObject({code:'RECONCILIATION_REQUIRED',definitiveRejection:false});expect(transport).toHaveBeenCalledOnce();
 }
});
it('returns definitive documented denial without retry or leaking provider error text',async()=>{
 for(const [status,reason,code] of [[400,'commentTextTooLong','PROVIDER_REJECTED'],[403,'forbidden','NOT_AUTHORIZED'],[404,'parentCommentNotFound','NOT_FOUND'],[401,'authError','SOCIAL_TOKEN_EXPIRED'],[403,'quotaExceeded','RATE_LIMITED']] as const){
  const transport=vi.fn<typeof fetch>(async()=>Response.json({error:{code:status,errors:[{reason}],message:token}},{status}));
  await expect(new YouTubeProvider(options,transport).insertCommentReply(token,value,context())).rejects.toMatchObject({code,definitiveRejection:true,message:code});expect(transport).toHaveBeenCalledOnce();
 }
});

it('reads a specific receipt using original text, without writes or pagination parameters',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>Response.json({items:[{...receipt(),snippet:{...receipt().snippet,textDisplay:'Provider rendered differently'}}]}));
 const result=await new YouTubeProvider(options,transport).commentReplyReceipt(token,'reply-a',value,context());expect(result?.reference.externalId).toBe('reply-a');
 const [url,request]=transport.mock.calls[0]!;expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual({part:'snippet',id:'reply-a',textFormat:'plainText'});expect(request?.method??'GET').toBe('GET');expect(request?.body).toBeUndefined();expect(transport).toHaveBeenCalledOnce();
});
it('does not confuse missing, mismatched or unavailable receipts with a confirmed send',async()=>{
 const empty=new YouTubeProvider(options,async()=>Response.json({items:[]}));expect(await empty.commentReplyReceipt(token,'reply-a',value,context())).toBeNull();
 for(const items of [[{...receipt(),id:'different'}],[receipt(),receipt()],[{...receipt(),snippet:{...receipt().snippet,textOriginal:'Different'}}]])await expect(new YouTubeProvider(options,async()=>Response.json({items})).commentReplyReceipt(token,'reply-a',value,context())).rejects.toThrow('PROVIDER_REJECTED');
 await expect(new YouTubeProvider(options,async()=>Response.json({error:{code:403,errors:[{reason:'forbidden'}]}},{status:403})).commentReplyReceipt(token,'reply-a',value,context())).rejects.toThrow('NOT_AUTHORIZED');
});
