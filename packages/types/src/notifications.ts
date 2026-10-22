import { z } from 'zod';
export const notificationTypeSchema=z.enum(['SCRIPT_READY','VIDEO_FAILED','LIMIT_WARNING','VIDEO_READY','CONTENT_APPROVAL_REQUIRED','PUBLICATION_SUCCESS','PUBLICATION_FAILED','PAYMENT_SUCCESS','PAYMENT_FAILED','SUBSCRIPTION_EXPIRING','SOCIAL_TOKEN_EXPIRED','JOB_FAILED']);
export type NotificationType=z.infer<typeof notificationTypeSchema>;
export const notificationAudienceSchema=z.enum(['ALL','OWNERS','EDITORS','APPROVERS','MANAGERS']);
export type NotificationAudience=z.infer<typeof notificationAudienceSchema>;
export const notificationReadSchema=z.object({id:z.uuid()}).strict();

export const notificationBatchReadSchema=z.object({ids:z.array(z.uuid()).min(1).max(50).refine(ids=>new Set(ids).size===ids.length,'Duplicate notification IDs')}).strict();

export const notificationListSchema=z.object({cursor:z.uuid().optional(),status:z.enum(['ALL','UNREAD']).default('ALL')}).strict();
export type NotificationStatus=z.infer<typeof notificationListSchema>['status'];
