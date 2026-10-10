import { z } from 'zod';
export const requestAccountDeletionSchema = z.object({ password: z.string().min(1).max(128), acknowledged: z.literal(true), idempotencyKey: z.uuid() }).strict();
export const cancelAccountDeletionSchema = z.object({ requestId: z.uuid(), revision: z.uuid() }).strict();
