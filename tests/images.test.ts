import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {describe,it,expect,vi} from 'vitest';
import {OpenAIImageProvider,MockImageProvider,imageFromEnvironment} from '../packages/providers/src/images';
import {imageGenerationSchema,maxGeneratedImageBytes,ProviderRequestError} from '../packages/types/src/index';
import {normalizeGeneratedImage,normalizePhoto} from '../packages/core/src/photo';
import {parseServerEnvironment} from '../packages/config/src/index';
const input={prompt:'Оригинальная иллюстрация для вымышленного бренда',width:1024 as const,height:1024 as const};
const context=()=>({internalId:randomUUID(),tenantId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const raster=()=>sharp({create:{width:1024,height:1024,channels:3,background:'#d8f2e0'}}).png().toBuffer();
const reply=(data:unknown,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json','x-request-id':'req_fixture',...headers}});
async function unknown(promise:Promise<unknown>){await expect(promise).rejects.toMatchObject({code:'RECONCILIATION_REQUIRED',definitiveRejection:false});}

describe('image generation provider contract',()=>{
  it('sends one fixed-origin request and returns normalized diagnostic reference and metering',async()=>{
    const bytes=await raster(),ctx=context();
    const transport=vi.fn<typeof fetch>(async(url,init)=>{
      expect(url).toBe('https://api.openai.com/v1/images/generations');expect(init?.redirect).toBe('error');
      const headers=new Headers(init?.headers);expect(headers.get('x-client-request-id')).toBe(ctx.correlationId);expect(headers.has('idempotency-key')).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({model:'gpt-image-1.5',prompt:input.prompt,n:1,size:'1024x1024',quality:'medium',output_format:'png',background:'opaque',moderation:'auto'});
      return reply({data:[{b64_json:bytes.toString('base64'),revised_prompt:'not retained'}],output_format:'png',usage:{input_tokens:15,output_tokens:72}});
    });
    const result=await new OpenAIImageProvider('fixture-key','gpt-image-1.5',transport).generate(input,ctx);
    expect(transport).toHaveBeenCalledTimes(1);expect(result.bytes).toEqual(bytes);
    expect(result.reference).toEqual({provider:'openai',internalId:ctx.internalId,externalId:'req_fixture',metadata:{kind:'request',quality:'medium'}});
    expect(result.usage).toEqual({model:'gpt-image-1.5',inputUnits:15,outputUnits:72,costMicrounits:null,currency:'USD'});
  });
  it('keeps missing usage and missing request ids unknown',async()=>{
    const bytes=await raster();
    const provider=new OpenAIImageProvider('fixture','gpt-image-2',async()=>reply({data:[{b64_json:bytes.toString('base64')}]},{'x-request-id':''}));
    const output=await provider.generate(input,context());expect(output.reference).toBeNull();expect(output.usage.inputUnits).toBeNull();expect(output.usage.outputUnits).toBeNull();expect(output.usage.costMicrounits).toBeNull();
  });
  it('fails before transport for invalid dimensions, prompt, context or pre-aborted work',async()=>{
    const transport=vi.fn<typeof fetch>(),provider=new OpenAIImageProvider('fixture','gpt-image-1.5',transport);
    for(const invalid of [{...input,width:1536,height:1536},{...input,prompt:'x'.repeat(4001)},{...input,prompt:'hidden\u202econtrol'},{...input,url:'https://example.test'}] as const)await expect(provider.generate(invalid,context())).rejects.toMatchObject({code:'INVALID_INPUT',definitiveRejection:true});
    await expect(provider.generate(input,{...context(),correlationId:'bad\r\nheader'})).rejects.toThrow('INVALID_INPUT');
    await expect(provider.generate(input,{...context(),signal:AbortSignal.abort()})).rejects.toMatchObject({definitiveRejection:true});expect(transport).not.toHaveBeenCalled();
    expect(imageGenerationSchema.safeParse({...input,prompt:'line one\nline two'}).success).toBe(true);
  });
  it('distinguishes definitive HTTP rejection from uncertain remote outcomes without replay',async()=>{
    for(const [status,code,definitiveRejection] of [[400,'PROVIDER_REJECTED',true],[401,'CONFIGURATION_REQUIRED',true],[403,'CONFIGURATION_REQUIRED',true],[422,'PROVIDER_REJECTED',true],[429,'RATE_LIMITED',true],[408,'RECONCILIATION_REQUIRED',false],[409,'RECONCILIATION_REQUIRED',false],[500,'RECONCILIATION_REQUIRED',false],[502,'RECONCILIATION_REQUIRED',false],[302,'RECONCILIATION_REQUIRED',false]] as const){
      const transport=vi.fn<typeof fetch>(async()=>new Response('private vendor prompt and key',{status}));
      await expect(new OpenAIImageProvider('fixture','gpt-image-1.5',transport).generate(input,context())).rejects.toMatchObject({code,message:code,definitiveRejection});expect(transport).toHaveBeenCalledTimes(1);
    }
    const transport=vi.fn<typeof fetch>(async()=>{throw new Error('private transport details');});await unknown(new OpenAIImageProvider('fixture','gpt-image-1.5',transport).generate(input,context()));expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed, URL-only, multi-image, corrupt base64, non-PNG and dimension-mismatched responses',async()=>{
    const bytes=await raster(),encoded=bytes.toString('base64');
    const badDimensions=Buffer.from(bytes);badDimensions.writeUInt32BE(2,16);
    for(const data of [{data:[]},{data:[{url:'http://127.0.0.1/private'}]},{data:[{b64_json:encoded},{b64_json:encoded}]},{data:[{b64_json:encoded+'\n'}]},{data:[{b64_json:'SGVsbG8='}]},{data:[{b64_json:badDimensions.toString('base64')}]},{data:[{b64_json:encoded}],usage:{input_tokens:-1,output_tokens:1}},{data:[{b64_json:encoded}],output_format:'jpeg'}]){
      const transport=vi.fn<typeof fetch>(async()=>reply(data));await unknown(new OpenAIImageProvider('fixture','gpt-image-1.5',transport).generate(input,context()));expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it('cancels bodies with oversized declared or actual payloads, and rejects HTML and invalid JSON',async()=>{
    let cancelled=0;
    for(const mode of ['declared','stream','html','json']){
      const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(mode==='stream'?new Uint8Array(33*1024*1024):new TextEncoder().encode('private invalid JSON'));},cancel(){cancelled++;}});
      const transport:typeof fetch=async()=>new Response(body,{headers:{'content-type':mode==='html'?'text/html':'application/json',...(mode==='declared'?{'content-length':String(40*1024*1024)}:{})}});
      if(mode==='json'){
        await unknown(new OpenAIImageProvider('fixture','gpt-image-1.5',async()=>new Response('invalid JSON',{headers:{'content-type':'application/json'}})).generate(input,context()));
      }else await unknown(new OpenAIImageProvider('fixture','gpt-image-1.5',transport).generate(input,context()));
    }
    expect(cancelled).toBe(3);
  });
  it('cancels a stalled stream on abort after dispatch and preserves an uncertain outcome',async()=>{
    const controller=new AbortController();let cancelled=false;
    const provider=new OpenAIImageProvider('fixture','gpt-image-1.5',async()=>new Response(new ReadableStream({start(){setTimeout(()=>controller.abort(),10);},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
    await unknown(provider.generate(input,{...context(),signal:controller.signal}));expect(cancelled).toBe(true);
  });
  it('requires explicit credentials/model/feature flag and forbids production fixtures',()=>{
    const env={IMAGE_PROVIDER:'openai',IMAGE_GENERATION_ENABLED:'true',NODE_ENV:'test'};
    expect(imageFromEnvironment(env)).toBeNull();expect(imageFromEnvironment({...env,OPENAI_API_KEY:'fixture',OPENAI_IMAGE_MODEL:'unknown'})).toBeNull();
    expect(imageFromEnvironment({...env,OPENAI_API_KEY:'fixture',OPENAI_IMAGE_MODEL:'gpt-image-1.5'})).toBeInstanceOf(OpenAIImageProvider);
    expect(imageFromEnvironment({...env,IMAGE_GENERATION_ENABLED:'false',OPENAI_API_KEY:'fixture',OPENAI_IMAGE_MODEL:'gpt-image-1.5'})).toBeNull();
    expect(()=>new OpenAIImageProvider('','gpt-image-1.5')).toThrow('CONFIGURATION_REQUIRED');expect(()=>new OpenAIImageProvider('fixture','chatgpt-image-latest')).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>new MockImageProvider('production','/tmp/fixture.png')).toThrow('CONFIGURATION_REQUIRED');expect(()=>new MockImageProvider('test','relative.png')).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>parseServerEnvironment({NODE_ENV:'production',APP_URL:'https://example.test',DATABASE_URL:'postgresql://localhost/db',REDIS_URL:'redis://localhost:6379',IMAGE_PROVIDER:'mock'})).toThrow();
  });
  it('runs an offline fixture through the same real raster decoder without claiming paid usage',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'contentos-image-'));
    try{
      const file=join(directory,'fixture.png');await writeFile(file,await raster());
      const output=await new MockImageProvider('test',file).generate(input,context());
      expect(output.reference.metadata.demo).toBe(true);expect(output.usage.costMicrounits).toBe(0);
      const normalized=await normalizeGeneratedImage(output.bytes,output.mimeType,input);expect(normalized.width).toBe(1024);expect(normalized.height).toBe(1024);expect((await sharp(normalized.bytes).metadata()).format).toBe('jpeg');
    }finally{await rm(directory,{recursive:true,force:true});}
  });
});

describe('generated image storage boundary',()=>{
  it('normalizes real square, landscape and portrait rasters and strips private metadata',async()=>{
    for(const dimensions of [{width:1024,height:1024},{width:1536,height:1024},{width:1024,height:1536}] as const){
      const bytes=await sharp({create:{...dimensions,channels:3,background:'#d8f2e0'}}).png().withMetadata().toBuffer();
      const normalized=await normalizeGeneratedImage(bytes,'image/png',{...input,...dimensions});
      const metadata=await sharp(normalized.bytes).metadata();expect(metadata.width).toBe(dimensions.width);expect(metadata.height).toBe(dimensions.height);expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined();expect(normalized.bytes.length).toBeLessThanOrEqual(3*1024*1024);
    }
  });
  it('rejects incorrect dimensions, MIME, forged PNG headers and orientation changes',async()=>{
    const bytes=await raster();
    await expect(normalizeGeneratedImage(bytes,'image/jpeg',input)).rejects.toThrow('INVALID_MEDIA');
    await expect(normalizeGeneratedImage(bytes,'image/png',{...input,width:1536})).rejects.toThrow('INVALID_MEDIA');
    await expect(normalizeGeneratedImage(bytes.subarray(0,24),'image/png',input)).rejects.toThrow('INVALID_MEDIA');
    const rotated=await sharp({create:{width:1024,height:1536,channels:3,background:'#fff'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    await expect(normalizeGeneratedImage(rotated,'image/jpeg',{...input,height:1536})).rejects.toThrow('INVALID_MEDIA');
    await expect(normalizeGeneratedImage(new Uint8Array(maxGeneratedImageBytes+1),'image/png',input)).rejects.toThrow('INVALID_MEDIA');
  });
  it('keeps the existing photo upload byte limit unchanged',async()=>{
    await expect(normalizePhoto(new Uint8Array(3*1024*1024+1),'image/png')).rejects.toThrow('INVALID_MEDIA');
    expect(new ProviderRequestError('RECONCILIATION_REQUIRED',503,false)).toBeInstanceOf(ProviderRequestError);
  });
});
