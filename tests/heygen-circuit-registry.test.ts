import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeyGenCircuitRegistry, type HeyGenCircuitScope } from '../packages/providers/src/heygen-circuit-registry';
import type { CircuitExecutor } from '../packages/providers/src/circuit-breaker';
import { HeyGenClient } from '../packages/providers/src/heygen';
import { avatarFromKey, voiceCatalogFromKey } from '../packages/providers/src/avatar';
import { videoFromKey } from '../packages/providers/src/video';
import { captionSegmentsSchema } from '../packages/types/src/index';

const scope = (): HeyGenCircuitScope => ({ tenantId: randomUUID(), providerKeyId: randomUUID(), revision: 0 });
const unavailable = new Error('fixture outage');
const fail = async () => { throw unavailable; };
const counted = () => true;
const context = (tenantId: string) => ({ tenantId, internalId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), signal: new AbortController().signal });
function registry(maximumEntries = 4, maximumTenantEntries = 4) {
  let now = 0;
  return { value: new HeyGenCircuitRegistry({ maximumEntries, maximumTenantEntries, failureThreshold: 1, failureWindowMs: 100, cooldownMs: 10, idleTtlMs: 200, now: () => now }), advance: (ms: number) => { now += ms; } };
}
async function open(gate: CircuitExecutor) { await expect(gate.execute(fail, counted)).rejects.toBe(unavailable); }
afterEach(() => vi.unstubAllGlobals());

describe('bounded credential-free HeyGen circuit registry', () => {
  it('shares identity across reconstructed gates but isolates tenant, key and revision', async () => {
    const { value } = registry(); const identity = scope();
    await open(value.gate(identity));
    await expect(value.gate({ ...identity }).execute(async () => 'must not run', counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    for (const other of [{ ...identity, tenantId: randomUUID() }, { ...identity, providerKeyId: randomUUID() }, { ...identity, revision: 1 }]) {
      expect(await value.gate(other).execute(async () => 'isolated', counted)).toBe('isolated');
    }
  });
  it('canonicalizes UUID spelling and snapshots caller identity instead of retaining the object', async () => {
    const { value } = registry(); const identity = scope(); const original = { ...identity };
    const gate = value.gate(identity); identity.revision = 10;
    await open(gate);
    await expect(value.gate({ ...original, tenantId: original.tenantId.toUpperCase(), providerKeyId: original.providerKeyId.toUpperCase() }).execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(await value.gate(identity).execute(async () => 2, counted)).toBe(2);
  });
  it('validates bounded scope, rejects credential-bearing objects and permits int-max revision', () => {
    const { value } = registry(); const identity = scope();
    for (const bad of [{ ...identity, tenantId: 'not-a-uuid' }, { ...identity, providerKeyId: '' }, ...[-1, 0.1, NaN, Infinity, 2147483648].map(revision => ({ ...identity, revision })), { ...identity, apiKey: 'private-test-credential' }]) {
      expect(() => value.gate(bad)).toThrow('INVALID_INPUT');
    }
    expect(value.gate({ ...identity, revision: 2147483647 })).toBeTruthy();
    expect(JSON.stringify(value)).not.toContain('private-test-credential');
  });
  it('retained gates resolve current state after their original closed entry was evicted', async () => {
    const { value, advance } = registry(1); const identity = scope(), other = scope();
    const retained = value.gate(identity);
    expect(await retained.execute(async () => 1, counted)).toBe(1);
    advance(200); expect(await value.gate(other).execute(async () => 2, counted)).toBe(2);
    advance(200); await open(value.gate(identity));
    let invoked = false;
    await expect(retained.execute(async () => { invoked = true; }, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(invoked).toBe(false);
  });
  it('does not evict fresh closed entries or old open entries for capacity churn', async () => {
    const { value, advance } = registry(1); const identity = scope();
    expect(await value.gate(identity).execute(async () => 1, counted)).toBe(1);
    await expect(value.gate(scope()).execute(async () => 2, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await open(value.gate(identity)); advance(10_000);
    for (let i = 0; i < 5; i++) await expect(value.gate(scope()).execute(async () => 2, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    // An expired cooldown permits recovery, not eviction of failed identity state.
    expect(await value.gate(identity).execute(async () => 'recovered', counted)).toBe('recovered');
    advance(200); expect(await value.gate(scope()).execute(async () => 3, counted)).toBe(3);
  });
  it('bounds one tenant without letting it consume all other tenants capacity', async () => {
    const { value } = registry(3, 1); const first = scope();
    await open(value.gate(first));
    await expect(value.gate({ ...first, revision: 1 }).execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(value.gate({ ...first, providerKeyId: randomUUID() }).execute(async () => 1, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(await value.gate(scope()).execute(async () => 2, counted)).toBe(2);
  });
  it('never evicts an in-flight closed request, and measures idle time after completion', async () => {
    const { value, advance } = registry(1); const identity = scope(); let complete!: (value: number) => void;
    const pending = value.gate(identity).execute(() => new Promise<number>(resolve => { complete = resolve; }), counted);
    advance(1000);
    await expect(value.gate(scope()).execute(async () => 2, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    complete(7); expect(await pending).toBe(7);
    advance(199); await expect(value.gate(scope()).execute(async () => 2, counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    advance(1); expect(await value.gate(scope()).execute(async () => 2, counted)).toBe(2);
  });
  it('admits exactly one shared half-open probe and retains it despite TTL/capacity pressure', async () => {
    const { value, advance } = registry(1); const identity = scope(); await open(value.gate(identity)); advance(10);
    let complete!: (value: string) => void;
    const pending = value.gate(identity).execute(() => new Promise<string>(resolve => { complete = resolve; }), counted);
    advance(1000);
    await expect(value.gate(identity).execute(async () => 'second probe', counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(value.gate(scope()).execute(async () => 'new identity', counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    complete('first probe'); expect(await pending).toBe('first probe');
    expect(await value.gate(identity).execute(async () => 'closed', counted)).toBe('closed');
  });
  it('does not let backward or invalid clock readings evict entries or replace admitted results', async () => {
    let now = 100;
    const value = new HeyGenCircuitRegistry({ maximumEntries: 1, failureWindowMs: 100, cooldownMs: 10, idleTtlMs: 200, now: () => { if (now === -1) throw new Error('clock failed'); return now; } });
    const identity = scope();
    expect(await value.gate(identity).execute(async () => { now = NaN; return 'metered result'; }, counted)).toBe('metered result');
    expect(await value.gate(identity).execute(async () => { now = -1; return 'second metered result'; }, counted)).toBe('second metered result');
    now = 0; await expect(value.gate(scope()).execute(async () => 'new', counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    now = 299; await expect(value.gate(scope()).execute(async () => 'new', counted)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    now = 300; expect(await value.gate(scope()).execute(async () => 'new', counted)).toBe('new');
  });
  it('validates capacity, expiry and policy configurations', () => {
    for (const options of [{ maximumEntries: 0 }, { maximumEntries: 2049 }, { maximumTenantEntries: 0 }, { maximumTenantEntries: 65 }, { idleTtlMs: 600_000 }, { cooldownMs: 1_800_000 }, { failureThreshold: 1.5 }]) {
      expect(() => new HeyGenCircuitRegistry(options)).toThrow(RangeError);
    }
  });
});

describe('scoped HeyGen client and BYOK factories', () => {
  it('shares reconstructed clients without retaining or depending on the credential string', async () => {
    const { value } = registry(); const identity = scope(); let calls = 0;
    const transport: typeof fetch = async () => { calls++; return new Response('', { status: 503 }); };
    const first = new HeyGenClient('first-private-fixture', transport, value.gate(identity), identity.tenantId);
    await expect(first.request('/v3/videos', 'POST', captionSegmentsSchema, context(identity.tenantId))).rejects.toThrow('PROVIDER_UNAVAILABLE');
    const reconstructed = new HeyGenClient('second-private-fixture', transport, value.gate(identity), identity.tenantId);
    await expect(reconstructed.request('/v3/videos', 'POST', captionSegmentsSchema, context(identity.tenantId))).rejects.toMatchObject({ code: 'RATE_LIMITED', definitiveRejection: true });
    expect(calls).toBe(1);
    expect(Reflect.ownKeys(value)).toEqual([]);
    expect(JSON.stringify(value.gate(identity))).toBe('{}');
  });
  it('maps capacity denial consistently and rejects mismatched tenants before state allocation', async () => {
    const { value } = registry(1); const identity = scope(); let calls = 0;
    const transport: typeof fetch = async () => { calls++; return Response.json([]); };
    const client = new HeyGenClient('private-fixture', transport, value.gate(identity), identity.tenantId);
    await expect(client.request('/v3/videos', 'POST', captionSegmentsSchema, context(randomUUID()))).rejects.toThrow('NOT_AUTHORIZED');
    expect(calls).toBe(0);
    await value.gate(scope()).execute(async () => 1, counted);
    await expect(client.request('/v3/videos', 'POST', captionSegmentsSchema, context(identity.tenantId))).rejects.toMatchObject({ code: 'RATE_LIMITED', definitiveRejection: true });
    await expect(client.request('/v3/videos', 'GET', captionSegmentsSchema, context(identity.tenantId))).rejects.not.toHaveProperty('definitiveRejection', true);
    expect(calls).toBe(0);
  });
  it('shares all three factory scopes while isolating revision and unscoped legacy clients', async () => {
    const identity = scope(); const ctx = context(identity.tenantId); let calls = 0;
    vi.stubGlobal('fetch', async () => { calls++; return new Response('', { status: 503 }); });
    for (let i = 0; i < 2; i++) await expect(voiceCatalogFromKey('catalog-fixture', identity).listPublicVoicePage(undefined, ctx)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    for (let i = 0; i < 2; i++) await expect(avatarFromKey('avatar-fixture', identity).create({ name: 'Fixture', photoUrl: 'https://example.test/photo.jpg' }, ctx)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    const ref = { provider: 'heygen', internalId: ctx.internalId, externalId: 'fixture', metadata: {} };
    const input = { script: 'Fixture', avatar: ref, voice: ref, width: 1080, height: 1920 };
    await expect(videoFromKey('video-fixture', identity).submit(input, ctx)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(videoFromKey('new-client-fixture', identity).submit(input, ctx)).rejects.toThrow('RATE_LIMITED');
    expect(calls).toBe(5);
    await expect(voiceCatalogFromKey('catalog-fixture', { ...identity, revision: 1 }).listPublicVoicePage(undefined, ctx)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    await expect(videoFromKey('legacy-fixture').submit(input, ctx)).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(calls).toBe(7);
    await expect(voiceCatalogFromKey('catalog-fixture', identity).listPublicVoicePage(undefined, context(randomUUID()))).rejects.toThrow('NOT_AUTHORIZED');
    expect(calls).toBe(7);
  });
});
