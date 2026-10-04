import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {S3StorageProvider} from '../packages/providers/src/storage';
const context={internalId:randomUUID(),tenantId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal};
describe('S3 private tenant storage',()=>{
  let server:Server,provider:S3StorageProvider,endpoint:string;const objects=new Map<string,Buffer>();
  beforeAll(async()=>{
    server=createServer(async(request,response)=>{
      const path=new URL(request.url!,'http://localhost').pathname;
      expect(request.headers.authorization).toContain('AWS4-HMAC-SHA256');
      if(request.method==='PUT'){const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));objects.set(path,Buffer.concat(chunks));expect(request.headers['x-amz-acl']).toBeUndefined();response.writeHead(200,{ETag:'"test-etag"'});response.end();}
      else if(request.method==='DELETE'){objects.delete(path);response.writeHead(204);response.end();}
      else{const bytes=objects.get(path);if(!bytes){response.writeHead(404);response.end();return;}response.writeHead(200,{'content-type':'image/png','content-length':bytes.length});response.end(request.method==='HEAD'?undefined:bytes);}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Server address missing');endpoint=`http://127.0.0.1:${address.port}`;
    provider=new S3StorageProvider({region:'us-east-1',bucket:'contentos-test',accessKeyId:'test-access',secretAccessKey:'test-secret-not-real',endpoint,forcePathStyle:true,production:false});
  });
  afterAll(async()=>{provider.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  it('uploads, reads and deletes through the real SDK request path',async()=>{
    const key=`${context.tenantId}/${randomUUID()}/photo.png`;const bytes=new Uint8Array([137,80,78,71]);
    await provider.put(key,bytes,'image/png',context);expect(await provider.get(key,100,context)).toEqual(bytes);expect(await provider.head(key,context)).toEqual({bytes:4,mimeType:'image/png'});
    await expect(provider.get(key,2,context)).rejects.toThrow('INVALID_MEDIA');await provider.delete(key,context);await provider.delete(key,context);
  });
  it('signs only a short-lived GET and never exposes secret credentials',async()=>{
    const key=`${context.tenantId}/${randomUUID()}/photo.png`;const signed=new URL(await provider.signedDownload(key,120,context));
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('120');expect(signed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);expect(signed.href).not.toContain('test-secret-not-real');
    await expect(provider.signedDownload(key,901,context)).rejects.toThrow('INVALID_INPUT');
  });
  it('rejects cross-tenant paths, traversal, unsafe media and insecure production endpoints',async()=>{
    await expect(provider.signedDownload(`${randomUUID()}/photo.png`,120,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.signedDownload(`${context.tenantId}/../photo.png`,120,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.put(`${context.tenantId}/photo.html`,new Uint8Array([1]),'text/html',context)).rejects.toThrow('INVALID_MEDIA');
    expect(()=>new S3StorageProvider({region:'us-east-1',bucket:'contentos-test',accessKeyId:'test',secretAccessKey:'test',endpoint,production:true})).toThrow('CONFIGURATION_REQUIRED');
  });
});
