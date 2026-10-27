export class CircuitOpenError extends Error {
  constructor() { super('PROVIDER_UNAVAILABLE'); this.name = 'CircuitOpenError'; }
}

/** Process-local admission control. Never retries or cancels an admitted operation. */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private generation = 0;
  private failures = 0;
  private firstFailureAt = 0;
  private openedAt = 0;

  constructor(private readonly options: {
    failureThreshold?: number;
    failureWindowMs?: number;
    cooldownMs?: number;
    now?: () => number;
  } = {}) {
    for (const value of [options.failureThreshold ?? 5, options.failureWindowMs ?? 600_000, options.cooldownMs ?? 30_000]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid circuit breaker configuration');
    }
  }

  private now() { return (this.options.now ?? (() => performance.now()))(); }

  async execute<T>(operation: () => Promise<T>, isFailure: (error: unknown) => boolean): Promise<T> {
    if (this.state === 'HALF_OPEN') throw new CircuitOpenError();
    if (this.state === 'OPEN') {
      if (this.now() - this.openedAt < (this.options.cooldownMs ?? 30_000)) throw new CircuitOpenError();
      this.state = 'HALF_OPEN';
    }
    const generation = this.generation;
    const probe = this.state === 'HALF_OPEN';
    try {
      const result = await operation();
      if (generation === this.generation) {
        this.failures = 0;
        if (probe) { this.state = 'CLOSED'; this.generation++; }
      }
      return result;
    } catch (error) {
      if (generation === this.generation) {
        if (isFailure(error)) {
          const now = this.now();
          if (!this.failures || now - this.firstFailureAt >= (this.options.failureWindowMs ?? 600_000)) {
            this.failures = 0;
            this.firstFailureAt = now;
          }
          this.failures++;
          if (probe || this.failures >= (this.options.failureThreshold ?? 5)) {
            this.state = 'OPEN'; this.openedAt = now; this.generation++;
          }
        } else if (probe) {
          // Cancellation or a rejected request proves neither outage nor recovery.
          // Release the probe slot without extending the elapsed cooldown.
          this.state = 'OPEN'; this.generation++;
        }
      }
      throw error;
    }
  }
}
