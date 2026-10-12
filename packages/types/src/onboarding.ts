import { z } from 'zod';
const line = z.string().trim().max(2000);
const item = z.object({ name: z.string().trim().min(1).max(200), description: line.default('') }).strict();
export const onboardingSchema = z.object({
  company: z.string().trim().min(1).max(120),
  website: z.union([z.literal(''), z.url().max(1000).refine(value => ['https:', 'http:'].includes(new URL(value).protocol))]),
  niche: line, geography: line, products: z.array(item).max(40), audience: z.array(item).max(40),
  pains: z.array(item).max(40), competitors: z.array(item).max(40), usp: line, voice: line,
  goals: z.array(z.string().trim().min(1).max(300)).max(20),
  platforms: z.array(z.enum(['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'VK', 'TELEGRAM'])).max(5),
  ctas: z.array(item).max(20), leadMagnets: z.array(item).max(20), references: z.array(item).max(20),
}).strict();
export type OnboardingData = z.infer<typeof onboardingSchema>;
export const brandProfileSchema = onboardingSchema.pick({ company: true, website: true, niche: true, geography: true, usp: true, voice: true, goals: true, platforms: true }).extend({
  niche: line.min(1), geography: line.min(1), usp: line.min(1), voice: line.min(1),
  goals: onboardingSchema.shape.goals.min(1), platforms: onboardingSchema.shape.platforms.min(1),
});
export const brandProfileSaveSchema = z.object({ revision: z.number().int().nonnegative(), data: brandProfileSchema }).strict();
export type BrandProfileData = z.infer<typeof brandProfileSchema>;
export type BrandProfileSave = z.infer<typeof brandProfileSaveSchema>;
export const onboardingSaveSchema = z.object({
  revision: z.number().int().nonnegative(), step: z.number().int().min(0).max(14), complete: z.boolean(), data: onboardingSchema,
}).strict().superRefine((input, ctx) => {
  if (!input.complete) return;
  const required = ['niche', 'geography', 'usp', 'voice'] as const;
  for (const key of required) if (!input.data[key]) ctx.addIssue({ code: 'custom', path: ['data', key], message: 'Обязательное поле' });
  for (const key of ['products', 'audience', 'pains', 'goals', 'platforms', 'ctas'] as const)
    if (!input.data[key].length) ctx.addIssue({ code: 'custom', path: ['data', key], message: 'Добавьте хотя бы один пункт' });
});
export type OnboardingSave = z.infer<typeof onboardingSaveSchema>;
export function emptyOnboarding(company: string): OnboardingData {
  return { company, website: '', niche: '', geography: '', products: [], audience: [], pains: [], competitors: [], usp: '', voice: '', goals: [], platforms: [], ctas: [], leadMagnets: [], references: [] };
}
