import {z} from 'zod';
export const videoStages=['VIDEO_REQUESTED','VOICE_PREPARING','AVATAR_RENDERING','POST_PROCESSING','CAPTIONS_GENERATING','BROLL_PROCESSING','COVER_GENERATING','QC','READY','FAILED'] as const;
export type VideoStage=(typeof videoStages)[number];
export const videoRequestSchema=z.object({scriptId:z.uuid(),scriptVersion:z.number().int().positive(),lookId:z.uuid(),orientation:z.enum(['9:16','1:1','16:9']),resolution:z.enum(['720p','1080p']),fit:z.enum(['crop','contain']).default('crop'),idempotencyKey:z.uuid()}).strict();
export type VideoRequest=z.infer<typeof videoRequestSchema>;
export const videoJobInputSchema=z.object({projectId:z.uuid()}).strict();
export type VideoJobInput=z.infer<typeof videoJobInputSchema>;
export const videoReservationSeconds=(plannedDuration:number,maximum:number)=>Math.min(maximum,Math.max(15,plannedDuration*2));
