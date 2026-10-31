import {randomUUID,createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {YouTubeProvider,youtubeScopes,youtubeSessionUrl} from '../packages/providers/src/youtube';
import {youtubeMetadataSchema,ProviderRequestError,type YouTubeMetadata,type YouTubeTokens} from '../packages/types/src/index';
const channelId='UC'+'a'.repeat(22),videoId='aBcdEF012_-',accessToken='fixture_access_not_a_real_token';
const options={clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture_secret_not_real',redirectUri:'https://contentos.example.test/api/v1/social/youtube/callback'};
const session='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=fixture_session_not_real';
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const metadata:YouTubeMetadata={title:'Проверенный ролик',description:'Описание',tags:['учебный ролик'],categoryId:'22',privacy:'UNLISTED',madeForKids:false,containsSyntheticMedia:true};
const video={id:videoId,snippet:{channelId},status:{uploadStatus:'uploaded',privacyStatus:'unlisted'}};
const tokens:YouTubeTokens={accessToken,refreshToken:'fixture_refresh_not_real',expiresAt:'2099-01-01T00:00:00.000Z',refreshExpiresAt:null,scopes:[...youtubeScopes]};
afterEach(()=>vi.restoreAllMocks());

it('builds server-side OAuth authorization with state, PKCE and explicit offline consent',()=>{
  const provider=new YouTubeProvider(options),state='s'.repeat(43),verifier='v'.repeat(64),url=new URL(provider.authorizationUrl(state,verifier));
  expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('state')).toBe(state);expect(url.searchParams.get('redirect_uri')).toBe(options.redirectUri);
  expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('access_type')).toBe('offline');expect(url.searchParams.get('scope')).toBe(youtubeScopes.join(' '));expect(url.href).not.toContain(options.clientSecret);expect(url.href).not.toContain(verifier);
  expect(()=>provider.authorizationUrl('short',verifier)).toThrow('INVALID_INPUT');expect(()=>new YouTubeProvider({...options,redirectUri:'http://external.example/callback'})).toThrow('CONFIGURATION_REQUIRED');
});
it('exchanges once, validates granted scopes and preserves a refresh token when refreshing',async()=>{
  const transport=vi.fn<typeof fetch>(async(_url,request)=>{const body=request!.body as URLSearchParams;expect(body.get('client_secret')).toBe(options.clientSecret);return Response.json({access_token:accessToken,token_type:'Bearer',expires_in:3600,...(body.get('grant_type')==='authorization_code'?{scope:youtubeScopes.join(' '),refresh_token:tokens.refreshToken,refresh_token_expires_in:86400}:{})});});
  const log=vi.spyOn(console,'log').mockImplementation(()=>{}),provider=new YouTubeProvider(options,transport);
  const exchanged=await provider.exchange('fixture_code','v'.repeat(64),context());expect(exchanged.refreshToken).toBe(tokens.refreshToken);expect(exchanged.refreshExpiresAt).not.toBeNull();
  const refreshed=await provider.refresh(exchanged,context());expect(refreshed.refreshToken).toBe(tokens.refreshToken);expect(refreshed.scopes).toEqual(youtubeScopes);expect(transport).toHaveBeenCalledTimes(2);
  const logs=JSON.stringify(log.mock.calls);for(const secret of [accessToken,tokens.refreshToken,options.clientSecret,'fixture_code'])expect(logs).not.toContain(secret);
  await expect(new YouTubeProvider(options,async()=>Response.json({access_token:accessToken,token_type:'Bearer',expires_in:3600,scope:youtubeScopes[0],refresh_token:tokens.refreshToken})).exchange('fixture_code','v'.repeat(64),context())).rejects.toThrow('NOT_AUTHORIZED');
});
it('maps revoked authorization safely and never retries an uncertain token exchange',async()=>{
  for(const [response,code] of [[()=>Response.json({error:'invalid_grant',error_description:accessToken},{status:400}),'SOCIAL_TOKEN_EXPIRED'],[()=>{throw new Error(accessToken);},'RECONCILIATION_REQUIRED']] as const){
    const transport=vi.fn<typeof fetch>(async()=>response());await expect(new YouTubeProvider(options,transport).exchange('fixture_code','v'.repeat(64),context())).rejects.toThrow(code);expect(transport).toHaveBeenCalledTimes(1);
  }
});
it('inspects the grant channel without guessing a destination among multiple channels',async()=>{
  const entry={id:channelId,snippet:{title:'Fixture',customUrl:'@fixture'}};
  const provider=new YouTubeProvider(options,async()=>Response.json({items:[entry]})),ctx=context();const result=await provider.channel(accessToken,ctx);expect(result.reference).toMatchObject({internalId:ctx.internalId,externalId:channelId,provider:'youtube'});
  for(const body of [{items:[]},{items:[entry,entry]},{items:[entry],nextPageToken:'next'}])await expect(new YouTubeProvider(options,async()=>Response.json(body)).channel(accessToken,context())).rejects.toThrow('NOT_AUTHORIZED');
});
it('starts an upload with explicit metadata and returns only a validated session',async()=>{
  const transport=vi.fn<typeof fetch>(async(_url,request)=>{
    expect(request?.method).toBe('POST');expect(request?.redirect).toBe('manual');expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(request?.headers).get('x-upload-content-length')).toBe('1048576');
    expect(JSON.parse(request?.body as string)).toMatchObject({snippet:{title:metadata.title,categoryId:'22'},status:{privacyStatus:'unlisted',selfDeclaredMadeForKids:false,containsSyntheticMedia:true}});
    return new Response(null,{status:200,headers:{location:session}});
  });
  expect(await new YouTubeProvider(options,transport).startUpload(accessToken,metadata,1048576,context())).toBe(session);expect(transport).toHaveBeenCalledTimes(1);
});
it('rejects foreign, ambiguous and credential-bearing session URLs before any upload',async()=>{
  const transport=vi.fn<typeof fetch>(),provider=new YouTubeProvider(options,transport);
  for(const url of [session.replace('www.googleapis.com','evil.example'),session.replace('https:','http:'),session+'&upload_id=second',session+'&uploadType=other',session+'#fragment',session+'&access_token=secret','https://www.googleapis.com@127.0.0.1/upload/youtube/v3/videos?uploadType=resumable&upload_id=x',session.replace('/upload/youtube/v3/videos','/other')]){
    expect(()=>youtubeSessionUrl(url)).toThrow('INVALID_INPUT');await expect(provider.probeUpload(accessToken,url,100,channelId,context())).rejects.toThrow('INVALID_INPUT');
  }
  expect(transport).not.toHaveBeenCalled();
  await expect(new YouTubeProvider(options,async()=>new Response(null,{headers:{location:'https://evil.example/session'}})).startUpload(accessToken,metadata,100,context())).rejects.toThrow('RECONCILIATION_REQUIRED');
});
it('probes received bytes and resumes exactly at the acknowledged offset',async()=>{
  const transport=vi.fn<typeof fetch>(async(_url,request)=>{
    const headers=new Headers(request?.headers);
    if(headers.get('content-length')==='0'){expect(headers.get('content-range')).toBe('bytes */1000');return new Response(null,{status:308,headers:{range:'bytes=0-99','retry-after':'4'}});}
    expect(headers.get('content-range')).toBe('bytes 100-999/1000');expect((request?.body as Uint8Array).length).toBe(900);return Response.json(video,{status:201});
  });
  const provider=new YouTubeProvider(options,transport),ctx=context();expect(await provider.probeUpload(accessToken,session,1000,channelId,ctx)).toEqual({state:'UPLOADING',nextByte:100,retryAfterSeconds:4});
  const complete=await provider.upload(accessToken,session,{totalBytes:1000,offset:100,bytes:new Uint8Array(900),channelId},ctx);expect(complete).toMatchObject({state:'COMPLETE',video:{state:'PROCESSING',reference:{externalId:videoId,internalId:ctx.internalId}}});
});
it('handles zero progress, completed probes and expired sessions without initiating another upload',async()=>{
  for(const [reply,result] of [[()=>new Response(null,{status:308}),{state:'UPLOADING',nextByte:0}],[()=>Response.json(video),{state:'COMPLETE'}],[()=>new Response(null,{status:404}),{state:'EXPIRED'}],[()=>new Response(null,{status:410}),{state:'EXPIRED'}]] as const){
    const transport=vi.fn<typeof fetch>(async()=>reply());expect(await new YouTubeProvider(options,transport).probeUpload(accessToken,session,1000,channelId,context())).toMatchObject(result);expect(transport).toHaveBeenCalledTimes(1);
  }
});
it('rejects malformed acknowledgements and wrong channel/video identities',async()=>{
  for(const reply of [()=>new Response(null,{status:308,headers:{range:'bytes=0-1000'}}),()=>new Response(null,{status:308,headers:{range:'bytes=100-200'}}),()=>Response.json({...video,snippet:{channelId:'UC'+'b'.repeat(22)}}),()=>new Response('x'.repeat(256001))])await expect(new YouTubeProvider(options,async()=>reply()).probeUpload(accessToken,session,1000,channelId,context())).rejects.toThrow('RECONCILIATION_REQUIRED');
  await expect(new YouTubeProvider(options,async()=>Response.json({items:[{...video,id:'bbbbbbbbbbb'}]})).video(accessToken,videoId,channelId,context())).rejects.toThrow('PROVIDER_REJECTED');
});
it('does not equate upload acceptance with processed video or hide processing failure',async()=>{
  for(const [status,processing,state] of [['uploaded','processing','PROCESSING'],['processed','succeeded','READY'],['failed','failed','FAILED'],['processed','processing','PROCESSING']] as const){
    const provider=new YouTubeProvider(options,async()=>Response.json({items:[{...video,status:{...video.status,uploadStatus:status},processingDetails:{processingStatus:processing}}]}));
    expect(await provider.video(accessToken,videoId,channelId,context())).toMatchObject({state,privacy:'UNLISTED'});
  }
  expect(await new YouTubeProvider(options,async()=>Response.json({items:[]})).video(accessToken,videoId,channelId,context())).toBeNull();
});
it('bounds metadata, chunks and thumbnail payloads before network calls',async()=>{
  const transport=vi.fn<typeof fetch>(),provider=new YouTubeProvider(options,transport);
  for(const changed of [{title:' '},{title:'a'.repeat(101)},{description:'я'.repeat(2501)},{description:'<script>'},{tags:['x'.repeat(100),'x'.repeat(100),'x'.repeat(100),'x'.repeat(100),'x'.repeat(100)]},{madeForKids:undefined}])expect(youtubeMetadataSchema.safeParse({...metadata,...changed}).success).toBe(false);
  await expect(provider.upload(accessToken,session,{totalBytes:1000,offset:999,bytes:new Uint8Array(2),channelId},context())).rejects.toThrow('INVALID_MEDIA');
  await expect(provider.upload(accessToken,session,{totalBytes:1000,offset:0,bytes:new Uint8Array(100),channelId},context())).rejects.toThrow('INVALID_MEDIA');
  await expect(provider.thumbnail(accessToken,videoId,{bytes:new Uint8Array([1,2,3]),mimeType:'image/png'},context())).rejects.toThrow('INVALID_MEDIA');expect(transport).not.toHaveBeenCalled();
});
it('sends a thumbnail to its video without following redirects or logging credentials',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const transport=vi.fn<typeof fetch>(async(url,request)=>{expect(String(url)).toContain(`videoId=${videoId}`);expect(request?.redirect).toBe('manual');return Response.json({items:[{default:{url:'https://i.ytimg.com/fixture.jpg'}}]});});
  await new YouTubeProvider(options,transport).thumbnail(accessToken,videoId,{bytes:new Uint8Array([137,80,78,71,13,10,26,10]),mimeType:'image/png'},context());
  expect(transport).toHaveBeenCalledTimes(1);expect(JSON.stringify(log.mock.calls)).not.toContain(accessToken);
});
it('distinguishes verified quota rejection from uncertain submission and never blindly retries',async()=>{
  for(const [reply,definitive,code] of [[()=>Response.json({error:{code:403,errors:[{reason:'quotaExceeded'}]}},{status:403,headers:{'retry-after':'60'}}),true,'RATE_LIMITED'],[()=>new Response('unverified rejection',{status:400}),false,'RECONCILIATION_REQUIRED'],[()=>{throw new Error(accessToken);},false,'RECONCILIATION_REQUIRED']] as const){
    const transport=vi.fn<typeof fetch>(async()=>reply());const error=await new YouTubeProvider(options,transport).startUpload(accessToken,metadata,100,context()).catch(error=>error as ProviderRequestError);
    expect(error).toBeInstanceOf(ProviderRequestError);expect(error).toMatchObject({code,definitiveRejection:definitive});expect(String(error)).not.toContain(accessToken);expect(transport).toHaveBeenCalledTimes(1);
  }
});

it('reads only channel-bound cumulative statistics and preserves unknown metrics',async()=>{
  const transport=vi.fn<typeof fetch>(async(url,request)=>{const endpoint=new URL(String(url));expect(endpoint.origin).toBe('https://www.googleapis.com');expect(endpoint.searchParams.get('part')).toBe('snippet,statistics');expect(endpoint.searchParams.get('fields')).toContain('viewCount,likeCount,commentCount');expect(request?.redirect).toBe('manual');return Response.json({items:[{id:videoId,snippet:{channelId},statistics:{viewCount:'123',likeCount:'0',commentCount:'7',favoriteCount:'0'}}]});});
  const ctx=context(),result=await new YouTubeProvider(options,transport).statistics(accessToken,videoId,channelId,ctx);
  expect(result?.metrics).toMatchObject({views:123,likes:0,comments:7,shares:null,saves:null,watch_time:null,impressions:null});expect(result?.reference.internalId).toBe(ctx.internalId);expect(Date.parse(result!.observedAt)).toBeLessThanOrEqual(Date.now());expect(transport).toHaveBeenCalledTimes(1);
  const missing=await new YouTubeProvider(options,async()=>Response.json({items:[{id:videoId,snippet:{channelId},statistics:{viewCount:'0'}}]})).statistics(accessToken,videoId,channelId,context());expect(missing?.metrics.views).toBe(0);expect(missing?.metrics.likes).toBeNull();
  expect(await new YouTubeProvider(options,async()=>Response.json({items:[]})).statistics(accessToken,videoId,channelId,context())).toBeNull();
});
it('rejects malformed counts, ambiguous results and foreign statistic ownership',async()=>{
  const entry={id:videoId,snippet:{channelId},statistics:{viewCount:'1'}};
  for(const value of ['-1','1.5','1e3','1000000000001','99999999999999999999',1,null])await expect(new YouTubeProvider(options,async()=>Response.json({items:[{...entry,statistics:{viewCount:value}}]})).statistics(accessToken,videoId,channelId,context())).rejects.toThrow('PROVIDER_REJECTED');
  await expect(new YouTubeProvider(options,async()=>Response.json({items:[entry,entry]})).statistics(accessToken,videoId,channelId,context())).rejects.toThrow('PROVIDER_REJECTED');
  await expect(new YouTubeProvider(options,async()=>Response.json({items:[{...entry,snippet:{channelId:'UC'+'z'.repeat(22)}}]})).statistics(accessToken,videoId,channelId,context())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(new YouTubeProvider(options,async()=>Response.json({items:[{...entry,id:'z'.repeat(11)}]})).statistics(accessToken,videoId,channelId,context())).rejects.toThrow('NOT_AUTHORIZED');
});
it('does not send cancelled or invalid statistics requests and safely reports quota errors',async()=>{
  const transport=vi.fn<typeof fetch>(async()=>Response.json({error:{code:403,errors:[{reason:'quotaExceeded'}]}},{status:403})),provider=new YouTubeProvider(options,transport);
  await expect(provider.statistics(accessToken,'bad',channelId,context())).rejects.toThrow('INVALID_INPUT');await expect(provider.statistics(accessToken,videoId,channelId,{...context(),signal:AbortSignal.abort()})).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
  await expect(provider.statistics(accessToken,videoId,channelId,context())).rejects.toThrow('RATE_LIMITED');expect(transport).toHaveBeenCalledTimes(1);
});
