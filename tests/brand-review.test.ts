import { describe, expect, it } from 'vitest';
import { emptyOnboarding, generationOptionsSchema, validateBrandReview, type GenerationInput, type BrandReviewOutput, type LLMProvider } from '../packages/types/src/index';
import { GenerationOrchestrator } from '../packages/ai/src/index';
const input: GenerationInput = { brain: { ...emptyOnboarding('Fixture'), rules: [{ name: 'No promises', description: 'Avoid guarantees' }] }, options: generationOptionsSchema.parse({}), brandRevision: 1, previousScript: { hook: 'A claim', context: 'Context', core: 'Core', proof: 'Guaranteed success', cta: 'Read more', factCheckNotes: [] } };
const valid: BrandReviewOutput = { summary: 'Review', findings: [{ category: 'BRAND_RULE', field: 'proof', quote: 'Guaranteed success', ruleIndex: 0, explanation: 'This conflicts with the supplied rule.', suggestion: 'Qualify the wording.' }] };
describe('evidence-bound brand review', () => {
  it('rejects fabricated quotes and invalid rule references', () => {
    expect(validateBrandReview(valid, input).success).toBe(true);
    for (const patch of [{ quote: 'Invented' }, { field: 'hook' }, { ruleIndex: 1 }, { ruleIndex: null }, { category: 'FACT_CHECK' }]) expect(validateBrandReview({ ...valid, findings: [{ ...valid.findings[0], ...patch }] }, input).success).toBe(false);
    expect(validateBrandReview(valid, { ...input, previousScript: undefined }).success).toBe(false);
    expect(validateBrandReview({ ...valid, verified: true }, input).success).toBe(false);
  });
  it('repairs semantic evidence failures and sends immutable source data as untrusted input', async () => {
    let calls = 0;
    const provider: LLMProvider = { name: 'fixture', async generate(request) {
      expect(request.system).toContain('never declares a claim true or false'); expect(request.system).toContain('untrusted');
      calls++; return { json: calls === 1 ? { ...valid, findings: [{ ...valid.findings[0], quote: 'Fabricated' }] } : valid, usage: { model: 'fixture', inputUnits: 1, outputUnits: 1, costMicrounits: null, currency: 'USD' } };
    } };
    const result = await new GenerationOrchestrator([{ provider, model: 'fixture' }]).run('REVIEW_SCRIPT', input, { tenantId: 'fixture', internalId: 'fixture', idempotencyKey: 'fixture', correlationId: 'fixture', signal: AbortSignal.timeout(10000) }, { async started() {}, async succeeded() {}, async failed() {} });
    expect(result).toEqual(valid); expect(calls).toBe(2);
  });
});
