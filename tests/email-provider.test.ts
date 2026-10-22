import { beforeEach, describe, expect, it, vi } from 'vitest';
const sendMail=vi.fn();
import { SmtpEmailProvider } from '../packages/providers/src/email';
const input={recipient:'fixture@example.test',subject:'Fixture',text:'Fixture'};
const context={internalId:'fixture',tenantId:'',idempotencyKey:'fixture',correlationId:'fixture',signal:new AbortController().signal};
function fixtureProvider(){
  const provider=new SmtpEmailProvider('smtp://localhost:1025','sender@example.test');
  (provider as unknown as {transport:{sendMail:typeof sendMail}}).transport.sendMail=sendMail;
  return provider;
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
