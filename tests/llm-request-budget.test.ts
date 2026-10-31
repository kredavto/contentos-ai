import { describe, expect, it, vi } from 'vitest';
import { workflowSchemas, performanceOutputSchema, commentReplyOutputSchema, brandReviewSchema, type LLMProvider } from '../packages/types/src/index';
import { OpenAILLMProvider } from '../packages/providers/src/llm';
import { CircuitBreaker } from '../packages/providers/src/circuit-breaker';
import { boundedLlmRequestSnapshot, maximumLlmRequestBytes } from '../packages/providers/src/llm-request-budget';
const context = { internalId: 'test', tenantId: 'test', idempotencyKey: 'test', correlationId: 'test', signal: new AbortController().signal };
const input = { system: 'Instructions', prompt: '', model: 'test-model', jsonSchema: { type: 'object' } as Record<string, unknown> };
const response = () => new Response(JSON.stringify({ id: 'fixture', object: 'response', status: 'completed', model: 'actual-model', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }], usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } }), { headers: { 'content-type': 'application/json' } });
function fixture() {
  const bodies: string[] = [];
  const transport: typeof fetch = async (_url, init) => { bodies.push(String(init?.body)); return response(); };
  return { bodies, provider: new OpenAILLMProvider('test-only-not-real', transport, new CircuitBreaker({ failureThreshold: 1 })) };
}
describe('LLM serialized request admission', () => {
  it('admits exactly the UTF8 byte ceiling and rejects the next byte without dispatch', async () => {
    const { bodies, provider } = fixture();
    await provider.generate(input, context);
    const overhead = Buffer.byteLength(bodies[0]!);
    await provider.generate({ ...input, prompt: 'a'.repeat(maximumLlmRequestBytes - overhead) }, context);
    expect(Buffer.byteLength(bodies[1]!)).toBe(maximumLlmRequestBytes);
    await expect(provider.generate({ ...input, prompt: 'a'.repeat(maximumLlmRequestBytes - overhead + 1) }, context)).rejects.toThrow('INVALID_INPUT');
    expect(bodies).toHaveLength(2);
  });
  it('counts multibyte text, escaping, system instructions, model and schema in the same envelope', async () => {
    const { bodies, provider } = fixture();
    for (const oversized of [
      { ...input, prompt: '😀'.repeat(maximumLlmRequestBytes / 4) },
      { ...input, prompt: '\u0000'.repeat(maximumLlmRequestBytes / 6 | 0) },
      { ...input, system: 'a'.repeat(maximumLlmRequestBytes) },
      { ...input, model: 'a'.repeat(maximumLlmRequestBytes) },
      { ...input, jsonSchema: { description: 'a'.repeat(maximumLlmRequestBytes) } },
      { ...input, prompt: 'a'.repeat(140000), system: 'b'.repeat(140000) },
    ]) await expect(provider.generate(oversized, context)).rejects.toThrow('INVALID_INPUT');
    expect(bodies).toHaveLength(0);
    // Admission denial is local and never opens the provider outage circuit.
    expect((await provider.generate(input, context)).json).toEqual({ ok: true });
    expect(bodies).toHaveLength(1);
  });
  it('rejects cycles and exotic/non-JSON schema values without invoking hooks or leaking details', async () => {
    const { bodies, provider } = fixture();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const hook = vi.fn(() => { throw new Error('private fixture content'); });
    const getter = Object.defineProperty({}, 'type', { enumerable: true, get: hook });
    for (const jsonSchema of [cyclic, { toJSON: hook }, getter, { value: BigInt(1) }, { value: undefined }, { value: NaN }, { value: Infinity }, { value: new Date() }, { value: Symbol('private') }, { value: () => 'private' }]) {
      await expect(provider.generate({ ...input, jsonSchema }, context)).rejects.toMatchObject({ message: 'INVALID_INPUT' });
    }
    expect(hook).not.toHaveBeenCalled(); expect(bodies).toHaveLength(0);
  });
  it('snapshots schema before any SDK await and keeps normal envelope and usage unchanged', async () => {
    const { bodies, provider } = fixture();
    const schema = { type: 'object', properties: { value: { type: 'string' } } };
    const pending = provider.generate({ ...input, jsonSchema: schema }, context);
    schema.properties.value.type = 'a'.repeat(maximumLlmRequestBytes);
    const result = await pending, body = JSON.parse(bodies[0]!);
    expect(body).toEqual({ model: 'test-model', store: false, max_output_tokens: 12000, input: [{ role: 'system', content: 'Instructions' }, { role: 'user', content: '' }], text: { format: { type: 'json_schema', name: 'contentos_workflow', strict: true, schema: { type: 'object', properties: { value: { type: 'string' } } } } } });
    expect(result.usage).toEqual({ model: 'actual-model', inputUnits: 4, outputUnits: 3, costMicrounits: null, currency: 'USD' });
  });
  it('admits all current generated workflow schemas and ordinary null-prototype JSON', async () => {
    const { bodies, provider } = fixture();
    for (const schema of [...Object.values(workflowSchemas), performanceOutputSchema, commentReplyOutputSchema, brandReviewSchema]) {
      await provider.generate({ ...input, jsonSchema: schema.toJSONSchema() as Record<string, unknown> }, context);
    }
    const schema = Object.assign(Object.create(null) as Record<string, unknown>, { type: 'object', properties: { constructor: { type: 'string' } } });
    await provider.generate({ ...input, jsonSchema: schema }, context);
    expect(bodies.length).toBeGreaterThan(8);
    expect(JSON.parse(bodies.at(-1)!).text.format.schema).toEqual(schema);
  });
  it('normalizes invalid runtime envelopes without evaluating accessors', async () => {
    const { bodies, provider } = fixture(), getter = vi.fn(() => { throw new Error('private'); });
    for (const bad of [null, undefined, 1, [], Object.defineProperty({ ...input }, 'model', { get: getter })]) {
      await expect(provider.generate(bad as Parameters<LLMProvider['generate']>[0], context)).rejects.toThrow('INVALID_INPUT');
    }
    expect(getter).not.toHaveBeenCalled(); expect(bodies).toHaveLength(0);
  });
  it('keeps an empty model configuration failure local', async () => {
    const { bodies, provider } = fixture();
    await expect(provider.generate({ ...input, model: '' }, context)).rejects.toThrow('CONFIGURATION_REQUIRED');
    expect(bodies).toHaveLength(0);
  });
  it('bounds nesting and sparse arrays while allowing repeated noncyclic schema objects', () => {
    let nested: Record<string, unknown> = {};
    for (let i = 0; i < 66; i++) nested = { nested };
    expect(() => boundedLlmRequestSnapshot(nested)).toThrow('INVALID_INPUT');
    expect(() => boundedLlmRequestSnapshot({ items: Array(10) })).toThrow('INVALID_INPUT');
    const shared = { type: 'string' }, original = { one: shared, two: shared };
    expect(boundedLlmRequestSnapshot(original)).toEqual(original);
    expect(boundedLlmRequestSnapshot(original).one).not.toBe(shared);
  });
});
