import OpenAI from 'openai';
import { DomainError, type LLMProvider, type OperationContext, type Usage } from '@contentos/types';

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  constructor(apiKey: string, fetchImplementation?: typeof fetch) {
    if (!apiKey) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 90_000, ...(fetchImplementation ? { fetch: fetchImplementation } : {}) });
  }
  async generate(input: Parameters<LLMProvider['generate']>[0], context: OperationContext) {
    if (!input.model) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    try {
      const response = await this.client.responses.create({
        model: input.model, store: false, max_output_tokens: 12000,
        input: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
        text: { format: { type: 'json_schema', name: 'contentos_workflow', strict: true, schema: input.jsonSchema } },
      }, { signal: context.signal });
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
