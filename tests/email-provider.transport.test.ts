import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {SMTPServer,type SMTPServerOptions} from 'smtp-server';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {SmtpEmailProvider} from '../packages/providers/src/email';
const input={recipient:'fixture@example.test',subject:'Fixture',text:'No real recipient'};
const context=(signal=new AbortController().signal)=>({internalId:'fixture',tenantId:'',idempotencyKey:'stable-fixture',correlationId:'fixture',signal});
let directory='',key:Buffer,cert:Buffer;
beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'contentos-smtp-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  [key,cert]=await Promise.all([readFile(join(directory,'key.pem')),readFile(join(directory,'cert.pem'))]);
});
afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
async function fixture(options:SMTPServerOptions={}){
  const sockets=new Set<net.Socket>();
  const server=new SMTPServer({logger:false,disabledCommands:['AUTH','STARTTLS'],...options});
  server.on('error',()=>{/* Expected disconnects in cancellation fixtures. */});
  server.server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const port=(server.server.address() as net.AddressInfo).port;
  return {server,sockets,url:`${options.secure?'smtps':'smtp'}://127.0.0.1:${port}`,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(resolve));}};
}
describe('owned SMTP wire connections',()=>{
  it.each(['abort','connection deadline'] as const)('does not connect after late DNS completion following %s',async mode=>{
    let accepted=0;const server=net.createServer(socket=>{accepted++;socket.destroy();});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const original=net.createConnection;let release!:()=>void,raw:net.Socket|undefined;
    const spy=vi.spyOn(net,'createConnection').mockImplementation(((options:net.NetConnectOpts)=>{
      raw=original({...options,lookup:(_hostname,_lookupOptions,callback)=>{release=()=>callback(null,[{address:'127.0.0.1',family:4}]);}});return raw;
    }) as typeof net.createConnection);
    try{
      const controller=new AbortController();
      const provider=new SmtpEmailProvider(`smtp://delayed.example.test:${(server.address() as net.AddressInfo).port}`,'sender@example.test',false,{connectionDeadlineMs:50,deadlineMs:1000});
      const pending=provider.send(input,context(controller.signal));const assertion=expect(pending).rejects.toMatchObject({definitiveRejection:false});
      await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
      if(mode==='abort')controller.abort();await assertion;
      expect(raw?.destroyed).toBe(true);release();raw?.emit('error',new Error('late fixture socket error'));
      await new Promise(resolve=>setTimeout(resolve,60));expect(accepted).toBe(0);
    }finally{spy.mockRestore();raw?.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('sends actual loopback SMTP with stable Message-ID and closes the owned socket',async()=>{
    let message='';
    const smtp=await fixture({onData(stream,_session,callback){stream.on('data',chunk=>{message+=String(chunk);});stream.once('end',()=>callback());}});
    try{
      const provider=new SmtpEmailProvider(smtp.url,'sender@example.test');
      expect((await provider.send(input,context())).externalId).toBe('<stable-fixture@contentos.local>');
      expect(message).toContain('Message-ID: <stable-fixture@contentos.local>');
      await vi.waitFor(()=>expect(smtp.sockets.size).toBe(0));
    }finally{await smtp.close();}
  });
  it('honors a caller deadline during a delayed greeting and tears down TCP',async()=>{
    const smtp=await fixture({onConnect(){/* Never send greeting. */}});
    try{
      const provider=new SmtpEmailProvider(smtp.url,'sender@example.test',false,{deadlineMs:2000});
      await expect(provider.send(input,context(AbortSignal.timeout(150)))).rejects.toMatchObject({definitiveRejection:false});
      await vi.waitFor(()=>expect(smtp.sockets.size).toBe(0));
    }finally{await smtp.close();}
  });
  it('enforces an absolute deadline despite continual incomplete greeting traffic',async()=>{
    const sockets=new Set<net.Socket>();let writes=0;
    const server=net.createServer(socket=>{sockets.add(socket);const timer=setInterval(()=>{writes++;socket.write('2');},20);socket.on('error',()=>{});socket.on('close',()=>{clearInterval(timer);sockets.delete(socket);});});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const provider=new SmtpEmailProvider(`smtp://127.0.0.1:${(server.address() as net.AddressInfo).port}`,'sender@example.test',false,{deadlineMs:180});
      await expect(provider.send(input,context())).rejects.toMatchObject({definitiveRejection:false});
      expect(writes).toBeGreaterThan(2);await vi.waitFor(()=>expect(sockets.size).toBe(0));
    }finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it.each([false,true])('preserves STARTTLS/implicit TLS and aborts the underlying socket (secure=%s)',async secure=>{
    let received!:()=>void;const dataReceived=new Promise<void>(resolve=>{received=resolve;});let closed=0;
    const smtp=await fixture({secure,key,cert,disabledCommands:['AUTH'],onClose(){closed++;},onData(stream){stream.resume();stream.once('end',received);}});
    try{
      const controller=new AbortController();
      const provider=new SmtpEmailProvider(`${smtp.url}?tls.ca=${encodeURIComponent(cert.toString())}&tls.servername=localhost`,'sender@example.test',true,{deadlineMs:2000});
      const pending=provider.send(input,context(controller.signal));const assertion=expect(pending).rejects.toMatchObject({definitiveRejection:false});
      await dataReceived;controller.abort();await assertion;
      // smtp-server removes raw socket listeners during STARTTLS. Check actual
      // server connections and SMTP close, not the stale raw-listener fixture set.
      await vi.waitFor(async()=>{expect(await new Promise<number>((resolve,reject)=>smtp.server.server.getConnections((error,count)=>error?reject(error):resolve(count)))).toBe(0);expect(closed).toBe(1);});
    }finally{await smtp.close();}
  });
  it('isolates cancellation of two concurrent sends on the same provider',async()=>{
    let firstReceived!:()=>void;const firstData=new Promise<void>(resolve=>{firstReceived=resolve;});
    const smtp=await fixture({onData(stream,session,callback){stream.resume();stream.once('end',()=>{if(session.envelope.rcptTo[0]?.address==='slow@example.test')firstReceived();else callback();});}});
    try{
      const controller=new AbortController();const provider=new SmtpEmailProvider(smtp.url,'sender@example.test',false,{deadlineMs:2000});
      const slow=provider.send({...input,recipient:'slow@example.test'},context(controller.signal));const assertion=expect(slow).rejects.toMatchObject({definitiveRejection:false});
      const fast=provider.send(input,{...context(),idempotencyKey:'fast-fixture'});
      await firstData;controller.abort();await assertion;
      expect((await fast).externalId).toBe('<fast-fixture@contentos.local>');
      await vi.waitFor(()=>expect(smtp.sockets.size).toBe(0));
    }finally{await smtp.close();}
  });
  it('retains explicit SMTP rejection as definitive',async()=>{
    const smtp=await fixture({onRcptTo(_address,_session,callback){callback(Object.assign(new Error('fixture rejection'),{responseCode:550}));}});
    try{await expect(new SmtpEmailProvider(smtp.url,'sender@example.test').send(input,context())).rejects.toMatchObject({definitiveRejection:true});}
    finally{await smtp.close();}
  });
  it('preserves authenticated STARTTLS with certificate validation and decoded URL credentials',async()=>{
    let authenticated=false;
    const smtp=await fixture({key,cert,disabledCommands:[],authMethods:['PLAIN'],onAuth(auth,session,callback){
      expect(session.secure).toBe(true);expect(auth.username).toBe('user@example.test');expect(auth.password).toBe('p@ss');authenticated=true;callback(null,{user:'fixture'});
    },onData(stream,_session,callback){stream.resume();stream.once('end',()=>callback());}});
    try{
      const url=new URL(smtp.url);url.username='user@example.test';url.password='p@ss';url.searchParams.set('tls.ca',cert.toString());url.searchParams.set('tls.servername','localhost');url.searchParams.set('authMethod','PLAIN');
      expect((await new SmtpEmailProvider(url.toString(),'sender@example.test',true).send(input,context())).externalId).toBe('<stable-fixture@contentos.local>');
      expect(authenticated).toBe(true);
      await vi.waitFor(async()=>expect(await new Promise<number>((resolve,reject)=>smtp.server.server.getConnections((error,count)=>error?reject(error):resolve(count)))).toBe(0));
    }finally{await smtp.close();}
  });
});
