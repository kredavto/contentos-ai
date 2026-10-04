import { z } from 'zod';
export const avatarRequestSchema = z.object({
  name:z.string().trim().min(1).max(120), sourceAssetId:z.uuid(), subjectId:z.uuid(),
  likenessType:z.enum(['OWN_LIKENESS','THIRD_PARTY_LIKENESS']), avatarId:z.uuid().optional(), idempotencyKey:z.uuid(),
}).strict();
export const consentRequirementSchema = z.object({type:z.enum(['OWN_LIKENESS','THIRD_PARTY_LIKENESS','CROSS_BORDER_PROCESSING']),version:z.string(),textHash:z.string(),recordId:z.uuid()});
export const avatarJobInputSchema = z.object({avatarId:z.uuid(),lookId:z.uuid(),sourceAssetId:z.uuid(),subjectId:z.uuid(),requirements:z.array(consentRequirementSchema).length(2)}).strict();
export type AvatarRequest = z.infer<typeof avatarRequestSchema>;
export type AvatarJobInput = z.infer<typeof avatarJobInputSchema>;
export type AvatarStatus = 'ACTIVE' | 'DELETE_PENDING' | 'DELETED';
export type AvatarLookStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'RECONCILIATION';
