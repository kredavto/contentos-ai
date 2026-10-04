import {z} from 'zod';
export const socialStatuses=['PENDING','CONNECTED','LIMITED','ACTIVE','TOKEN_EXPIRED','REVOKED','ERROR'] as const;
export type SocialStatus=typeof socialStatuses[number];
export interface EncryptedCredential{version:1;keyId:string;iv:string;tag:string;ciphertext:string}
export const telegramTokenSchema=z.string().trim().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/);
export const telegramTargetSchema=z.string().trim().max(80).refine(value=>/^@[A-Za-z0-9_]{1,32}$/.test(value)||(/^-\d{1,16}$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<0));
export const socialConnectSchema=z.object({token:telegramTokenSchema,target:telegramTargetSchema,idempotencyKey:z.uuid()}).strict();
export const socialRevisionSchema=z.object({revision:z.number().int().nonnegative()}).strict();
export const socialReconnectSchema=socialRevisionSchema.extend({token:telegramTokenSchema});
