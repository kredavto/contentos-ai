import { z } from 'zod';
export const consentTypes=['OWN_LIKENESS','THIRD_PARTY_LIKENESS','VOICE_CLONING','CROSS_BORDER_PROCESSING','AUTOMATED_PUBLISHING'] as const;
export type ConsentType=(typeof consentTypes)[number];
export const consentTypeSchema=z.enum(consentTypes);
export const subjectSchema=z.object({name:z.string().trim().min(1).max(200),type:z.enum(['PERSON','VOICE','ORGANIZATION'])}).strict();
export const acceptConsentSchema=z.object({subjectId:z.uuid(),type:consentTypeSchema,version:z.string().min(1).max(30),textHash:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true),idempotencyKey:z.uuid()}).strict();
export type ConsentAcceptance=z.infer<typeof acceptConsentSchema>;
