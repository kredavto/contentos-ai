import {z} from 'zod';
import {normalizedMetricsSchema} from './analytics';

export const performanceDimensions=['TOPICS','HOOKS','FORMATS','DURATION','CTAS','AUDIENCE','OUTLIERS'] as const;
export const performanceMetricSchema=z.enum(['views','impressions','reach','likes','comments','shares','saves','watch_time','average_watch_time','completion_rate','clicks','followers_delta']);
const shortText=z.string().trim().min(1).max(800);
const ids=z.array(z.uuid()).max(50).refine(value=>new Set(value).size===value.length,'Evidence IDs must be distinct');
const timestamp=z.iso.datetime({offset:true});
export const performancePublicationSchema=z.object({
  publicationId:z.uuid(),provider:z.string().min(1).max(100),title:z.string().max(4000),format:z.enum(['POST','SHORT_VIDEO']),
  publishedAt:timestamp,hook:z.string().max(4000).nullable(),cta:z.string().max(4000).nullable(),durationSeconds:z.number().positive().max(86400).nullable(),
  observation:z.object({id:z.uuid(),source:z.enum(['MANUAL','API','DEMO']),sourceNote:z.string().max(500),observedAt:timestamp,metrics:normalizedMetricsSchema}).strict().nullable(),
}).strict();
export const performanceEvidenceSchema=z.object({
  generatedAt:timestamp,windowStart:timestamp,windowEnd:timestamp,totalPublications:z.number().int().nonnegative(),truncated:z.boolean(),
  publications:z.array(performancePublicationSchema).min(1).max(50),
}).strict().superRefine((value,ctx)=>{
  const start=Date.parse(value.windowStart),end=Date.parse(value.windowEnd),generated=Date.parse(value.generatedAt);
  if(start>=end||end>generated)ctx.addIssue({code:'custom',message:'Invalid observation window'});
  if(value.totalPublications<value.publications.length||value.truncated!==(value.totalPublications>value.publications.length))ctx.addIssue({code:'custom',message:'Invalid coverage counts'});
  if(new Set(value.publications.map(item=>item.publicationId)).size!==value.publications.length)ctx.addIssue({code:'custom',message:'Publication IDs must be distinct'});
  const observations=value.publications.flatMap(item=>item.observation?[item.observation.id]:[]);
  if(!observations.length||new Set(observations).size!==observations.length)ctx.addIssue({code:'custom',message:'At least one distinct observation is required'});
  value.publications.forEach((item,index)=>{
    const published=Date.parse(item.publishedAt);
    if(published<start||published>end)ctx.addIssue({code:'custom',path:['publications',index,'publishedAt'],message:'Publication outside window'});
    if(item.observation){
      const observed=Date.parse(item.observation.observedAt);
      if(observed<published||observed>generated)ctx.addIssue({code:'custom',path:['publications',index,'observation'],message:'Observation outside publication lifetime'});
      if(!Object.values(item.observation.metrics).some(metric=>metric!==null))ctx.addIssue({code:'custom',path:['publications',index,'observation'],message:'Observation has no measured metrics'});
    }
  });
});
const patchText=z.string().trim().min(1).max(500);
export const strategyPatchSchema=z.discriminatedUnion('field',[
  z.object({field:z.literal('frequency'),value:patchText}).strict(),
  z.object({field:z.literal('toneOfVoice'),value:patchText}).strict(),
  z.object({field:z.literal('formats'),value:z.array(patchText).min(1).max(10)}).strict(),
  z.object({field:z.literal('ctas'),value:z.array(patchText).min(1).max(10)}).strict(),
  z.object({field:z.literal('hypotheses'),value:z.array(patchText).min(1).max(10)}).strict(),
]);
export const performanceFindingSchema=z.object({dimension:z.enum(performanceDimensions),status:z.enum(['COMPARISON','INSUFFICIENT_DATA']),explanation:shortText,metric:performanceMetricSchema.nullable(),evidenceIds:ids}).strict();
export const strategyRecommendationSchema=z.object({title:shortText,rationale:shortText,hypothesis:shortText,successMetric:performanceMetricSchema,successRule:shortText,horizonDays:z.number().int().min(1).max(90),evidenceIds:ids,patch:strategyPatchSchema}).strict();
export const performanceOutputSchema=z.object({
  summary:z.string().trim().min(1).max(1500),limitations:z.array(shortText).min(1).max(8),
  findings:z.array(performanceFindingSchema).length(7),recommendations:z.array(strategyRecommendationSchema).min(1).max(3),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.findings.map(item=>item.dimension)).size!==performanceDimensions.length)ctx.addIssue({code:'custom',path:['findings'],message:'Every dimension must appear exactly once'});
  value.findings.forEach((item,index)=>{
    if(item.status==='INSUFFICIENT_DATA'&&item.metric!==null)ctx.addIssue({code:'custom',path:['findings',index,'metric'],message:'Insufficient data cannot establish a winning metric'});
    if(item.status==='COMPARISON'&&item.metric===null)ctx.addIssue({code:'custom',path:['findings',index,'metric'],message:'A comparison requires a metric'});
  });
});
export type PerformanceEvidence=z.infer<typeof performanceEvidenceSchema>;
export type PerformanceOutput=z.infer<typeof performanceOutputSchema>;
export type StrategyRecommendation=z.infer<typeof strategyRecommendationSchema>;
export type StrategyPatch=z.infer<typeof strategyPatchSchema>;

/** Context validation is required in addition to JSON validation, including on cached outputs.
 * Comparisons describe observed association, not causation or statistical significance.
 * Audience response is unavailable: intended Brand Brain segments are not observations.
 */
export function validatePerformanceOutput(raw:unknown,rawEvidence:PerformanceEvidence){
  const evidence=performanceEvidenceSchema.parse(rawEvidence);
  return performanceOutputSchema.superRefine((output,ctx)=>{
    const byId=new Map(evidence.publications.flatMap(publication=>publication.observation?[[publication.observation.id,publication] as const]:[]));
    for(const [collection,rows] of [['findings',output.findings],['recommendations',output.recommendations]] as const){
      rows.forEach((row,index)=>{if(row.evidenceIds.some(id=>!byId.has(id)))ctx.addIssue({code:'custom',path:[collection,index,'evidenceIds'],message:'Only snapshot observation IDs may be cited'});});
    }
    output.findings.forEach((finding,index)=>{
      if(finding.status!=='COMPARISON')return;
      const issue=(message:string)=>ctx.addIssue({code:'custom',path:['findings',index],message});
      if(finding.dimension==='AUDIENCE')issue('Measured audience breakdowns are unavailable; use INSUFFICIENT_DATA');
      const rows=finding.evidenceIds.flatMap(id=>{const row=byId.get(id);return row?[row]:[];});
      if(rows.length<(finding.dimension==='OUTLIERS'?5:2))issue('Comparison requires distinct measured publications; outliers require at least five');
      if(new Set(rows.map(row=>row.provider)).size>1||new Set(rows.map(row=>row.observation!.source)).size>1)issue('Comparison must use one platform and one provenance class');
      if(rows.some(row=>finding.metric===null||row.observation!.metrics[finding.metric]===null))issue('Every cited publication must have the comparison metric');
      if(finding.dimension==='HOOKS'&&rows.some(row=>!row.hook?.trim()))issue('Measured publications require known hooks');
      if(finding.dimension==='CTAS'&&rows.some(row=>!row.cta?.trim()))issue('Measured publications require known CTAs');
      if(finding.dimension==='DURATION'&&rows.some(row=>row.durationSeconds===null))issue('Measured publications require known durations');
      const ages=rows.map(row=>Date.parse(row.observation!.observedAt)-Date.parse(row.publishedAt));
      if(ages.length&&Math.max(...ages)-Math.min(...ages)>Math.max(3_600_000,Math.min(...ages)*0.2))issue('Observation exposure ages must differ by at most 20% or one hour');
    });
  }).safeParse(raw);
}
