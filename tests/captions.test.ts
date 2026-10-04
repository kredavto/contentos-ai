import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {OpenAICaptionProvider,captionsFromEnvironment} from '../packages/providers/src/captions';
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
const wav=()=>{const bytes=Buffer.alloc(100);bytes.write('RIFF');bytes.write('WAVE',8);return bytes;};
describe('caption transcription contract',()=>{
  it('requests timestamped segments with bounded WAV and validates the response',async()=>{
    let calls=0;const transport:typeof fetch=async(input,init)=>{if(input==='data:,')return new Response('');calls++;const request=new Request(input,init);expect(request.url).toBe('https://api.openai.com/v1/audio/transcriptions');const form=await request.formData();expect(form.get('model')).toBe('whisper-1');expect(form.get('language')).toBe('ru');expect(form.get('response_format')).toBe('verbose_json');expect(form.get('timestamp_granularities[]')).toBe('segment');expect(form.get('file')).toBeInstanceOf(File);return Response.json({duration:1,text:'Привет',segments:[{start:0,end:1,text:' Привет '}]});};
    const provider=new OpenAICaptionProvider('fixture-key','whisper-1',transport);
    expect(await provider.transcribe({bytes:wav(),mimeType:'audio/wav',language:'ru'},context())).toEqual([{start:0,end:1,text:'Привет'}]);expect(calls).toBe(1);
  });
  it('does not retry uncertain HTTP failures and rejects malformed timelines',async()=>{
    let calls=0;const provider=new OpenAICaptionProvider('fixture-key','whisper-1',async(input)=>{if(input==='data:,')return new Response('');calls++;return Response.json({error:{message:'fixture'}},{status:500});});
    await expect(provider.transcribe({bytes:wav(),mimeType:'audio/wav',language:'ru'},context())).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(calls).toBe(1);
    const malformed=new OpenAICaptionProvider('fixture-key','whisper-1',async()=>Response.json({segments:[{start:2,end:1,text:'bad'}]}));
    await expect(malformed.transcribe({bytes:wav(),mimeType:'audio/wav',language:'ru'},context())).rejects.toThrow('PROVIDER_REJECTED');
  });
  it('fails closed for invalid input and production mocks',async()=>{
    const provider=new OpenAICaptionProvider('fixture-key','whisper-1',async()=>{throw new Error('Must not call');});
    await expect(provider.transcribe({bytes:Buffer.from('bad'),mimeType:'audio/wav',language:'ru'},context())).rejects.toThrow('INVALID_MEDIA');
    expect(()=>captionsFromEnvironment({CAPTION_PROVIDER:'mock',CAPTION_MODEL:'whisper-1',NODE_ENV:'production'})).toThrow('CONFIGURATION_REQUIRED');
  });
});
