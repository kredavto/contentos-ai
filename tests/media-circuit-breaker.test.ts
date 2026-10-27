import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../packages/providers/src/circuit-breaker';
import { OpenAIImageProvider } from '../packages/providers/src/images';
import { OpenAICaptionProvider } from '../packages/providers/src/captions';

const context = () => ({ internalId: randomUUID(), tenantId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), signal: new AbortController().signal });
const imageInput = { prompt: 'An original fictional landscape', width: 1024 as const, height: 1024 as const };
const audio = Buffer.alloc(100); audio.write('RIFF'); audio.write('WAVE', 8);
const captionInput = { bytes: audio, mimeType: 'audio/wav', language: 'en' };
function setup() {
  let now = 0;
  return { circuit: new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => now }), advance: () => { now += 100; } };
}

describe('billable image circuit admission', () => {
  it.each([408, 409, 429, 500, 503])('preserves HTTP %s outcome while subsequent open-circuit denial is definitive', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { calls++; return new Response('private vendor detail', { status }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'RECONCILIATION_REQUIRED', definitiveRejection: status === 429 });
    for (let i = 0; i < 3; i++) await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', definitiveRejection: true });
    expect(calls).toBe(2);
  });
  it('counts network and malformed paid responses without replaying either', async () => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { calls++; if (calls === 1) throw new Error('private'); return Response.json({ data: [] }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED', definitiveRejection: false });
    await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', definitiveRejection: true });
    expect(calls).toBe(2);
  });
  it.each([400, 401, 403, 422])('does not trip on definitive non-outage HTTP %s', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { calls++; return new Response('', { status }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ definitiveRejection: true });
    expect(calls).toBe(4);
  });
  it('retains uncertainty but does not count caller cancellation after dispatch', async () => {
    const { circuit } = setup(); let calls = 0;
    let abort = new AbortController();
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { calls++; abort.abort(); throw new Error('aborted'); }, circuit);
    for (let i = 0; i < 4; i++) {
      abort = new AbortController();
      await expect(provider.generate(imageInput, { ...context(), signal: abort.signal })).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED', definitiveRejection: false });
    }
    expect(calls).toBe(4);
  });
  it('allows one recovered image response and preserves its metering', async () => {
    const { circuit, advance } = setup(); let calls = 0;
    // The adapter checks the header; the separate real raster boundary is covered
    // by images.test.ts and must still validate/decode the complete provider file.
    const bytes = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write('IHDR', 12); bytes.writeUInt32BE(1024, 16); bytes.writeUInt32BE(1024, 20);
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { calls++; return calls <= 2 ? new Response('', { status: 503 }) : Response.json({ data: [{ b64_json: bytes.toString('base64') }], usage: { input_tokens: 2, output_tokens: 3 } }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(provider.generate(imageInput, context())).rejects.toThrow('RECONCILIATION_REQUIRED');
    advance();
    expect((await provider.generate(imageInput, context())).usage).toMatchObject({ inputUnits: 2, outputUnits: 3, costMicrounits: null });
    expect(calls).toBe(3);
  });
  it('uses a window large enough for five sequential 210-second image timeouts', async () => {
    let now = 0;
    const circuit = new CircuitBreaker({ failureWindowMs: 1_200_000, now: () => now });
    const provider = new OpenAIImageProvider('fixture', 'gpt-image-1.5', async () => { now += 210_000; throw new Error('timeout'); }, circuit);
    for (let i = 0; i < 5; i++) await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ definitiveRejection: false });
    await expect(provider.generate(imageInput, context())).rejects.toMatchObject({ definitiveRejection: true, code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('caption circuit admission', () => {
  it('does not count cancelled requests or block a separate provider instance', async () => {
    const { circuit } = setup(); let calls = 0;
    const transport: typeof fetch = async (url) => { if (url === 'data:,') return new Response(''); calls++; return Response.json({}, { status: 503 }); };
    const provider = new OpenAICaptionProvider('fixture', 'whisper-1', transport, circuit);
    for (let i = 0; i < 4; i++) await expect(provider.transcribe(captionInput, { ...context(), signal: AbortSignal.abort() })).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(0);
    for (let i = 0; i < 2; i++) await expect(provider.transcribe(captionInput, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    const other = new OpenAICaptionProvider('other-fixture', 'whisper-1', transport);
    await expect(other.transcribe(captionInput, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(3);
    await expect(provider.transcribe(captionInput, context())).rejects.toMatchObject({ definitiveRejection: true });
    expect(calls).toBe(3);
  });
  it('keeps malformed successful caption responses a validation error, not a transport outage', async () => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAICaptionProvider('fixture', 'whisper-1', async (url) => { if (url === 'data:,') return new Response(''); calls++; return Response.json({ segments: [{ start: 2, end: 1, text: 'bad' }] }); }, circuit);
    for (let i = 0; i < 4; i++) await expect(provider.transcribe(captionInput, context())).rejects.toThrow('PROVIDER_REJECTED');
    expect(calls).toBe(4);
  });
  it.each([408, 429, 500, 503])('opens on repeated HTTP %s and returns definitive pre-dispatch denial', async (status) => {
    const { circuit } = setup(); let calls = 0;
    const provider = new OpenAICaptionProvider('fixture', 'whisper-1', async (url) => { if (url === 'data:,') return new Response(''); calls++; return Response.json({}, { status }); }, circuit);
    for (let i = 0; i < 2; i++) await expect(provider.transcribe(captionInput, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(provider.transcribe(captionInput, context())).rejects.toMatchObject({ code: 'RATE_LIMITED', definitiveRejection: true });
    expect(calls).toBe(2);
  });
  it('recovers with validated segments and keeps credential failures out of the outage counter', async () => {
    const { circuit, advance } = setup(); let status = 401; let calls = 0;
    const provider = new OpenAICaptionProvider('fixture', 'whisper-1', async (url) => { if (url === 'data:,') return new Response(''); calls++; return Response.json(status === 200 ? { segments: [{ start: 0, end: 1, text: 'Recovered' }] } : {}, { status }); }, circuit);
    for (let i = 0; i < 3; i++) await expect(provider.transcribe(captionInput, context())).rejects.toThrow('CONFIGURATION_REQUIRED');
    status = 503;
    for (let i = 0; i < 2; i++) await expect(provider.transcribe(captionInput, context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    status = 200; advance();
    expect(await provider.transcribe(captionInput, context())).toEqual([{ start: 0, end: 1, text: 'Recovered' }]);
    expect(calls).toBe(6);
  });
});
