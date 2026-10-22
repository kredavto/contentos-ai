import {z} from 'zod';
export const providerKeyProviderSchema=z.enum(['heygen','openai']);
export type ProviderKeyProvider=z.infer<typeof providerKeyProviderSchema>;
export const providerKeyInputSchema=z.object({provider:providerKeyProviderSchema,apiKey:z.string().min(20).max(4096).regex(/^[\x21-\x7e]+$/),revision:z.number().int().min(0).max(2147483646).nullable()}).strict();
export const providerKeyRevisionSchema=z.object({revision:z.number().int().min(0).max(2147483646)}).strict();
