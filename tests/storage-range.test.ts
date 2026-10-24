import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {S3StorageProvider} from '../packages/providers/src/storage';
const context={tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
describe('bounded version-bound S3 range reads',()=>{
  let server:Server,provider:S3StorageProvider,requests=0;
  const bytes=Buffer.from('0123456789abcdef'),etag='"fixture-v1"';
  beforeAll(async()=>{
    server=createServer((request,response)=>{
      requests++;expect(request.headers.authorization).toContain('AWS4-HMAC-SHA256');
      const mode=new URL(request.url!,'http://localhost').pathname.split('/').at(-1);
      if(request.method==='HEAD'){response.writeHead(200,{'Content-Length':mode==='empty'?0:mode==='oversized'?257*1024*1024:bytes.length,...(mode==='missing-etag'?{}:{ETag:etag}),'Content-Type':'video/mp4'});response.end();return;}
      expect(request.headers['if-match']).toBe(etag);
      const match=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range??'');expect(match).toBeTruthy();
      const start=Number(match![1]),end=Number(match![2]),body=bytes.subarray(start,end+1);
      if(mode==='precondition'){response.writeHead(412);response.end();return;}
      response.writeHead(mode==='ignored'?200:206,{'Content-Length':body.length,'Content-Range':`bytes ${start}-${end}/${mode==='wrong-total'?99:bytes.length}`,ETag:mode==='changed'?'"fixture-v2"':etag});response.end(body);
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing address');
    provider=new S3StorageProvider({region:'us-east-1',bucket:'range-fixture',accessKeyId:'fixture',secretAccessKey:'synthetic-not-a-secret',endpoint:`http://127.0.0.1:${address.port}`,forcePathStyle:true,production:false});
  });
  afterAll(async()=>{provider.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  const key=(name:string)=>`${context.tenantId}/videos/${name}`;
  const input={offset:3,length:5,totalBytes:bytes.length,etag};
  it('pins source identity and returns only the requested bytes, including an unaligned final chunk',async()=>{
    expect(await provider.inspectObject(key('valid'),context)).toEqual({bytes:16,etag,mimeType:'video/mp4'});
    expect(await provider.getRange(key('valid'),input,context)).toEqual(new Uint8Array(Buffer.from('34567')));
    expect(await provider.getRange(key('valid'),{...input,offset:15,length:1},context)).toEqual(new Uint8Array(Buffer.from('f')));
  });
  it('rejects empty sources and missing version identities',async()=>{
    for(const mode of ['empty','missing-etag','oversized'])await expect(provider.inspectObject(key(mode),context)).rejects.toThrow('INVALID_MEDIA');
  });
  it('rejects ignored ranges, wrong source size and a changed source version',async()=>{
    for(const mode of ['ignored','wrong-total','changed'])await expect(provider.getRange(key(mode),input,context)).rejects.toThrow('INVALID_MEDIA');
  });
  it('does not retry a failed object-version precondition',async()=>{
    const before=requests;await expect(provider.getRange(key('precondition'),input,context)).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(requests-before).toBe(1);
  });
  it('rejects unsafe ranges, weak validators and foreign tenant keys before transport',async()=>{
    const before=requests;
    for(const change of [{offset:-1},{offset:NaN},{offset:16},{length:0},{length:8*1024*1024+1,totalBytes:16*1024*1024},{length:1.5},{totalBytes:Infinity},{totalBytes:257*1024*1024},{etag:'*'},{etag:'W/"fixture-v1"'},{etag:'"bad\r\nheader"'}])await expect(provider.getRange(key('valid'),{...input,...change},context)).rejects.toThrow('INVALID_INPUT');
    await expect(provider.getRange(`${randomUUID()}/video`,input,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.inspectObject(`${context.tenantId}/../video`,context)).rejects.toThrow('NOT_AUTHORIZED');expect(requests).toBe(before);
  });
});
