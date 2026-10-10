import { z } from 'zod';
export const adminCategories = ['users', 'organizations', 'jobs', 'failed_jobs', 'subscriptions', 'plans', 'usage', 'webhooks', 'social', 'costs', 'feature_flags', 'audit', 'email', 'payment_tasks', 'actions', 'deletion_requests'] as const;
export const adminCategorySchema = z.enum(adminCategories);
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export const adminListSchema = z.object({
  category: adminCategorySchema, limit: z.coerce.number().int().min(1).max(50).default(25),
  tenantId: z.uuid().optional(), userId: z.uuid().optional(),
  beforeAt: z.string().datetime({ offset: true }).optional(), beforeId: z.uuid().optional(),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.beforeAt) !== Boolean(input.beforeId)) ctx.addIssue({ code: 'custom', path: ['beforeAt'], message: 'Both cursor fields are required' });
  if (input.userId && input.category !== 'users') ctx.addIssue({ code: 'custom', path: ['userId'], message: 'User filter requires users category' });
  if (input.tenantId && ['users', 'plans', 'webhooks', 'email', 'actions', 'deletion_requests'].includes(input.category)) ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'Category has no tenant filter' });
});
export type AdminListInput = z.infer<typeof adminListSchema>;
export const adminRevokeSessionsSchema = z.object({ userId: z.uuid(), reason: z.enum(['USER_REQUEST', 'SECURITY_INCIDENT', 'SUPPORT_CASE']), ticket: z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/), idempotencyKey: z.uuid() }).strict();
export type AdminRevokeSessionsInput = z.infer<typeof adminRevokeSessionsSchema>;
export type AdminRow = Record<string, string | number | boolean | null | Date>;

export const adminPlanCodes = ['FREE', 'START', 'CREATOR', 'EXPERT', 'AGENCY'] as const;
export const adminPlanSchema = z.object({
  code: z.enum(adminPlanCodes), name: z.string().trim().min(1).max(80), enabled: z.boolean(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  amountMinor: z.number().int().min(0).max(1000000000), currency: z.literal('RUB'),
  aiCredits: z.number().int().min(0).max(1000000000), videoSeconds: z.number().int().min(0).max(1000000000),
  ticket: z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/), idempotencyKey: z.uuid(),
}).strict().superRefine((input, ctx) => {
  if (input.code === 'FREE' ? input.amountMinor !== 0 : input.amountMinor === 0)
    ctx.addIssue({ code: 'custom', path: ['amountMinor'], message: 'FREE must be zero; paid plans require a positive price' });
});
export type AdminPlanInput = z.infer<typeof adminPlanSchema>;
export type AdminPlan = { code: string; name: string; enabled: boolean; version: number; planVersionId: string | null; amountMinor: number; currency: string; aiCredits: number; videoSeconds: number };
export const adminFinanceSchema = z.object({
  from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
  tenantId: z.uuid().optional(), paymentMode: z.enum(['LIVE', 'TEST']).default('LIVE'),
  groupBy: z.enum(['USER', 'BRAND', 'PROVIDER']).default('BRAND'),
}).strict().superRefine((input, ctx) => {
  const duration = Date.parse(input.to) - Date.parse(input.from);
  if (!(duration > 0 && duration <= 93 * 86400000)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose a positive interval of at most 93 days' });
});
export type AdminFinanceInput = z.infer<typeof adminFinanceSchema>;
export type AdminFinanceReport = {
  revenue: Array<{ currency: string; amountMinor: string; payments: string }>;
  costs: Array<{ currency: string; knownMicrounits: string; calls: string; unknownCalls: string }>;
  groups: Array<{ entityId: string; currency: string; knownMicrounits: string; calls: string; unknownCalls: string }>;
  groupsTruncated: boolean;
  captured: Array<{ unit: string; amount: string }>;
  jobsWithoutCostEvidence: string; videoJobsWithoutCostEvidence: string;
  grossMargin: null;
};
