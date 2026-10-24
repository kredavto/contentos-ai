import {createServer,type Server} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
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
  it('signs a bounded quarantined POST with an independently verified SigV4 signature',async()=>{
    const key=`${context.tenantId}/uploads/${context.internalId}/source`,upload=await provider.signedUpload({key,mimeType:'video/mp4',bytes:1024,expiresSeconds:120},context);
    expect(upload.url).toBe(`${endpoint}/contentos-test`);expect(upload.expiresInSeconds).toBe(120);expect(upload.fields.key).toBe(key);expect(upload.fields.acl).toBeUndefined();
    const policy=JSON.parse(Buffer.from(upload.fields.Policy!,'base64').toString()) as {expiration:string;conditions:unknown[]};
    expect(policy.conditions).toContainEqual(['content-length-range',1024,1024]);expect(policy.conditions).toContainEqual({'Content-Type':'video/mp4'});expect(policy.conditions).toContainEqual({'Cache-Control':'private, no-store'});expect(policy.conditions).toContainEqual({key});
    expect(Date.parse(policy.expiration)-Date.now()).toBeGreaterThan(110000);expect(Date.parse(policy.expiration)-Date.now()).toBeLessThanOrEqual(120000);
    const scope=upload.fields['X-Amz-Credential']!.split('/'),hmac=(key:string|Buffer,value:string)=>createHmac('sha256',key).update(value).digest();
    const signing=hmac(hmac(hmac(hmac('AWS4test-secret-not-real',scope[1]!),scope[2]!),scope[3]!),scope[4]!);
    expect(upload.fields['X-Amz-Signature']).toBe(hmac(signing,upload.fields.Policy!).toString('hex'));expect(JSON.stringify(upload)).not.toContain('test-secret-not-real');
  });
  it('never signs ready objects, arbitrary types, oversized uploads or long leases',async()=>{
    const base={key:`${context.tenantId}/uploads/${context.internalId}/source`,mimeType:'audio/wav' as const,bytes:1024,expiresSeconds:120};
    for(const key of [`${context.tenantId}/uploads/${randomUUID()}/source`,`${context.tenantId}/videos/${randomUUID()}/final.mp4`,`${randomUUID()}/uploads/${randomUUID()}/source`,`${context.tenantId}/uploads/../source`])await expect(provider.signedUpload({...base,key},context)).rejects.toThrow('NOT_AUTHORIZED');
    for(const bytes of [0,11,64*1024*1024+1,NaN,2.5])await expect(provider.signedUpload({...base,bytes},context)).rejects.toThrow('INVALID_INPUT');
    for(const expiresSeconds of [0,301,Infinity,1.5])await expect(provider.signedUpload({...base,expiresSeconds},context)).rejects.toThrow('INVALID_INPUT');
    await expect(provider.signedUpload({...base,mimeType:'text/html' as 'audio/wav'},context)).rejects.toThrow('INVALID_INPUT');
    const signal=AbortSignal.abort();await expect(provider.signedUpload(base,{...context,signal})).rejects.toThrow();
  });
  it('binds configured encryption and KMS key to the signed upload policy',async()=>{
    const encrypted=new S3StorageProvider({region:'us-east-1',bucket:'contentos-test',accessKeyId:'test-access',secretAccessKey:'test-secret-not-real',endpoint,forcePathStyle:true,production:false,encryption:'aws:kms',kmsKeyId:'test-key'});
    try{
      const upload=await encrypted.signedUpload({key:`${context.tenantId}/uploads/${context.internalId}/source`,mimeType:'audio/mpeg',bytes:1024,expiresSeconds:60},context);
      const policy=JSON.parse(Buffer.from(upload.fields.Policy!,'base64').toString()) as {conditions:unknown[]};
      for(const [name,value] of Object.entries({'x-amz-server-side-encryption':'aws:kms','x-amz-server-side-encryption-aws-kms-key-id':'test-key'})){
        expect(upload.fields[name]).toBe(value);expect(policy.conditions).toContainEqual({[name]:value});
      }
    }finally{encrypted.close();}
  });
  it('rejects cross-tenant paths, traversal, unsafe media and insecure production endpoints',async()=>{
    await expect(provider.signedDownload(`${randomUUID()}/photo.png`,120,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.signedDownload(`${context.tenantId}/../photo.png`,120,context)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(provider.put(`${context.tenantId}/photo.html`,new Uint8Array([1]),'text/html',context)).rejects.toThrow('INVALID_MEDIA');
    expect(()=>new S3StorageProvider({region:'us-east-1',bucket:'contentos-test',accessKeyId:'test',secretAccessKey:'test',endpoint,production:true})).toThrow('CONFIGURATION_REQUIRED');
  });
});
