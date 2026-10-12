import { z } from 'zod';
const clean = (max: number) => z.string().trim().max(max).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), 'Control characters are not allowed');
export const utmFieldsSchema = z.object({
  name: clean(120).refine(value => value.length > 0),
  destinationUrl: clean(2048).refine(value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !/\s/u.test(value); } catch { return false; } }, 'Use an absolute HTTP(S) URL without credentials').transform(value => new URL(value).toString()),
  source: clean(100).refine(value => value.length > 0), medium: clean(100).refine(value => value.length > 0), campaign: clean(100).refine(value => value.length > 0),
  term: clean(100).default(''), content: clean(100).default(''),
}).strict();
export const utmCreateSchema = utmFieldsSchema.extend({ idempotencyKey: z.uuid() });
export const utmArchiveSchema = z.object({ revision: z.number().int().min(0).max(2147483646), archived: z.boolean() }).strict();
export const utmListSchema = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'), before: z.uuid().optional() }).strict();
export type UtmFields = z.infer<typeof utmFieldsSchema>;
export type UtmCreate = z.infer<typeof utmCreateSchema>;
export type UtmList = z.infer<typeof utmListSchema>;
/** Pure URL construction only: never fetch or redirect to the supplied destination. */
export function buildUtmUrl(input: UtmFields): string {
  const fields = utmFieldsSchema.parse(input), url = new URL(fields.destinationUrl);
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  for (const key of ['source', 'medium', 'campaign', 'term', 'content'] as const) if (fields[key]) url.searchParams.set(`utm_${key}`, fields[key]);
  return url.toString();
}
