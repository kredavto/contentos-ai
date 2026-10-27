import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../packages/providers/src/circuit-breaker';
import { OpenAILLMProvider } from '../packages/providers/src/llm';

const unavailable = new Error('transport failure');
const fail = async () => { throw unavailable; };
const counted = () => true;
function setup() {
  let now = 0;
  const circuit = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, failureWindowMs: 500, now: () => now });
  return { circuit, advance: (ms: number) => { now += ms; } };
}
async function open(circuit: CircuitBreaker) {
  await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
  await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
}
describe('provider circuit admission', () => {
  it('opens under serial 90-second timeouts with the default policy', async () => {
    let now = 0;
    const circuit = new CircuitBreaker({ now: () => now });
    for (let i = 0; i < 5; i++) {
      await expect(circuit.execute(async () => { now += 90_000; throw unavailable; }, counted)).rejects.toBe(unavailable);
    }
    await expect(circuit.execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
  });
  it('fails fast without invoking the transport until cooldown and closes after recovery', async () => {
    const { circuit, advance } = setup();
    await open(circuit);
    let calls = 0;
    const success = async () => ++calls;
    await expect(circuit.execute(success, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(0);
    advance(99);
    await expect(circuit.execute(success, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    advance(1);
    expect(await circuit.execute(success, counted)).toBe(1);
    expect(await circuit.execute(success, counted)).toBe(2);
  });
  it('admits exactly one half-open probe and restarts cooldown after its failure', async () => {
    const { circuit, advance } = setup();
    await open(circuit); advance(100);
    let reject!: (error: Error) => void;
    const probe = circuit.execute(() => new Promise((_resolve, fail) => { reject = fail; }), counted);
    await expect(circuit.execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    reject(unavailable); await expect(probe).rejects.toBe(unavailable);
    advance(99);
    await expect(circuit.execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    advance(1); expect(await circuit.execute(async () => 1, counted)).toBe(1);
  });
  it('does not let an old concurrent success close an opened circuit', async () => {
    const { circuit } = setup();
    let resolve!: (value: number) => void;
    const old = circuit.execute(() => new Promise<number>((done) => { resolve = done; }), counted);
    await open(circuit); resolve(4);
    expect(await old).toBe(4);
    await expect(circuit.execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
  });
  it('does not let an old failure reopen a recovered circuit', async () => {
    const { circuit, advance } = setup();
    let reject!: (error: Error) => void;
    const old = circuit.execute(() => new Promise((_done, fail) => { reject = fail; }), counted);
    await open(circuit); advance(100);
    await circuit.execute(async () => 1, counted);
    reject(unavailable); await expect(old).rejects.toBe(unavailable);
    await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
    expect(await circuit.execute(async () => 2, counted)).toBe(2);
  });
  it('does not accumulate failures beyond the window or across successful calls', async () => {
    const { circuit, advance } = setup();
    await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
    advance(500);
    await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
    expect(await circuit.execute(async () => 1, counted)).toBe(1);
    await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
    expect(await circuit.execute(async () => 1, counted)).toBe(1);
  });
  it('ignores local cancellation/rejection and releases a neutral probe without declaring recovery', async () => {
    const { circuit, advance } = setup();
    for (let i = 0; i < 4; i++) await expect(circuit.execute(fail, () => false)).rejects.toBe(unavailable);
    await open(circuit); advance(100);
    await expect(circuit.execute(fail, () => false)).rejects.toBe(unavailable);
    await expect(circuit.execute(fail, counted)).rejects.toBe(unavailable);
    await expect(circuit.execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid configuration %s', (value) => {
    expect(() => new CircuitBreaker({ failureThreshold: value })).toThrow(RangeError);
    expect(() => new CircuitBreaker({ cooldownMs: value })).toThrow(RangeError);
    expect(() => new CircuitBreaker({ failureWindowMs: value })).toThrow(RangeError);
  });
});

const request = { system: 'x', prompt: 'x', model: 'test', jsonSchema: {} };
const context = { internalId: 'test', tenantId: 'test', idempotencyKey: 'test', correlationId: 'test', signal: new AbortController().signal };
describe('OpenAI circuit transport integration', () => {
  it('preserves JSON and usage on recovery and isolates separate provider instances', async () => {
    const { circuit, advance } = setup();
    let failing = true;
    const transport: typeof fetch = async () => failing ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({
      id: 'test-response', object: 'response', status: 'completed', model: 'test',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }],
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    }), { headers: { 'content-type': 'application/json' } });
    const provider = new OpenAILLMProvider('test-only', transport, circuit);
    for (let i = 0; i < 2; i++) await expect(provider.generate(request, context)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    failing = false;
    expect((await new OpenAILLMProvider('another-test-only', transport).generate(request, context)).json).toEqual({ ok: true });
    await expect(provider.generate(request, context)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    advance(100);
    const result = await provider.generate(request, context);
    expect(result.json).toEqual({ ok: true });
    expect(result.usage).toEqual({ model: 'test', inputUnits: 3, outputUnits: 4, costMicrounits: null, currency: 'USD' });
    expect((await provider.generate(request, context)).json).toEqual({ ok: true });
  });
  it.each([408, 429, 500, 503])('opens for repeated HTTP %s without SDK retries', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAILLMProvider('test-only', async () => { calls++; return new Response('{}', { status }); }, circuit);
    for (let i = 0; i < 5; i++) await expect(provider.generate(request, context)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(2);
  });
  it.each([400, 401, 403, 422])('does not count HTTP %s as provider outage', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAILLMProvider('test-only', async () => { calls++; return new Response('{}', { status }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(provider.generate(request, context)).rejects.toThrow(status === 401 || status === 403 ? 'CONFIGURATION_REQUIRED' : 'PROVIDER_REJECTED');
    expect(calls).toBe(4);
  });
  it('opens for network failures and keeps public errors secret-free', async () => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAILLMProvider('test-only', async () => { calls++; throw new Error('sensitive network detail'); }, circuit);
    for (let i = 0; i < 5; i++) await expect(provider.generate(request, context)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(2);
  });
  it('does not poison circuit health with already aborted requests', async () => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAILLMProvider('test-only', async () => { calls++; return new Response('{}', { status: 503 }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(provider.generate(request, { ...context, signal: AbortSignal.abort() })).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(0);
    await expect(provider.generate(request, context)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(1);
  });
});
