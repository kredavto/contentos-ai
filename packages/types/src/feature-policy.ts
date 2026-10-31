import {z} from 'zod';
export const managedFeatures=['avatar_generation','video_generation','trend_radar','instagram_publishing','tiktok_publishing','youtube_publishing','telegram_publishing','autopilot','comments','analytics_ai','agency_mode','byok'] as const;
export const managedFeatureSchema=z.enum(managedFeatures);
export type ManagedFeature=z.infer<typeof managedFeatureSchema>;
export const featureTargetSchema=z.object({feature:managedFeatureSchema,scope:z.enum(['GLOBAL','PLAN','ORGANIZATION','USER']),targetId:z.uuid().nullable()}).strict().refine(value=>(value.scope==='GLOBAL')===(value.targetId===null),{message:'Only GLOBAL has no target'});
export const featurePolicyChangeSchema=z.object({feature:managedFeatureSchema,scope:z.enum(['GLOBAL','PLAN','ORGANIZATION','USER']),targetId:z.uuid().nullable(),mode:z.enum(['ENABLED','DISABLED','INHERIT']),expectedRevision:z.number().int().min(0).max(2147483646),ticket:z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/),idempotencyKey:z.uuid()}).strict().refine(value=>(value.scope==='GLOBAL')===(value.targetId===null),{message:'Only GLOBAL has no target'});
export type FeatureTarget=z.infer<typeof featureTargetSchema>;
export type FeaturePolicyChange=z.infer<typeof featurePolicyChangeSchema>;
