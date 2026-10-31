import { HeyGenClient } from './heygen';
import { heyGenCircuitRegistry, parseHeyGenCircuitScope, type HeyGenCircuitScope } from './heygen-circuit-registry';

/** The client holds the key only for its caller's lifetime; shared state is key-free. */
export function heyGenClientFromKey(apiKey: string, scope?: HeyGenCircuitScope): HeyGenClient {
  const parsed = scope ? parseHeyGenCircuitScope(scope) : undefined;
  return new HeyGenClient(apiKey, undefined, parsed ? heyGenCircuitRegistry.gate(parsed) : undefined, parsed?.tenantId);
}
