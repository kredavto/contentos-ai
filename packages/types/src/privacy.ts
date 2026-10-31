import { z } from 'zod';
export const requestAccountDeletionSchema = z.object({ password: z.string().min(1).max(128), acknowledged: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const cancelAccountDeletionSchema = z.object({ requestId: z.uuid(), revision: z.uuid() }).strict();
export const exportAccountSchema = z.object({ password: z.string().min(1).max(128) }).strict();

export const executeAccountErasureSchema=z.object({password:z.string().min(1).max(128),requestId:z.uuid(),revision:z.uuid(),idempotencyKey:z.uuid(),scope:z.literal('ACCOUNT_AUTH_DATA_V1'),acknowledgeIrreversible:z.literal(true),acknowledgeRetainedEvidence:z.literal(true)}).strict();

export const accountErasureRecoverySchema=z.object({expectedRecoveryId:z.uuid().nullable(),idempotencyKey:z.uuid(),reason:z.enum(['DEPENDENCIES_RESOLVED','TRANSIENT_FAILURE_RESOLVED']),ticket:z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/),acknowledgeOriginalScope:z.literal(true)}).strict();
export type AccountErasureRecoveryInput=z.infer<typeof accountErasureRecoverySchema>;
