export type WorkerResourceProfile = 'standard' | 'economy';

export function parseWorkerResourceProfile(value: string | undefined): WorkerResourceProfile {
  if (value === undefined || value === 'standard') return 'standard';
  if (value === 'economy') return 'economy';
  throw new Error('Invalid worker resource profile');
}

/** One shared FIFO per worker process, not a distributed lock or a RAM budget.
 * Acquire before processor.run/claim so application leases do not age while waiting.
 * Never release on a timeout: the underlying operation may still be running.
 */
export function createHeavyTaskGate(profile: WorkerResourceProfile) {
  let occupied = false;
  const waiting: Array<() => void> = [];
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (profile === 'standard') return operation();
    if (occupied) await new Promise<void>(resolve => waiting.push(resolve));
    else occupied = true;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next) next(); // Ownership transfers without an unoccupied interval.
      else occupied = false;
    }
  };
}

export interface DrainableWorker {
  pause(doNotWaitActive: boolean): Promise<void>;
  close(): Promise<void>;
}
/** Stop all heavy intake first, then drain accepted callbacks concurrently. */
export async function drainHeavyWorkers(workers: readonly DrainableWorker[]): Promise<void> {
  await Promise.all(workers.map(worker => worker.pause(true)));
  await Promise.all(workers.map(worker => worker.close()));
}
