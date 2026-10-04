import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {GenerationOrchestrator,type CallRecorder} from '../packages/ai/src/index';
import {MockLLMProvider} from '../packages/providers/src/index';
import {emptyOnboarding,generationOptionsSchema,normalizedMetricsSchema,performanceDimensions,performanceEvidenceSchema,performanceOutputSchema,strategyPatchSchema,validatePerformanceOutput,type PerformanceEvidence,type PerformanceOutput,type LLMProvider,workflowSchemas} from '../packages/types/src/index';
const context={internalId:randomUUID(),tenantId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
const record:CallRecorder={async started(){},async succeeded(){},async failed(){}};
function evidence(count=2):PerformanceEvidence{
  return {generatedAt:'2026-10-04T12:00:00.000Z',windowStart:'2026-09-04T12:00:00.000Z',windowEnd:'2026-10-04T12:00:00.000Z',totalPublications:count,truncated:false,publications:Array.from({length:count},(_,index)=>({publicationId:randomUUID(),provider:'telegram',title:`Publication ${index}`,format:'POST',publishedAt:'2026-10-01T12:00:00.000Z',hook:'Known hook',cta:'Known CTA',durationSeconds:30,observation:{id:randomUUID(),source:'MANUAL',sourceNote:'Manually observed in provider dashboard',observedAt:'2026-10-02T12:00:00.000Z',metrics:normalizedMetricsSchema.parse({views:index})}}))};
}
function output(data:PerformanceEvidence):PerformanceOutput{
  return {summary:'Only observed performance is described.',limitations:['Manual observations; audience breakdown unavailable.'],findings:performanceDimensions.map(dimension=>({dimension,status:'INSUFFICIENT_DATA',explanation:'Insufficient comparable evidence.',metric:null,evidenceIds:[]})),recommendations:[{title:'Test a CTA',rationale:'A measurement hypothesis, not an established improvement.',hypothesis:'A clearer CTA might increase clicks.',successMetric:'clicks',successRule:'Compare measured clicks after equal exposure time.',horizonDays:14,evidenceIds:[data.publications[0]!.observation!.id],patch:{field:'ctas',value:['Read more']}}]};
}
function compare(data:PerformanceEvidence,dimension:typeof performanceDimensions[number]='TOPICS'){
  const result=output(data),finding=result.findings.find(item=>item.dimension===dimension)!;
  finding.status='COMPARISON';finding.metric='views';finding.evidenceIds=data.publications.map(item=>item.observation!.id);return result;
}
async function strategy(){
  const response=await new MockLLMProvider('test').generate({model:'mock-v1',system:'Fixture',prompt:JSON.stringify({workflow:'GENERATE_STRATEGY',sourceData:{brain:emptyOnboarding('Fictional studio'),options:generationOptionsSchema.parse({}),brandRevision:0}}),jsonSchema:{}},context);
  return workflowSchemas.GENERATE_STRATEGY.parse(response.json);
}
describe('performance evidence boundaries',()=>{
  it('preserves measured zero and rejects a missing comparison metric',()=>{
    const data=evidence();expect(validatePerformanceOutput(compare(data),data).success).toBe(true);
    data.publications[0]!.observation!.metrics.views=null;data.publications[0]!.observation!.metrics.likes=0;
    expect(validatePerformanceOutput(compare(data),data).success).toBe(false);
  });
  it('requires all seven distinct dimensions',()=>{
    const data=evidence(),result=output(data);result.findings[1]=result.findings[0]!;
    expect(performanceOutputSchema.safeParse(result).success).toBe(false);
  });
  it('rejects unknown citations in findings and recommendations, including publication IDs',()=>{
    const data=evidence(),result=compare(data);result.findings[0]!.evidenceIds[0]=data.publications[0]!.publicationId;
    expect(validatePerformanceOutput(result,data).success).toBe(false);
    const valid=output(data);valid.recommendations[0]!.evidenceIds=[randomUUID()];expect(validatePerformanceOutput(valid,data).success).toBe(false);
  });
  it('cannot multiply one observation into a comparison sample',()=>{
    const data=evidence(1),result=compare(data);result.findings[0]!.evidenceIds.push(result.findings[0]!.evidenceIds[0]!);
    expect(validatePerformanceOutput(result,data).success).toBe(false);
    expect(validatePerformanceOutput(compare(data),data).success).toBe(false);
  });
  it('rejects mixed platforms and source classes',()=>{
    const data=evidence();data.publications[1]!.provider='youtube';expect(validatePerformanceOutput(compare(data),data).success).toBe(false);
    data.publications[1]!.provider='telegram';data.publications[1]!.observation!.source='DEMO';expect(validatePerformanceOutput(compare(data),data).success).toBe(false);
  });
  it('rejects incompatible observation ages while allowing the documented tolerance boundary',()=>{
    const data=evidence();data.publications[1]!.observation!.observedAt='2026-10-02T16:48:00.000Z';expect(validatePerformanceOutput(compare(data),data).success).toBe(true);
    data.publications[1]!.observation!.observedAt='2026-10-02T16:48:00.001Z';expect(validatePerformanceOutput(compare(data),data).success).toBe(false);
  });
  it.each(['HOOKS','CTAS','DURATION'] as const)('requires measured attributes for %s',dimension=>{
    const data=evidence();const row=data.publications[0]!;
    if(dimension==='HOOKS')row.hook=null;else if(dimension==='CTAS')row.cta=null;else row.durationSeconds=null;
    expect(validatePerformanceOutput(compare(data,dimension),data).success).toBe(false);
  });
  it('requires five publications for descriptive outlier comparisons',()=>{
    const small=evidence(4);expect(validatePerformanceOutput(compare(small,'OUTLIERS'),small).success).toBe(false);
    const enough=evidence(5);expect(validatePerformanceOutput(compare(enough,'OUTLIERS'),enough).success).toBe(true);
  });
  it('never treats intended audience as measured audience response',()=>{
    const data=evidence(5);expect(validatePerformanceOutput(compare(data,'AUDIENCE'),data).success).toBe(false);
    expect(validatePerformanceOutput(output(data),data).success).toBe(true);
  });
  it('rejects future, pre-publication and empty observations plus wrong coverage counts',()=>{
    const data=evidence();data.publications[0]!.observation!.observedAt='2026-10-05T12:00:00.000Z';expect(performanceEvidenceSchema.safeParse(data).success).toBe(false);
    data.publications[0]!.observation!.observedAt='2026-09-30T12:00:00.000Z';expect(performanceEvidenceSchema.safeParse(data).success).toBe(false);
    data.publications[0]!.observation!.observedAt='2026-10-02T12:00:00.000Z';data.publications[0]!.observation!.metrics=normalizedMetricsSchema.parse({});expect(performanceEvidenceSchema.safeParse(data).success).toBe(false);
    const truncated=evidence();truncated.totalPublications=10;expect(performanceEvidenceSchema.safeParse(truncated).success).toBe(false);truncated.truncated=true;expect(performanceEvidenceSchema.safeParse(truncated).success).toBe(true);
  });
  it('does not accept secret or private storage fields in the evidence boundary',()=>{
    const data=evidence();expect(performanceEvidenceSchema.safeParse({...data,token:'not-a-real-token'}).success).toBe(false);
    expect(performanceEvidenceSchema.safeParse({...data,publications:[{...data.publications[0],finalKey:'private/key'}]}).success).toBe(false);
  });
  it('permits only bounded typed strategy fields and exports a strict JSON object schema',()=>{
    expect(strategyPatchSchema.safeParse({field:'brandBrain',value:'overwrite'}).success).toBe(false);
    expect(strategyPatchSchema.safeParse({field:'frequency',value:['daily']}).success).toBe(false);
    const schema=performanceOutputSchema.toJSONSchema();expect(schema.type).toBe('object');expect(schema.additionalProperties).toBe(false);
  });
});
describe('metered performance analysis',()=>{
  it('runs an explicitly labeled local fixture through the same evidence validation',async()=>{
    const data=evidence(),result=await new GenerationOrchestrator([{provider:new MockLLMProvider('test'),model:'mock-v1'}]).analyzePerformance(data,await strategy(),context,record);
    expect(result.summary).toContain('[ДЕМО]');expect(validatePerformanceOutput(result,data).success).toBe(true);
  });
  it('repairs structurally valid but ungrounded output and records both paid responses',async()=>{
    const data=evidence(),valid=output(data),invalid=structuredClone(valid);invalid.recommendations[0]!.evidenceIds=[randomUUID()];
    let calls=0;const events:string[]=[];
    const provider:LLMProvider={name:'fixture',async generate(request){calls++;if(calls===2)expect(request.prompt).toContain('Only snapshot observation IDs');expect(request.system).toContain('AUDIENCE must be INSUFFICIENT_DATA');return {json:calls===1?invalid:valid,usage:{model:'fixture',inputUnits:10,outputUnits:20,costMicrounits:null,currency:'USD'}};}};
    const recorder:CallRecorder={async started(call){events.push(`start:${call}`);},async succeeded(call){events.push(`success:${call}`);},async failed(call){events.push(`failed:${call}`);}};
    expect(await new GenerationOrchestrator([{provider,model:'fixture'}]).analyzePerformance(data,await strategy(),context,recorder)).toEqual(valid);
    expect(events).toEqual(['start:1','success:1','start:2','success:2']);
  });
  it('rejects repeatedly ungrounded output after three attempts',async()=>{
    const data=evidence(),invalid=compare(data,'AUDIENCE');let calls=0;
    const provider:LLMProvider={name:'fixture',async generate(){calls++;return {json:invalid,usage:{model:'fixture',inputUnits:1,outputUnits:1,costMicrounits:null,currency:'USD'}};}};
    await expect(new GenerationOrchestrator([{provider,model:'fixture'}]).analyzePerformance(data,await strategy(),context,record)).rejects.toThrow('PROVIDER_REJECTED');expect(calls).toBe(3);
  });
  it('fails closed without a configured provider and validates evidence before any external call',async()=>{
    const data=evidence(),currentStrategy=await strategy();await expect(new GenerationOrchestrator([]).analyzePerformance(data,currentStrategy,context,record)).rejects.toThrow('CONFIGURATION_REQUIRED');
    let calls=0;const provider:LLMProvider={name:'fixture',async generate(){calls++;throw new Error('Must not call');}};
    data.totalPublications=0;await expect(new GenerationOrchestrator([{provider,model:'fixture'}]).analyzePerformance(data,currentStrategy,context,record)).rejects.toThrow();expect(calls).toBe(0);
  });
});
