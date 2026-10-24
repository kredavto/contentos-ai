import {it,expect,vi,beforeEach} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const monitoring=vi.hoisted(()=>({capture:vi.fn(),flush:vi.fn(async()=>true)}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>monitoring}));
import {apiData,apiResponse} from '../apps/web/src/server/api';
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

it('keeps binary and redirect responses unchanged while correlating JSON data',async()=>{
  const response=await apiResponse(async requestId=>apiData(undefined,requestId,202));
  expect(response.status).toBe(202);expect(await response.json()).toEqual({data:null,meta:{requestId:response.headers.get('x-request-id')},error:null});
  const binary=await apiResponse(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/octet-stream'}}));
  expect(new Uint8Array(await binary.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));expect(binary.headers.get('content-type')).toBe('application/octet-stream');
  const redirect=await apiResponse(async()=>new Response(null,{status:303,headers:{location:'/dashboard'}}));
  expect(redirect.status).toBe(303);expect(redirect.headers.get('location')).toBe('/dashboard');expect(await redirect.text()).toBe('');
});
