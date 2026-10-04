import {z} from 'zod';
const text=z.string().min(1).max(4000);
const list=z.array(text).min(1).max(30);
export const platformSchema = z.enum(['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'VK', 'TELEGRAM']);
export const funnelSchema = z.enum(['AWARENESS', 'CONSIDERATION', 'CONVERSION', 'RETENTION']);
export const strategySchema = z.object({
  positioning: text, audienceSegments: list, pains: list, desires: list, objections: list,
  contentPillars: z.array(z.object({ name: text, purpose: text }).strict()).min(1).max(10),
  toneOfVoice: text, formats: list, frequency: text, funnelStages: list, ctas: list, leadMagnets: list,
  hypotheses: list, recommendedChannels: z.array(platformSchema).min(1).max(5),
  plan: z.array(z.object({ day: z.number().int().min(1).max(30), topic: text, platform: platformSchema, format: text, funnelStage: funnelSchema, cta: text }).strict()).length(30),
}).strict().superRefine((value, ctx) => { if (new Set(value.plan.map(day => day.day)).size !== 30) ctx.addIssue({ code: 'custom', path: ['plan'], message: 'Plan must contain every day from 1 to 30 exactly once' }); });
export type StrategyOutput=z.infer<typeof strategySchema>;
