import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {HeyGenClient,HeyGenAvatarProvider,HeyGenVideoProvider} from '../packages/providers/src/heygen';
const context={internalId:randomUUID(),tenantId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
const ref={provider:'heygen',internalId:context.internalId,externalId:'look-1',metadata:{groupId:'group-1'}};
const look={id:'look-1',group_id:'group-1',name:'Fictional fixture',status:'completed',preview_image_url:'https://files.heygen.ai/test.jpg'};
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
describe('HeyGen v3 adapters',()=>{
  it('creates photo looks with documented schema and mutation idempotency',async()=>{
    const transport:typeof fetch=async(url,init)=>{
      expect(url).toBe('https://api.heygen.com/v3/avatars');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(context.idempotencyKey);
      expect(JSON.parse(String(init?.body))).toEqual({type:'photo',name:'Fictional fixture',file:{type:'url',url:'https://storage.example.test/image.jpg'},avatar_group_id:'group-1'});
      expect(init?.redirect).toBe('error');return response({data:{avatar_item:look}});
    };
    const result=await new HeyGenAvatarProvider(new HeyGenClient('test-key',transport)).create({name:'Fictional fixture',photoUrl:'https://storage.example.test/image.jpg',groupReference:ref},context);
    expect(result.externalId).toBe('look-1');expect(result.metadata.groupId).toBe('group-1');
  });
  it('paginates only public avatars without exposing private account inventory',async()=>{
    let calls=0;const transport:typeof fetch=async(url)=>{calls++;expect(String(url)).toContain('ownership=public');if(calls===2)expect(String(url)).toContain('token=next-token');return response({data:[{...look,id:`look-${calls}`}],has_more:calls===1,next_token:calls===1?'next-token':null});};
    const avatars=await new HeyGenAvatarProvider(new HeyGenClient('test-key',transport)).list(context);expect(avatars).toHaveLength(2);
    expect(avatars[0]?.reference.metadata.public).toBe(true);
  });
  it('normalizes video state and does not request a watermark by default',async()=>{
    const transport:typeof fetch=async(url,init)=>{
      if(init?.method==='POST'){const body=JSON.parse(String(init.body));expect(body.type).toBe('avatar');expect(body.aspect_ratio).toBe('9:16');expect(body.resolution).toBe('1080p');expect(body.watermark).toBeUndefined();return response({data:{video_id:'video-1',status:'waiting'}});}
      expect(url).toBe('https://api.heygen.com/v3/videos/video-1');return response({data:{id:'video-1',status:'completed',video_url:'https://files.heygen.ai/test.mp4'}});
    };
    const provider=new HeyGenVideoProvider(new HeyGenClient('test-key',transport));
    const video=await provider.submit({script:'Fictional script',avatar:ref,voice:{...ref,externalId:'voice-1'},width:1080,height:1920},context);
    expect(await provider.status(video,context)).toEqual({status:'READY',downloadUrl:'https://files.heygen.ai/test.mp4'});
  });
  it('rejects malformed responses, cross-provider references and missing credentials',async()=>{
    expect(()=>new HeyGenClient('')).toThrow('CONFIGURATION_REQUIRED');
    const provider=new HeyGenAvatarProvider(new HeyGenClient('test-key',async()=>response({data:{unexpected:true}})));
    await expect(provider.status(ref,context)).rejects.toThrow('PROVIDER_REJECTED');
    await expect(provider.status({...ref,provider:'other'},context)).rejects.toThrow('INVALID_INPUT');
    await expect(provider.delete({...ref,metadata:{public:true}},context)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('keeps uncertain mutations retryable without implicit repeated calls or leaked responses',async()=>{
    let calls=0;const client=new HeyGenClient('test-key',async()=>{calls++;return new Response('private provider error',{status:503});});
    await expect(new HeyGenAvatarProvider(client).create({photoUrl:'https://storage.example.test/image.jpg',name:'Test'},context)).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(calls).toBe(1);
  });
  it('distinguishes a definitive HTTP rejection from an unreadable accepted response',async()=>{
    const input={name:'Fixture',photoUrl:'https://storage.example.test/fixture.jpg'};
    const denied=new HeyGenAvatarProvider(new HeyGenClient('test',async()=>new Response('private',{status:400})));
    await expect(denied.create(input,context)).rejects.toMatchObject({code:'PROVIDER_REJECTED',definitiveRejection:true});
    const malformed=new HeyGenAvatarProvider(new HeyGenClient('test',async()=>response({unexpected:true})));
    await expect(malformed.create(input,context)).rejects.not.toHaveProperty('definitiveRejection',true);
  });
  it('rejects status replies for a different look or group',async()=>{
    for(const changed of [{...look,id:'other'},{...look,group_id:'other'}]){
      const provider=new HeyGenAvatarProvider(new HeyGenClient('test',async()=>response({data:changed})));
      await expect(provider.status(ref,context)).rejects.toThrow('PROVIDER_REJECTED');
    }
  });
  it('loads one public voice page, encodes cursors and excludes private voices',async()=>{
    const provider=new HeyGenVideoProvider(new HeyGenClient('test',async(url)=>{
      expect(String(url)).toContain('type=public&limit=50&token=next%2Fpage');
      return response({data:[{voice_id:'public-1',name:'Public fixture',type:'public',language:'Russian'},{voice_id:'private-1',name:'Private fixture',type:'private'}],has_more:false,next_token:null});
    }));
    const page=await provider.listPublicVoicePage('next/page',context);expect(page.voices).toHaveLength(1);expect(page.voices[0]?.reference.metadata.public).toBe(true);expect(page.nextCursor).toBeNull();
  });
});
