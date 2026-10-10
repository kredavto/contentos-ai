import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, unique, foreignKey, index, check } from 'drizzle-orm/pg-core';
import { organizations, organizationMembers, brands } from './identity';
import type { NotificationType, NotificationAudience } from '@contentos/types';
export const notificationReceipts=pgTable('notification_receipts',{
  sourceKey:text('source_key').primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>organizations.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const notifications=pgTable('notifications',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),userId:uuid('user_id').notNull(),sourceKey:text('source_key').notNull(),
  type:text('type').$type<NotificationType>().notNull(),audience:text('audience').$type<NotificationAudience>().notNull(),resourceId:uuid('resource_id').notNull(),brandId:uuid('brand_id'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),readAt:timestamp('read_at',{withTimezone:true}),
},t=>[unique('notification_recipient_source_uq').on(t.tenantId,t.userId,t.sourceKey,t.type),index('notification_inbox_idx').on(t.tenantId,t.userId,t.createdAt),
  foreignKey({columns:[t.tenantId,t.userId],foreignColumns:[organizationMembers.tenantId,organizationMembers.userId]}).onDelete('cascade'),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
  check('notification_type_valid',sql`${t.type} in ('VIDEO_READY','CONTENT_APPROVAL_REQUIRED','PUBLICATION_SUCCESS','PUBLICATION_FAILED','PAYMENT_SUCCESS','PAYMENT_FAILED','SUBSCRIPTION_EXPIRING','SOCIAL_TOKEN_EXPIRED','JOB_FAILED')`),
  check('notification_audience_valid',sql`${t.audience} in ('ALL','OWNERS','EDITORS','APPROVERS','MANAGERS')`),
]);
