import { z } from 'zod';
export const notificationTypeSchema=z.enum(['VIDEO_READY','CONTENT_APPROVAL_REQUIRED','PUBLICATION_SUCCESS','PUBLICATION_FAILED','PAYMENT_SUCCESS','PAYMENT_FAILED','SUBSCRIPTION_EXPIRING','SOCIAL_TOKEN_EXPIRED','JOB_FAILED']);
export type NotificationType=z.infer<typeof notificationTypeSchema>;
export const notificationAudienceSchema=z.enum(['ALL','OWNERS','EDITORS','APPROVERS','MANAGERS']);
export type NotificationAudience=z.infer<typeof notificationAudienceSchema>;
export const notificationReadSchema=z.object({id:z.uuid()}).strict();
