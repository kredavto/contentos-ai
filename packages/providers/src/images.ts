import {readFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {z} from 'zod';
import {DomainError,ProviderRequestError,imageGenerationSchema,maxGeneratedImageBytes,type ImageProvider,type OperationContext} from '@contentos/types';

// Explicit server choice; aliases whose defaults may drift and retired models are excluded.
export const openAIImageModelSchema=z.enum(['gpt-image-1','gpt-image-1-mini','gpt-image-1.5','gpt-image-2','gpt-image-2-2026-04-21','gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08']);
const maxEncodedBytes=Math.ceil(maxGeneratedImageBytes/3)*4;
const maxResponseBytes=maxEncodedBytes+64*1024;
const responseSchema=z.object({
  data:z.array(z.object({b64_json:z.string().min(4).max(maxEncodedBytes)})).length(1),
  output_format:z.literal('png').optional(),
  usage:z.object({input_tokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),output_tokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).optional(),
});
const uncertain=()=>new ProviderRequestError('RECONCILIATION_REQUIRED',503,false);

/** Limits the decoded HTTP body as well as the declared size. Never follows URLs in JSON. */
async function readResponse(response:Response,signal:AbortSignal){
  if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw uncertain();
  const declared=response.headers.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxResponseBytes))throw uncertain();
  const reader=response.body?.getReader();if(!reader)throw uncertain();
  const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxResponseBytes)throw uncertain();chunks.push(chunk.value);}
    return JSON.parse(Buffer.concat(chunks,size).toString('utf8')) as unknown;
  }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** OpenAI Images API. Deliberately no SDK/network retries or idempotency guarantee. */
export class OpenAIImageProvider implements ImageProvider{
  readonly name='openai';
  readonly currency='USD';
  readonly model:z.infer<typeof openAIImageModelSchema>;
  constructor(private readonly apiKey:string,model:string,private readonly transport:typeof fetch=fetch){
    const parsed=openAIImageModelSchema.safeParse(model);
    if(!apiKey.trim()||!parsed.success)throw new DomainError('CONFIGURATION_REQUIRED',503);
    this.model=parsed.data;
  }
  async generate(raw:Parameters<ImageProvider['generate']>[0],context:OperationContext){
    const parsed=imageGenerationSchema.safeParse(raw);
    if(!parsed.success||!z.uuid().safeParse(context.internalId).success||!z.uuid().safeParse(context.correlationId).success)throw new ProviderRequestError('INVALID_INPUT',400,true);
    if(context.signal.aborted)throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,true);
    const input=parsed.data,signal=AbortSignal.any([context.signal,AbortSignal.timeout(210_000)]);
    let response:Response|undefined;
    try{
      response=await this.transport('https://api.openai.com/v1/images/generations',{
        method:'POST',redirect:'error',signal,
        headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json','X-Client-Request-Id':context.correlationId},
        body:JSON.stringify({model:this.model,prompt:input.prompt,n:1,size:`${input.width}x${input.height}`,quality:'medium',output_format:'png',background:'opaque',moderation:'auto'}),
      });
      if(!response.ok){
        if([401,403].includes(response.status))throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true);
        if(response.status===429)throw new ProviderRequestError('RATE_LIMITED',429,true);
        if(response.status>=400&&response.status<500&&![408,409].includes(response.status))throw new ProviderRequestError('PROVIDER_REJECTED',502,true);
        throw uncertain();
      }
      const data=responseSchema.parse(await readResponse(response,signal));
      const encoded=data.data[0]!.b64_json;
      // Buffer.from alone silently accepts corrupt base64. Require canonical encoding.
      if(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw uncertain();
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.length>maxGeneratedImageBytes||bytes.length<24||bytes.toString('base64')!==encoded||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==input.width||bytes.readUInt32BE(20)!==input.height)throw uncertain();
      signal.throwIfAborted();
      const requestId=response.headers.get('x-request-id');
      return {
        // This is a diagnostic request id, not a retrievable image/job id.
        reference:requestId&&/^[A-Za-z0-9_-]{1,200}$/.test(requestId)?{provider:this.name,internalId:context.internalId,externalId:requestId,metadata:{kind:'request',quality:'medium'}}:null,
        bytes,mimeType:'image/png',usage:{model:this.model,inputUnits:data.usage?.input_tokens??null,outputUnits:data.usage?.output_tokens??null,costMicrounits:null,currency:'USD'},
      };
    }catch(error){
      if(error instanceof ProviderRequestError)throw error;
      // Transport failure, malformed output and cancellation after dispatch can all
      // follow a billable generation. Hide raw vendor payloads and never mark retry-safe.
      throw uncertain();
    }finally{await response?.body?.cancel().catch(()=>{});}
  }
}

/** Offline raster fixture, visibly identified as demo; production cannot enable it. */
export class MockImageProvider implements ImageProvider{
  readonly name='mock-image';
  readonly currency='USD';
  readonly model='offline-image-fixture';
  constructor(environment:string,private readonly fixture:string){if(!['development','test'].includes(environment)||!isAbsolute(fixture))throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async generate(raw:Parameters<ImageProvider['generate']>[0],context:OperationContext){
    if(!imageGenerationSchema.safeParse(raw).success)throw new ProviderRequestError('INVALID_INPUT',400,true);
    context.signal.throwIfAborted();
    try{
      const fixture=this.fixture.replace('{size}',`${raw.width}x${raw.height}`);
      const info=await stat(fixture);if(!info.isFile()||info.size>maxGeneratedImageBytes)throw new DomainError('INVALID_MEDIA',422);
      const bytes=await readFile(fixture,{signal:context.signal});
      if(bytes.length>maxGeneratedImageBytes)throw new DomainError('INVALID_MEDIA',422);
      return {reference:{provider:this.name,internalId:context.internalId,externalId:`mock-image:${context.internalId}`,metadata:{demo:true}},bytes,mimeType:'image/png',usage:{model:'offline-image-fixture',inputUnits:0,outputUnits:0,costMicrounits:0,currency:'USD'}};
    }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('CONFIGURATION_REQUIRED',503);}
  }
}

export function imageFromEnvironment(env:{IMAGE_PROVIDER:string;IMAGE_GENERATION_ENABLED:string;OPENAI_API_KEY?:string;OPENAI_IMAGE_MODEL?:string;NODE_ENV:string;MOCK_IMAGE_FILE?:string}):ImageProvider|null{
  if(env.IMAGE_GENERATION_ENABLED!=='true')return null;
  if(env.IMAGE_PROVIDER==='openai'&&env.OPENAI_API_KEY&&openAIImageModelSchema.safeParse(env.OPENAI_IMAGE_MODEL).success)return new OpenAIImageProvider(env.OPENAI_API_KEY,env.OPENAI_IMAGE_MODEL!);
  if(env.IMAGE_PROVIDER==='mock'&&env.MOCK_IMAGE_FILE)return new MockImageProvider(env.NODE_ENV,env.MOCK_IMAGE_FILE);
  return null;
}
