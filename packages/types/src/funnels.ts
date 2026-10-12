import { z } from 'zod';
export const funnelCreateSchema = z.object({ contentItemId: z.uuid(), utmLinkId: z.uuid(), cta: z.string().trim().min(1).max(300), destinationType: z.enum(['URL','WEBSITE','TELEGRAM','LEAD_FORM','MESSENGER']), idempotencyKey: z.uuid() }).strict();
export const funnelPageSchema = z.object({ before: z.uuid().optional() }).strict();
export const funnelChoicesSchema = z.object({ kind: z.enum(['CONTENT','LINK']), search: z.string().trim().max(100).default(''), before: z.uuid().optional() }).strict();
export const funnelMeasurementSchema = z.object({
  from: z.iso.datetime(), to: z.iso.datetime(), clicks: z.number().int().min(0).max(1000000000).nullable(), leads: z.number().int().min(0).max(1000000000).nullable(),
  source: z.string().trim().min(3).max(160), expectedVersion: z.number().int().min(0).max(2147483646), idempotencyKey: z.uuid(),
}).strict().refine(value => Date.parse(value.to) > Date.parse(value.from) && Date.parse(value.to)-Date.parse(value.from) <= 93*86400000, 'Use a positive window up to 93 days').refine(value => value.clicks !== null || value.leads !== null, 'Provide at least one metric');
export type FunnelCreate = z.infer<typeof funnelCreateSchema>;
export type FunnelMeasurement = z.infer<typeof funnelMeasurementSchema>;
export type FunnelChoices = z.infer<typeof funnelChoicesSchema>;
