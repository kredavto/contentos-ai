import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captionSegmentsSchema } from '../packages/types/src/index';
import { CircuitBreaker } from '../packages/providers/src/circuit-breaker';
import { HeyGenClient } from '../packages/providers/src/heygen';

const context = () => ({ internalId: randomUUID(), tenantId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), signal: new AbortController().signal });
const schema = captionSegmentsSchema;
function setup() {
  let now = 0;
  return { circuit: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => now }), advance: () => { now += 100; } };
}
describe('HeyGen process-local circuit admission', () => {
  it.each([408, 409, 429, 500, 503])('opens after HTTP %s without changing dispatched mutation outcomes', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const client = new HeyGenClient('fixture-only', async () => { calls++; return new Response('private provider detail', { status }); }, circuit);
    for (let i = 0; i < 2; i++) {
      await expect(client.request('/v3/videos', 'POST', schema, context(), {})).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    }
    await expect(client.request('/v3/videos', 'POST', schema, context(), {})).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, definitiveRejection: true });
    expect(calls).toBe(2);
  });
  it('keeps unknown admitted network outcomes non-definitive, including the failure that opens the circuit', async () => {
    const { circuit } = setup(); let calls = 0;
    const client = new HeyGenClient('fixture-only', async () => { calls++; throw new Error('private network detail'); }, circuit);
    for (let i = 0; i < 2; i++) {
      await expect(client.request('/v3/avatars', 'POST', schema, context(), {})).rejects.not.toHaveProperty('definitiveRejection', true);
    }
    await expect(client.request('/v3/avatars', 'POST', schema, context(), {})).rejects.toMatchObject({ code: 'RATE_LIMITED', definitiveRejection: true });
    expect(calls).toBe(2);
  });
  it.each(['GET', 'DELETE'] as const)('does not classify blocked %s as a definitive remote rejection', async (method) => {
    const { circuit } = setup(); let calls = 0;
    const client = new HeyGenClient('fixture-only', async () => { calls++; return new Response('', { status: 503 }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(client.request('/v3/videos/fixture', method, schema, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(client.request('/v3/videos/fixture', method, schema, context())).rejects.not.toHaveProperty('definitiveRejection', true);
    expect(calls).toBe(2);
  });
  it.each([400, 401, 403, 404, 422])('does not count definitive HTTP %s rejection as an outage', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const client = new HeyGenClient('fixture-only', async () => { calls++; return new Response('', { status }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(client.request('/v3/videos', 'POST', schema, context(), {})).rejects.toMatchObject({ definitiveRejection: true });
    expect(calls).toBe(4);
  });
  it('does not count caller cancellation or malformed successful JSON as an outage', async () => {
    const { circuit } = setup(); let calls = 0; let controller = new AbortController();
    const client = new HeyGenClient('fixture-only', async () => { calls++; controller.abort(); throw new Error('cancelled'); }, circuit);
    for (let i = 0; i < 4; i++) {
      controller = new AbortController();
      await expect(client.request('/v3/videos', 'POST', schema, { ...context(), signal: controller.signal }, {})).rejects.toThrow('PROVIDER_UNAVAILABLE');
    }
    expect(calls).toBe(4);
    const malformed = new HeyGenClient('fixture-only', async () => { calls++; return Response.json({ wrong: true }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(malformed.request('/v3/videos', 'POST', schema, context(), {})).rejects.toThrow('PROVIDER_REJECTED');
    expect(calls).toBe(8);
  });
  it('admits one recovery probe across methods and preserves the original result', async () => {
    const { circuit, advance } = setup(); let calls = 0; let finish!: (response: Response) => void;
    const client = new HeyGenClient('fixture-only', async () => { calls++; if (calls <= 2) return new Response('', { status: 503 }); return new Promise<Response>(resolve => { finish = resolve; }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(client.request('/v3/videos', 'POST', schema, context(), {})).rejects.toThrow('PROVIDER_UNAVAILABLE');
    advance();
    const probe = client.request('/v3/videos/fixture', 'GET', schema, context());
    await expect(client.request('/v3/videos', 'POST', schema, context(), {})).rejects.toThrow('RATE_LIMITED');
    finish(Response.json([{ start: 0, end: 1, text: 'recovered' }]));
    expect(await probe).toEqual([{ start: 0, end: 1, text: 'recovered' }]);
    expect(calls).toBe(3);
  });
  it('isolates separate client instances and retains validation before admission', async () => {
    const { circuit } = setup(); let calls = 0;
    const transport: typeof fetch = async () => { calls++; return new Response('', { status: 503 }); };
    const client = new HeyGenClient('fixture-only', transport, circuit);
    for (let i = 0; i < 2; i++) await expect(client.request('/v3/videos', 'POST', schema, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(client.request('https://other.test', 'POST', schema, context())).rejects.toThrow('INVALID_INPUT');
    await expect(new HeyGenClient('another-fixture', transport).request('/v3/videos', 'POST', schema, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(3);
  });
});
