import { z } from 'zod';
import { DomainError } from '@contentos/types';
import { CircuitBreaker, CircuitOpenError, type CircuitExecutor } from './circuit-breaker';

const scopeSchema = z.object({
  tenantId: z.uuid(), providerKeyId: z.uuid(), revision: z.number().int().min(0).max(2147483647),
}).strict();
export type HeyGenCircuitScope = z.infer<typeof scopeSchema>;
export function parseHeyGenCircuitScope(scope: HeyGenCircuitScope): HeyGenCircuitScope {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) throw new DomainError('INVALID_INPUT');
  return { tenantId: parsed.data.tenantId.toLowerCase(), providerKeyId: parsed.data.providerKeyId.toLowerCase(), revision: parsed.data.revision };
}
type Entry = { circuit: CircuitBreaker; active: number; lastUsedAt: number };

/** Credential-free, bounded process-local state for resolved BYOK identities.
 * A gate never retains an entry: old clients must consult the current registry. */
export class HeyGenCircuitRegistry {
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;
  readonly #maximumEntries: number;
  readonly #maximumTenantEntries: number;
  readonly #idleTtlMs: number;
  readonly #breakerOptions: { failureThreshold: number; failureWindowMs: number; cooldownMs: number; now: () => number };
  #lastTime = 0;

  constructor(options: { maximumEntries?: number; maximumTenantEntries?: number; idleTtlMs?: number; failureThreshold?: number; failureWindowMs?: number; cooldownMs?: number; now?: () => number } = {}) {
    this.#maximumEntries = options.maximumEntries ?? 2048;
    this.#maximumTenantEntries = options.maximumTenantEntries ?? 64;
    this.#idleTtlMs = options.idleTtlMs ?? 1_800_000;
    const failureThreshold = options.failureThreshold ?? 5, failureWindowMs = options.failureWindowMs ?? 600_000, cooldownMs = options.cooldownMs ?? 30_000;
    for (const value of [this.#maximumEntries, this.#maximumTenantEntries, this.#idleTtlMs, failureThreshold, failureWindowMs, cooldownMs]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid circuit registry configuration');
    }
    if (this.#maximumEntries > 2048 || this.#maximumTenantEntries > 64 || this.#idleTtlMs <= Math.max(failureWindowMs, cooldownMs)) throw new RangeError('Invalid circuit registry configuration');
    this.#now = options.now ?? (() => performance.now());
    this.#breakerOptions = { failureThreshold, failureWindowMs, cooldownMs, now: () => this.time() };
  }

  private time() {
    let current: number;
    try { current = this.#now(); } catch { return this.#lastTime; }
    // A faulty clock must not overwrite the outcome of an already dispatched
    // operation in finally; freezing time fails closed for expiry/cooldown.
    if (!Number.isFinite(current) || current < 0) return this.#lastTime;
    this.#lastTime = Math.max(this.#lastTime, current);
    return this.#lastTime;
  }

  gate(scope: HeyGenCircuitScope): CircuitExecutor {
    const parsed = parseHeyGenCircuitScope(scope);
    const key = `${parsed.tenantId}:${parsed.providerKeyId}:${parsed.revision}`;
    // Only canonical non-secret identity is captured; never a credential, client,
    // request operation, failure callback or raw breaker from this registry.
    return { execute: <T>(operation: () => Promise<T>, isFailure: (error: unknown) => boolean) => this.execute(key, operation, isFailure) };
  }

  private async execute<T>(key: string, operation: () => Promise<T>, isFailure: (error: unknown) => boolean): Promise<T> {
    const now = this.time();
    for (const [identity, entry] of this.#entries) {
      if (entry.active === 0 && entry.circuit.isClosed() && now - entry.lastUsedAt >= this.#idleTtlMs) this.#entries.delete(identity);
    }
    let entry = this.#entries.get(key);
    if (!entry) {
      // Never evict a fresh open circuit to admit churn from other identities.
      if (this.#entries.size >= this.#maximumEntries) throw new CircuitOpenError();
      const tenantPrefix = key.slice(0, 37);
      let tenantEntries = 0;
      for (const identity of this.#entries.keys()) if (identity.startsWith(tenantPrefix)) tenantEntries++;
      if (tenantEntries >= this.#maximumTenantEntries) throw new CircuitOpenError();
      entry = { circuit: new CircuitBreaker(this.#breakerOptions), active: 0, lastUsedAt: now };
      this.#entries.set(key, entry);
    }
    entry.active++;
    entry.lastUsedAt = now;
    try { return await entry.circuit.execute(operation, isFailure); }
    finally {
      entry.active--;
      entry.lastUsedAt = this.time();
    }
  }
}

export const heyGenCircuitRegistry = new HeyGenCircuitRegistry();
