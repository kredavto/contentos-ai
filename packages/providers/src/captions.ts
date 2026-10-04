import OpenAI,{toFile} from 'openai';
import {z} from 'zod';
import {DomainError,ProviderRequestError,captionSegmentsSchema,type CaptionProvider,type OperationContext} from '@contentos/types';
/** Timestamp-capable transcription. No implicit retries of a billable request. */
export class OpenAICaptionProvider implements CaptionProvider {
  private readonly client:OpenAI;
  constructor(apiKey:string,private readonly model:string,transport?:typeof fetch){
    if(!apiKey||model!=='whisper-1')throw new DomainError('CONFIGURATION_REQUIRED',503);
    this.client=new OpenAI({apiKey,maxRetries:0,timeout:90_000,...(transport?{fetch:transport}:{})});
  }
  async transcribe(input:Parameters<CaptionProvider['transcribe']>[0],context:OperationContext){
    if(input.mimeType!=='audio/wav'||input.bytes.length<44||input.bytes.length>6_000_000||Buffer.from(input.bytes.subarray(0,4)).toString()!=='RIFF'||Buffer.from(input.bytes.subarray(8,12)).toString()!=='WAVE'||!z.string().regex(/^[a-z]{2}$/).safeParse(input.language).success)throw new ProviderRequestError('INVALID_MEDIA',422,true);
    const started=Date.now();let status='FAILED';
    try{
      const output=await this.client.audio.transcriptions.create({file:await toFile(input.bytes,'audio.wav',{type:'audio/wav'}),model:this.model,language:input.language,response_format:'verbose_json',timestamp_granularities:['segment']},{signal:context.signal});
      const parsed=captionSegmentsSchema.safeParse(output.segments?.map(segment=>({start:segment.start,end:segment.end,text:segment.text})));
      if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
      status='SUCCEEDED';return parsed.data;
    }catch(error){
      if(error instanceof DomainError)throw error;
      if(error instanceof OpenAI.APIError&&(error.status===401||error.status===403))throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true);
      if(error instanceof OpenAI.APIError&&error.status&&error.status>=400&&error.status<500&&![408,409,429].includes(error.status))throw new ProviderRequestError('PROVIDER_REJECTED',502,true);
      throw new DomainError('PROVIDER_UNAVAILABLE',503);
    }finally{console.log(JSON.stringify({event:'provider_request',provider:'openai',operation:'transcribe',jobId:context.internalId,requestId:context.correlationId,durationMs:Date.now()-started,status}));}
  }
}
export function captionsFromEnvironment(env:{CAPTION_PROVIDER:string;OPENAI_API_KEY?:string;CAPTION_MODEL:string;NODE_ENV:string}):{provider:CaptionProvider;name:string;model:string}|null {
  if(env.CAPTION_PROVIDER==='openai'&&env.OPENAI_API_KEY)return {provider:new OpenAICaptionProvider(env.OPENAI_API_KEY,env.CAPTION_MODEL),name:'openai',model:env.CAPTION_MODEL};
  if(env.CAPTION_PROVIDER==='mock'){
    if(!['development','test'].includes(env.NODE_ENV))throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {name:'mock-caption',model:'fixture-v1',provider:{transcribe:async()=>[{start:0,end:.8,text:'Демонстрационные субтитры'}]}};
  }
  return null;
}
