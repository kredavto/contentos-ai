import {createServer} from 'node:http';
import {expect,it} from 'vitest';
import {S3StorageProvider} from '../packages/providers/src/storage';
it('checks bucket access without uploading or reading user objects and rejects denied access',async()=>{
 const requests:string[]=[];let allowed=true;const server=createServer((request,response)=>{requests.push(request.method+' '+request.url);response.writeHead(allowed?200:403);response.end();});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture port unavailable');
 const storage=new S3StorageProvider({region:'us-east-1',bucket:'readiness-fixture',accessKeyId:'fixture-key',secretAccessKey:'fixture-secret-not-real',endpoint:`http://127.0.0.1:${address.port}`,forcePathStyle:true,production:false});
 try{await storage.ready(new AbortController().signal);expect(requests).toHaveLength(1);expect(requests[0]).toMatch(/^HEAD \/readiness-fixture/);allowed=false;await expect(storage.ready(new AbortController().signal)).rejects.toThrow();expect(requests).toHaveLength(2);}
 finally{storage.close();server.closeAllConnections();await new Promise<void>(resolve=>{server.close(()=>resolve());});}
});
