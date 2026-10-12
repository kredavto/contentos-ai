import { z } from 'zod';
import type { GenerationInput } from './generation';
export const reviewFields = ['hook', 'context', 'core', 'proof', 'cta'] as const;
export const brandReviewSchema = z.object({
  summary: z.string().min(1).max(2000),
  findings: z.array(z.object({
    category: z.enum(['BRAND_RULE', 'TONE', 'FACT_CHECK']),
    field: z.enum(reviewFields), quote: z.string().min(1).max(1000),
    ruleIndex: z.number().int().min(0).max(39).nullable(),
    explanation: z.string().min(1).max(2000), suggestion: z.string().min(1).max(2000),
  }).strict()).max(20),
}).strict();
export type BrandReviewOutput = z.infer<typeof brandReviewSchema>;
/** Evidence references must exist in the immutable input; AI prose is still advisory. */
export function validateBrandReview(value: unknown, input: GenerationInput) {
  return brandReviewSchema.superRefine((output, ctx) => {
    if (!input.previousScript) { ctx.addIssue({ code: 'custom', message: 'Saved script snapshot required' }); return; }
    output.findings.forEach((finding, index) => {
      if (!input.previousScript![finding.field].includes(finding.quote)) ctx.addIssue({ code: 'custom', path: ['findings', index, 'quote'], message: 'Quote must be an exact substring of the selected script field' });
      if (finding.category === 'BRAND_RULE' ? finding.ruleIndex === null || !input.brain.rules?.[finding.ruleIndex] : finding.ruleIndex !== null) ctx.addIssue({ code: 'custom', path: ['findings', index, 'ruleIndex'], message: 'Only BRAND_RULE findings reference an existing zero-based brand rule' });
    });
  }).safeParse(value);
}
