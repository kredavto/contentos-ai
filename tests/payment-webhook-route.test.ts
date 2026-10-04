import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../packages/types/src/index';
const { receive } = vi.hoisted(() => ({ receive: vi.fn() }));
vi.mock('../apps/web/src/server/services', () => ({ services: () => ({ paymentWebhooks: { receive } }) }));
import { POST } from '../apps/web/src/app/api/webhooks/yookassa/route';
beforeEach(() => { receive.mockReset(); });
describe('payment webhook HTTP receipt boundary', () => {
  it('returns provider-compatible 200 only after durable acceptance', async () => {
    let complete!: () => void;
    receive.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const pending = POST(new Request('https://contentos.example/api/webhooks/yookassa', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({type:'notification',event:'payment.succeeded',object:{id:'fixture'}}) }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    let returned=false;void pending.then(()=>{returned=true;});expect(returned).toBe(false);complete();
    const result=await pending;expect(result.status).toBe(200);expect(await result.json()).toEqual({received:true});expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('does not acknowledge a persistence failure and does not expose details', async () => {
    receive.mockRejectedValue(new Error('fixture-secret-database-error'));
    const result=await POST(new Request('https://contentos.example/api/webhooks/yookassa',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
    expect(result.status).toBeGreaterThanOrEqual(500);expect(await result.text()).not.toContain('fixture-secret');
  });
  it('rejects oversized/non-JSON bodies before receipt insertion', async () => {
    const large=await POST(new Request('https://contentos.example/api/webhooks/yookassa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'x'.repeat(131073)})}));
    expect(large.status).toBe(413);expect(receive).not.toHaveBeenCalled();
    const invalid=await POST(new Request('https://contentos.example/api/webhooks/yookassa',{method:'POST',headers:{'content-type':'text/plain'},body:'hello'}));expect(invalid.status).toBe(415);
  });
  it('returns retryable configuration and rate-limit failures without success', async () => {
    for(const [code,status] of [['CONFIGURATION_REQUIRED',503],['RATE_LIMITED',429]] as const){receive.mockRejectedValue(new DomainError(code,status));const result=await POST(new Request('https://contentos.example/api/webhooks/yookassa',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));expect(result.status).toBe(status);}
  });
});
