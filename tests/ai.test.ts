import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GenerationOrchestrator, type CallRecorder } from '../packages/ai/src/index';
import { OpenAILLMProvider, MockLLMProvider } from '../packages/providers/src/index';
import { DomainError, emptyOnboarding, generationOptionsSchema, scriptSchema, type LLMProvider, type Usage } from '../packages/types/src/index';
const context = {internalId:randomUUID(),tenantId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
const input = {brain:emptyOnboarding('Fictional studio'),options:generationOptionsSchema.parse({}),brandRevision:0};
const output = {hook:'Hook',context:'Context',core:'Core',proof:'Verify evidence',cta:'Read more',factCheckNotes:[]};
const usage:Usage = {model:'test-model',inputUnits:12,outputUnits:24,costMicrounits:null,currency:'USD'};
function recorder() {
  const events:string[]=[];
  const record:CallRecorder={async started(call){events.push(`start:${call}`);},async succeeded(call){events.push(`success:${call}`);},async failed(call){events.push(`failure:${call}`);}};
  return {events,record};
}
describe('bounded structured generation',()=>{
  it('repairs invalid output while recording every metered call',async()=>{
    let calls=0;const provider:LLMProvider={name:'test',async generate(request){calls++;if(calls===2)expect(request.prompt).toContain('failed validation');return {json:calls===1?{hook:'Incomplete'}:output,usage};}};
    const {events,record}=recorder();
    expect(await new GenerationOrchestrator([{provider,model:'test-model'}]).run('GENERATE_SCRIPT',input,context,record)).toEqual(output);
    expect(events).toEqual(['start:1','success:1','start:2','success:2']);
  });
  it('limits invalid output to three attempts and refuses unconfigured operation',async()=>{
    let calls=0;const provider:LLMProvider={name:'test',async generate(){calls++;return {json:null,usage};}};
    await expect(new GenerationOrchestrator([{provider,model:'test-model'}]).run('GENERATE_SCRIPT',input,context,recorder().record)).rejects.toThrow('PROVIDER_REJECTED');
    expect(calls).toBe(3);
    await expect(new GenerationOrchestrator([]).run('GENERATE_SCRIPT',input,context,recorder().record)).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
  it('uses only explicit fallback routes after transport failure',async()=>{
    const failing:LLMProvider={name:'first',async generate(){throw new DomainError('PROVIDER_UNAVAILABLE',503);}};
    const working:LLMProvider={name:'second',async generate(){return {json:output,usage};}};
    const {events,record}=recorder();
    await new GenerationOrchestrator([{provider:failing,model:'one'},{provider:working,model:'two'}]).run('GENERATE_SCRIPT',input,context,record);
    expect(events).toEqual(['start:1','failure:1','start:2','success:2']);
  });
  it('provides explicit schema-valid local fixtures and rejects production mock',async()=>{
    const provider=new MockLLMProvider('test');
    for(const type of ['GENERATE_STRATEGY','GENERATE_IDEAS','GENERATE_SCRIPT'] as const) expect(await new GenerationOrchestrator([{provider,model:'mock-v1'}]).run(type,input,context,recorder().record)).toBeTruthy();
    expect(()=>new MockLLMProvider('production')).toThrow('CONFIGURATION_REQUIRED');
  });
});
describe('OpenAI Responses adapter contract',()=>{
  it('sends server-side strict structured output and preserves usage without fabricated costs',async()=>{
    const fakeFetch:typeof fetch=async(url,init)=>{
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      const body=JSON.parse(String(init?.body));
      expect(body.store).toBe(false);expect(body.model).toBe('test-model');expect(body.text.format.strict).toBe(true);expect(body.text.format.type).toBe('json_schema');
      expect(body.input[0].role).toBe('system');
      return new Response(JSON.stringify({id:'test-response',object:'response',status:'completed',model:'test-model',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:12,output_tokens:24,total_tokens:36}}),{status:200,headers:{'content-type':'application/json'}});
    };
    const provider=new OpenAILLMProvider('test-key-not-real',fakeFetch);
    const result=await provider.generate({system:'Instructions',prompt:'Input',model:'test-model',jsonSchema:{type:'object'}},context);
    expect(scriptSchema.parse(result.json)).toEqual(output);expect(result.usage).toEqual(usage);
  });
  it('normalizes credential errors without leaking provider response',async()=>{
    const fakeFetch:typeof fetch=async()=>new Response(JSON.stringify({error:{message:'secret detail',type:'invalid_request_error'}}),{status:401,headers:{'content-type':'application/json'}});
    await expect(new OpenAILLMProvider('test-key',fakeFetch).generate({system:'x',prompt:'x',model:'x',jsonSchema:{}},context)).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
});
