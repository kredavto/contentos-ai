import OpenAI from 'openai';
import { CircuitBreaker } from './circuit-breaker';
import { boundedLlmRequestSnapshot } from './llm-request-budget';
import { DomainError, type LLMProvider, type OperationContext, type Usage } from '@contentos/types';

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  constructor(apiKey: string, fetchImplementation?: typeof fetch, private readonly circuit = new CircuitBreaker()) {
    if (!apiKey) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 90_000, ...(fetchImplementation ? { fetch: fetchImplementation } : {}) });
  }
  async generate(input: Parameters<LLMProvider['generate']>[0], context: OperationContext) {
    let source: Record<string, unknown>;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) throw new Error();
      source = {};
      for (const key of ['model', 'system', 'prompt', 'jsonSchema']) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor && !('value' in descriptor)) throw new Error();
        source[key] = descriptor?.value;
      }
    } catch { throw new DomainError('INVALID_INPUT'); }
    if (!source.model) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    if (typeof source.model !== 'string' || typeof source.system !== 'string' || typeof source.prompt !== 'string' || !source.jsonSchema || typeof source.jsonSchema !== 'object' || Array.isArray(source.jsonSchema)) throw new DomainError('INVALID_INPUT');
    // Admission precedes breaker accounting and any SDK/network work. The detached
    // snapshot prevents caller mutation/serialization hooks from bypassing its cap.
    const request = boundedLlmRequestSnapshot({
        model: source.model, store: false, max_output_tokens: 12000,
        input: [{ role: 'system' as const, content: source.system }, { role: 'user' as const, content: source.prompt }],
        text: { format: { type: 'json_schema' as const, name: 'contentos_workflow', strict: true, schema: source.jsonSchema as Record<string, unknown> } },
    });
    try {
      const response = await this.circuit.execute(() => this.client.responses.create(request, { signal: context.signal }), (error) => {
        if (context.signal.aborted) return false;
        return error instanceof OpenAI.APIConnectionError ||
          (error instanceof OpenAI.APIError && (error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500)));
      });
      const usage: Usage = { model: response.model, inputUnits: response.usage?.input_tokens ?? 0, outputUnits: response.usage?.output_tokens ?? 0, costMicrounits: null, currency: 'USD' };
      // Preserve metered usage even for truncated or invalid output. The orchestrator
      // records this call before deciding whether a schema repair is needed.
      let json: unknown = null;
      if (response.status === 'completed') {
        try { json = JSON.parse(response.output_text); } catch { /* Invalid JSON is repaired by the bounded workflow. */ }
      }
      return { json, usage };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) throw new DomainError('CONFIGURATION_REQUIRED', 503);
      if (error instanceof OpenAI.APIError && error.status && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 408) throw new DomainError('PROVIDER_REJECTED', 502);
      throw new DomainError('PROVIDER_UNAVAILABLE', 503);
    }
  }
}

