import { z } from 'zod';
export const adminCategories = ['users', 'organizations', 'jobs', 'failed_jobs', 'subscriptions', 'plans', 'usage', 'webhooks', 'social', 'costs', 'feature_flags', 'audit', 'email', 'payment_tasks', 'actions'] as const;
export const adminCategorySchema = z.enum(adminCategories);
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export const adminListSchema = z.object({
  category: adminCategorySchema, limit: z.coerce.number().int().min(1).max(50).default(25),
  tenantId: z.uuid().optional(), userId: z.uuid().optional(),
  beforeAt: z.string().datetime({ offset: true }).optional(), beforeId: z.uuid().optional(),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.beforeAt) !== Boolean(input.beforeId)) ctx.addIssue({ code: 'custom', path: ['beforeAt'], message: 'Both cursor fields are required' });
  if (input.userId && input.category !== 'users') ctx.addIssue({ code: 'custom', path: ['userId'], message: 'User filter requires users category' });
  if (input.tenantId && ['users', 'plans', 'webhooks', 'email', 'actions'].includes(input.category)) ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'Category has no tenant filter' });
});
export type AdminListInput = z.infer<typeof adminListSchema>;
export const adminRevokeSessionsSchema = z.object({ userId: z.uuid(), reason: z.enum(['USER_REQUEST', 'SECURITY_INCIDENT', 'SUPPORT_CASE']), ticket: z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/), idempotencyKey: z.uuid() }).strict();
export type AdminRevokeSessionsInput = z.infer<typeof adminRevokeSessionsSchema>;
export type AdminRow = Record<string, string | number | boolean | null | Date>;
