import { z } from 'zod';
import { onboardingSchema } from './onboarding';
export const brainCollections = ['products', 'audience', 'pains', 'desires', 'objections', 'competitors', 'positioning', 'pillars', 'offers', 'leadMagnets', 'ctas', 'rules', 'references'] as const;
export const brainCollectionSchema = z.enum(brainCollections);
export type BrainCollection = z.infer<typeof brainCollectionSchema>;
export const brainEntrySchema = z.object({ id: z.uuid().optional(), name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000) }).strict();
export type BrainEntry = z.infer<typeof brainEntrySchema>;
export const brainCollectionSaveSchema = z.object({ revision: z.number().int().nonnegative(), entries: z.array(brainEntrySchema).max(40) }).strict().superRefine((input, ctx) => {
  const ids = input.entries.flatMap(entry => entry.id ? [entry.id] : []);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['entries'], message: 'Duplicate entry ID' });
});
export type BrainCollectionSave = z.infer<typeof brainCollectionSaveSchema>;
const additional = z.array(z.object({ name: z.string().min(1).max(200), description: z.string().max(2000) }).strict()).max(40).optional();
// Optional collections allow persisted job snapshots to keep their original context.
export const brandBrainSchema = onboardingSchema.extend({ desires: additional, objections: additional, positioning: additional, pillars: additional, offers: additional, rules: additional });
