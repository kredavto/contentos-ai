import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {SentryErrorReporter,errorReporterFromEnvironment,errorReportingConfiguration} from '../packages/providers/src/error-reporting';
import {reportError} from '../packages/core/src/error-reporting';
import {DomainError} from '../packages/types/src/index';
function fixture(){
  const envelopes:unknown[]=[];
  const configuration=errorReportingConfiguration({ERROR_REPORTING_PROVIDER:'sentry',SENTRY_DSN:'https://fixture@errors.example.test/42',NODE_ENV:'test',SENTRY_RELEASE:'test-123'});
  if(configuration.status!=='CONFIGURED')throw new Error('Fixture configuration');
  const reporter=new SentryErrorReporter(configuration,'worker',()=>({send:async envelope=>{envelopes.push(envelope);return {statusCode:200};},flush:async()=>true}));
  return {envelopes,reporter};
}
describe('isolated error monitoring',()=>{
  it('fails closed for invalid configuration and remains off by default',()=>{
    expect(errorReportingConfiguration({}).status).toBe('DISABLED');
    for(const SENTRY_DSN of ['', 'http://key@example.test/1','https://key:secret@example.test/1','https://example.test/1','https://key@example.test/1?q=secret','https://key@example.test/no-project']){
      expect(errorReportingConfiguration({ERROR_REPORTING_PROVIDER:'sentry',SENTRY_DSN}).status).toBe('CONFIGURATION_REQUIRED');
    }
    expect(errorReportingConfiguration({ERROR_REPORTING_PROVIDER:'sentry',SENTRY_DSN:'https://key@example.test/prefix/123'}).status).toBe('CONFIGURED');
    const reporter=errorReporterFromEnvironment({},'web');expect(()=>reporter.capture(new Error('secret'),{code:'INTERNAL_ERROR',correlationId:randomUUID()})).not.toThrow();
  });
  it('sends a real SDK envelope with only approved metadata and no exception payload',async()=>{
    const {reporter,envelopes}=fixture(),correlationId=randomUUID(),jobId=randomUUID();
    const error=new Error('password=secret customer@example.test SQL provider-body');error.stack='sensitive stack';
    reportError(reporter,error,{correlationId,jobId,code:'PROVIDER_UNAVAILABLE'});expect(await reporter.flush()).toBe(true);
    expect(envelopes).toHaveLength(1);
    const serialized=JSON.stringify(envelopes[0]);
    for(const secret of ['password','customer@example','provider-body','sensitive stack'])expect(serialized).not.toContain(secret);
    expect(serialized).toContain(correlationId);expect(serialized).toContain(jobId);expect(serialized).toContain('PROVIDER_UNAVAILABLE');expect(serialized).toContain('worker');
  });
  it('rejects untrusted identifiers and bounds bursts without leaking arbitrary codes',async()=>{
    const {reporter,envelopes}=fixture();
    reporter.capture(new Error(),{correlationId:'email@example.test',code:'INTERNAL_ERROR'});
    for(let i=0;i<25;i++)reporter.capture(new Error(),{correlationId:randomUUID(),jobId:'token-secret',code:'TOKEN_SECRET'});
    await reporter.flush();expect(envelopes).toHaveLength(20);
    expect(JSON.stringify(envelopes)).not.toContain('TOKEN_SECRET');expect(JSON.stringify(envelopes)).not.toContain('token-secret');
  });
  it('never lets a reporting failure replace domain work',()=>{
    const capture=vi.fn(()=>{throw new Error('Reporter failed');});
    expect(()=>reportError({capture},new DomainError('PROVIDER_UNAVAILABLE'),{correlationId:randomUUID()})).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
  });
  it('isolates telemetry transport rejection',async()=>{
    const configuration=errorReportingConfiguration({ERROR_REPORTING_PROVIDER:'sentry',SENTRY_DSN:'https://fixture@errors.example.test/42'});
    if(configuration.status!=='CONFIGURED')throw new Error('Fixture');
    const reporter=new SentryErrorReporter(configuration,'web',()=>({send:async()=>{throw new Error('offline');},flush:async()=>false}));
    reporter.capture(new Error(),{correlationId:randomUUID(),code:'INTERNAL_ERROR'});
    expect(await reporter.flush()).toBe(false);
  });
});
