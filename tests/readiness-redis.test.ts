import {createServer,type Socket} from 'node:net';
import {expect,it} from 'vitest';
import {probeRedis} from '../packages/providers/src/redis-readiness';
it('uses PING without INFO, client metadata or application-key commands on a plain unauthenticated connection',async()=>{
 const sockets=new Set<Socket>(),frames:string[]=[];const server=createServer(socket=>{sockets.add(socket);let input='';socket.on('data',chunk=>{input+=chunk.toString();if(input.endsWith('\r\n')){frames.push(input);socket.write(/^\*1\r\n\$4\r\nping\r\n$/i.test(input)?'+PONG\r\n':'-ERR unexpected command\r\n');input='';}});socket.on('close',()=>sockets.delete(socket));});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture address unavailable');
 try{await probeRedis(`redis://127.0.0.1:${address.port}`,AbortSignal.timeout(1500));expect(frames).toHaveLength(1);expect(frames[0]).toMatch(/^\*1\r\n\$4\r\nping\r\n$/i);}
 finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>{server.close(()=>resolve());});}
});
