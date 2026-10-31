import {NodeClient,makeNodeTransport,defaultStackParser} from '@sentry/node';
import {z} from 'zod';
import type {ErrorReporter} from '@contentos/types';
const uuid=z.uuid();
const codes=new Set(['INTERNAL_ERROR','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','QUEUE_UNAVAILABLE','CONFIGURATION_REQUIRED','RECONCILIATION_REQUIRED','PUBLISHING_FAILED','SOCIAL_TOKEN_EXPIRED','INVALID_MEDIA','INVALID_INPUT','NOT_AUTHORIZED','NOT_FOUND','CONFLICT','CONSENT_REQUIRED']);
const settings=z.object({
  ERROR_REPORTING_PROVIDER:z.enum(['disabled','sentry']).default('disabled'),
  SENTRY_DSN:z.string().max(2048).optional(),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  SENTRY_RELEASE:z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/).optional(),
});
export function errorReportingConfiguration(source:Record<string,string|undefined>){
  const parsed=settings.safeParse(source);if(!parsed.success)return {status:'CONFIGURATION_REQUIRED' as const};
  if(parsed.data.ERROR_REPORTING_PROVIDER==='disabled')return {status:'DISABLED' as const};
  try{
    const dsn=new URL(parsed.data.SENTRY_DSN??'');
    if(dsn.protocol!=='https:'||!dsn.hostname||!/^\w+$/.test(dsn.username)||dsn.password||dsn.search||dsn.hash||!/^\/(?:[a-zA-Z0-9_-]+\/)*\d+$/.test(dsn.pathname))throw new Error();
    return {status:'CONFIGURED' as const,dsn:dsn.toString(),environment:parsed.data.NODE_ENV,release:parsed.data.SENTRY_RELEASE};
  }catch{return {status:'CONFIGURATION_REQUIRED' as const};}
}
export class SentryErrorReporter implements ErrorReporter{
  private readonly client:NodeClient;
  private windowStart=Date.now();private count=0;
  constructor(configuration:Extract<ReturnType<typeof errorReportingConfiguration>,{status:'CONFIGURED'}>,service:'web'|'worker',transport:ConstructorParameters<typeof NodeClient>[0]['transport']=makeNodeTransport){
    this.client=new NodeClient({dsn:configuration.dsn,environment:configuration.environment,release:configuration.release,transport,transportOptions:{bufferSize:20},stackParser:defaultStackParser,integrations:[],sendClientReports:false,includeServerName:false,beforeSendLog:()=>null,beforeSendMetric:()=>null,dataCollection:{userInfo:false,cookies:false,httpHeaders:false,httpBodies:[],urlQueryParams:false,graphQL:{document:false,variables:false},genAI:{inputs:false,outputs:false},databaseQueryData:false,queues:false,stackFrameVariables:false,frameContextLines:0},maxBreadcrumbs:0,
      beforeSend:event=>{
        const correlation=uuid.safeParse(event.tags?.correlationId),job=uuid.safeParse(event.tags?.jobId);
        if(!correlation.success)return null;
        const code=typeof event.tags?.code==='string'&&codes.has(event.tags.code)?event.tags.code:'INTERNAL_ERROR';
        return {type:undefined,event_id:event.event_id,timestamp:event.timestamp,platform:'node',level:'error',message:code,environment:configuration.environment,...(configuration.release?{release:configuration.release}:{}),tags:{service,code,correlationId:correlation.data,...(job.success?{jobId:job.data}:{})},fingerprint:[service,code]};
      }});
    this.client.init();
  }
  // Original exceptions may contain SQL parameters, provider payloads or credentials.
  // Deliberately send only an explicit code and validated opaque identifiers.
  capture(_error:Error,context:Parameters<ErrorReporter['capture']>[1]){
    try{
      if(!uuid.safeParse(context.correlationId).success)return;
      const now=Date.now();if(now-this.windowStart>=60000){this.windowStart=now;this.count=0;}if(this.count++>=20)return;
      const code=codes.has(context.code)?context.code:'INTERNAL_ERROR';
      this.client.captureEvent({message:code,level:'error',tags:{code,correlationId:context.correlationId,...(uuid.safeParse(context.jobId).success?{jobId:context.jobId}:{})}});
    }catch{/* Telemetry must not change an operation's result. */}
  }
  async flush(timeout=1000){try{return await this.client.flush(Math.max(1,Math.min(timeout,2000)));}catch{return false;}}
}
const disabledReporter:ErrorReporter={capture(){},async flush(){return true;}};
export function errorReporterFromEnvironment(source:Record<string,string|undefined>,service:'web'|'worker'):ErrorReporter{
  const configuration=errorReportingConfiguration(source);
  if(configuration.status!=='CONFIGURED')return disabledReporter;
  try{return new SentryErrorReporter(configuration,service);}catch{return disabledReporter;}
}
