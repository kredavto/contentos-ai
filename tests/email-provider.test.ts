import { beforeEach, describe, expect, it, vi } from 'vitest';
const sendMail=vi.fn();
import { SmtpEmailProvider } from '../packages/providers/src/email';
const input={recipient:'fixture@example.test',subject:'Fixture',text:'Fixture'};
const context={internalId:'fixture',tenantId:'',idempotencyKey:'fixture',correlationId:'fixture',signal:new AbortController().signal};
function fixtureProvider(){
  return new SmtpEmailProvider('smtp://localhost:1025','sender@example.test',false,{createTransport:()=>({sendMail,close:()=>{}})});
}
describe('SMTP outcome classification',()=>{
  beforeEach(()=>{sendMail.mockReset();});
  it('returns accepted delivery with stable Message-ID',async()=>{
    sendMail.mockResolvedValue({accepted:[input.recipient],messageId:'fixture'});
    const result=await fixtureProvider().send(input,context);
    expect(result.externalId).toBe('fixture');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({messageId:'<fixture@contentos.local>'}));
  });
  it.each([421,450,550])('identifies explicit SMTP rejection %i as safe to retry',async(responseCode)=>{
    sendMail.mockRejectedValue(Object.assign(new Error('private SMTP response'),{responseCode,command:'DATA'}));
    await expect(fixtureProvider().send(input,context)).rejects.toMatchObject({message:'PROVIDER_UNAVAILABLE',definitiveRejection:true});
  });
  it.each([undefined,250])('keeps missing or successful SMTP response %s uncertain after transport failure',async(responseCode)=>{
    sendMail.mockRejectedValue(Object.assign(new Error('private SMTP response'),{responseCode,command:'DATA'}));
    await expect(fixtureProvider().send(input,context)).rejects.toMatchObject({message:'PROVIDER_UNAVAILABLE',definitiveRejection:false});
  });
  it('does not retry a rejection during QUIT after possible acceptance',async()=>{
    sendMail.mockRejectedValue({responseCode:421,command:'QUIT'});
    await expect(fixtureProvider().send(input,context)).rejects.toMatchObject({definitiveRejection:false});
  });
  it('rejects empty acceptance and aborted calls without uncertain replay',async()=>{
    const provider=fixtureProvider();
    sendMail.mockResolvedValue({accepted:[]});
    await expect(provider.send(input,context)).rejects.toMatchObject({definitiveRejection:true});
    sendMail.mockClear();
    await expect(provider.send(input,{...context,signal:AbortSignal.abort()})).rejects.toMatchObject({definitiveRejection:true});
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('SMTP absolute settlement and safe configuration',()=>{
  it('settles a never-completing send at its absolute deadline and ignores late success',async()=>{
    let complete!:(result:{accepted:string[];messageId:string})=>void;let closes=0;
    const provider=new SmtpEmailProvider('smtp://localhost:1025','sender@example.test',false,{deadlineMs:20,createTransport:()=>({sendMail:()=>new Promise(resolve=>{complete=resolve;}),close:()=>{closes++;}})});
    await expect(provider.send(input,context)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',definitiveRejection:false});
    complete({accepted:[input.recipient],messageId:'late'});await Promise.resolve();expect(closes).toBe(1);
  });
  it('does not open a late socket hook after cancellation and cleans the abort listener',async()=>{
    let captured!:Parameters<NonNullable<import('../packages/providers/src/email').SmtpEmailOptions['createTransport']>>[0];
    const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener');
    const provider=new SmtpEmailProvider('smtp://localhost:1025','sender@example.test',false,{createTransport:options=>{captured=options;return {sendMail:()=>new Promise(()=>{}),close:()=>{}};}});
    const pending=provider.send(input,{...context,signal:controller.signal});controller.abort();
    await expect(pending).rejects.toMatchObject({definitiveRejection:false});
    const callback=vi.fn();captured.getSocket!(captured,callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({code:'PROVIDER_UNAVAILABLE'}));expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
  });
  it('preserves accepted outcome when later cancellation loses the settlement race',async()=>{
    const controller=new AbortController();sendMail.mockResolvedValue({accepted:[input.recipient],messageId:'accepted'});
    const result=await fixtureProvider().send(input,{...context,signal:controller.signal});controller.abort();expect(result.externalId).toBe('accepted');
  });
  it.each(['pool=true','proxy=http%3A%2F%2Flocalhost%3A8888','service=gmail','sendmail=true','jsonTransport=true','streamTransport=true','getSocket=custom','connection=custom','socket=custom','secure=false','debug=true','logger=true'])('rejects unsafe or bypassing URL option %s',query=>{
    expect(()=>new SmtpEmailProvider(`smtp://localhost:1025?${query}`,'sender@example.test')).toThrow('CONFIGURATION_REQUIRED');
  });
  it('keeps auth/TLS settings while enforcing bounded timers and requireTLS',async()=>{
    let settings!:Parameters<NonNullable<import('../packages/providers/src/email').SmtpEmailOptions['createTransport']>>[0];
    const provider=new SmtpEmailProvider('smtps://user%40example.test:p%40ss@localhost:2465?localAddress=127.0.0.1&servername=localhost&tls.minVersion=TLSv1.2&tls.rejectUnauthorized=true&requireTLS=false&connectionTimeout=999999','sender@example.test',true,{createTransport:options=>{settings=options;return {sendMail:async()=>({accepted:[input.recipient],messageId:'fixture'}),close:()=>{}};}});
    await provider.send(input,context);
    expect(settings).toMatchObject({host:'localhost',port:2465,secure:true,pool:false,requireTLS:true,connectionTimeout:5000,localAddress:'127.0.0.1',servername:'localhost',auth:{user:'user@example.test',pass:'p@ss'},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
    expect(settings.getSocket).toBeTypeOf('function');
  });
  it.each([0,-1,0.5,NaN,Infinity,30001])('rejects invalid absolute deadline %s',deadlineMs=>{
    expect(()=>new SmtpEmailProvider('smtp://localhost:1025','sender@example.test',false,{deadlineMs})).toThrow('CONFIGURATION_REQUIRED');
  });
});
