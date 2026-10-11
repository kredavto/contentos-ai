import {it,expect,vi,beforeEach} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const monitoring=vi.hoisted(()=>({capture:vi.fn(),flush:vi.fn(async()=>true)}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>monitoring}));
import {apiResponse} from '../apps/web/src/server/api';
beforeEach(()=>vi.clearAllMocks());
it('correlates an API server failure without exposing its payload',async()=>{
  const response=await apiResponse(async()=>{throw new Error('secret SQL and provider response');});
  expect(response.status).toBe(500);const body=await response.json();
  expect(JSON.stringify(body)).not.toContain('secret');expect(body.error.correlationId).toBe(response.headers.get('x-request-id'));
  expect(monitoring.capture).toHaveBeenCalledWith(expect.any(Error),{correlationId:body.error.correlationId,code:'INTERNAL_ERROR'});
  expect(monitoring.flush).toHaveBeenCalledWith(1000);
});
it('does not send routine permission and validation failures to error monitoring',async()=>{
  const response=await apiResponse(async()=>{throw new DomainError('NOT_AUTHORIZED',403);});
  expect(response.status).toBe(403);expect(monitoring.capture).not.toHaveBeenCalled();expect(monitoring.flush).not.toHaveBeenCalled();
});
