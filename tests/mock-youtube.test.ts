import {randomUUID} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {MockYouTubeProvider,youtubePublishingFromEnvironment} from '../packages/providers/src/mock-youtube';
const context={tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
const channelId='UC'+'a'.repeat(22),token=`test-channel:${channelId}`;
const metadata={title:'Fixture',description:'',tags:[],categoryId:'22',privacy:'UNLISTED' as const,madeForKids:false,containsSyntheticMedia:true};
afterEach(()=>vi.unstubAllEnvs());
it('cannot activate the simulator in production or development, including inconsistent environment arguments',()=>{
  for(const mode of ['production','development']){
    vi.stubEnv('NODE_ENV',mode);expect(()=>new MockYouTubeProvider()).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>youtubePublishingFromEnvironment({NODE_ENV:mode,YOUTUBE_TEST_MODE:'true',YOUTUBE_ENABLED:'false',APP_URL:'http://localhost'})).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>youtubePublishingFromEnvironment({NODE_ENV:'test',YOUTUBE_TEST_MODE:'true',YOUTUBE_ENABLED:'false',APP_URL:'http://localhost'})).toThrow('CONFIGURATION_REQUIRED');
  }
});
it('does not replace missing production configuration or simulate Google login',async()=>{
  vi.stubEnv('NODE_ENV','test');expect(youtubePublishingFromEnvironment({NODE_ENV:'test',YOUTUBE_ENABLED:'false',APP_URL:'http://localhost'})).toBeNull();
  const provider=new MockYouTubeProvider();expect(()=>provider.authorizationUrl()).toThrow('CONFIGURATION_REQUIRED');await expect(provider.exchange()).rejects.toThrow('CONFIGURATION_REQUIRED');
});
it('simulates resumable progress and final privacy without any network requests',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Network is forbidden'));
  try{
    const provider=new MockYouTubeProvider(),session=await provider.startUpload(token,metadata,4,context);
    expect(await provider.probeUpload(token,session,4,channelId,context)).toMatchObject({state:'UPLOADING',nextByte:0});
    expect(await provider.upload(token,session,{totalBytes:4,offset:0,bytes:new Uint8Array(2),channelId},context)).toMatchObject({state:'UPLOADING',nextByte:2});
    await expect(provider.upload(token,session,{totalBytes:4,offset:0,bytes:new Uint8Array(2),channelId},context)).rejects.toThrow('INVALID_INPUT');
    const result=await provider.upload(token,session,{totalBytes:4,offset:2,bytes:new Uint8Array(2),channelId},context);expect(result.state).toBe('COMPLETE');
    if(result.state!=='COMPLETE')throw new Error('Missing video');
    expect(await provider.video(token,result.video.reference.externalId,channelId,context)).toMatchObject({state:'READY',privacy:'UNLISTED',reference:{metadata:{demo:true}}});
    const statistics=await provider.statistics(token,result.video.reference.externalId,channelId,context);expect(statistics).toMatchObject({reference:{metadata:{demo:true}},metrics:{views:0,likes:3,comments:2,impressions:null,watch_time:null}});
    expect(await provider.statistics(token,'missing1234',channelId,context)).toBeNull();
    await expect(provider.statistics(`test-channel:UC${'b'.repeat(22)}`,result.video.reference.externalId,channelId,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.probeUpload(`test-channel:UC${'b'.repeat(22)}`,session,4,channelId,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.startUpload(token,metadata,4,context)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  }finally{fetch.mockRestore();}
});
