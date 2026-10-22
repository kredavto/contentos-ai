import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, unique, foreignKey, index, check, boolean, integer } from 'drizzle-orm/pg-core';
import { organizations, organizationMembers, brands } from './identity';
import type { NotificationType, NotificationAudience } from '@contentos/types';
export const notificationReceipts=pgTable('notification_receipts',{
  sourceKey:text('source_key').primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>organizations.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const notifications=pgTable('notifications',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),userId:uuid('user_id').notNull(),sourceKey:text('source_key').notNull(),
  type:text('type').$type<NotificationType>().notNull(),audience:text('audience').$type<NotificationAudience>().notNull(),resourceId:uuid('resource_id').notNull(),brandId:uuid('brand_id'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),readAt:timestamp('read_at',{withTimezone:true}),
},t=>[unique('notification_tenant_recipient_id_uq').on(t.tenantId,t.userId,t.id),unique('notification_recipient_source_uq').on(t.tenantId,t.userId,t.sourceKey,t.type),index('notification_inbox_idx').on(t.tenantId,t.userId,t.createdAt),
  foreignKey({columns:[t.tenantId,t.userId],foreignColumns:[organizationMembers.tenantId,organizationMembers.userId]}).onDelete('cascade'),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
  check('notification_type_valid',sql`${t.type} in ('SCRIPT_READY','VIDEO_FAILED','LIMIT_WARNING','VIDEO_READY','CONTENT_APPROVAL_REQUIRED','PUBLICATION_SUCCESS','PUBLICATION_FAILED','PAYMENT_SUCCESS','PAYMENT_FAILED','SUBSCRIPTION_EXPIRING','SOCIAL_TOKEN_EXPIRED','JOB_FAILED')`),
  check('notification_audience_valid',sql`${t.audience} in ('ALL','OWNERS','EDITORS','APPROVERS','MANAGERS')`),
]);

export const notificationPreferences=pgTable('notification_preferences',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),userId:uuid('user_id').notNull(),
  emailEnabled:boolean('email_enabled').notNull().default(false),revision:uuid('revision').notNull().defaultRandom(),
  enabledAt:timestamp('enabled_at',{withTimezone:true}),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique('notification_preferences_recipient_uq').on(t.tenantId,t.userId),
  foreignKey({columns:[t.tenantId,t.userId],foreignColumns:[organizationMembers.tenantId,organizationMembers.userId]}).onDelete('cascade'),
  check('notification_preferences_enabled_valid',sql`${t.emailEnabled}=(${t.enabledAt} is not null)`),
]);

export const notificationEmailDeliveries=pgTable('notification_email_deliveries',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),userId:uuid('user_id').notNull(),notificationId:uuid('notification_id').notNull().unique(),preferenceRevision:uuid('preference_revision').notNull(),
  status:text('status').$type<'PENDING'|'SENDING'|'SENT'|'FAILED'|'CANCELED'|'RECONCILIATION'>().notNull().default('PENDING'),
  attempt:integer('attempt').notNull().default(0),nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),
  leaseToken:uuid('lease_token'),leaseUntil:timestamp('lease_until',{withTimezone:true}),submittedAt:timestamp('submitted_at',{withTimezone:true}),
  errorCode:text('error_code'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),completedAt:timestamp('completed_at',{withTimezone:true}),
},t=>[foreignKey({columns:[t.tenantId,t.userId,t.notificationId],foreignColumns:[notifications.tenantId,notifications.userId,notifications.id]}).onDelete('cascade'),
  index('notification_email_due_idx').on(t.status,t.nextAttemptAt),
  check('notification_email_status_valid',sql`${t.status} in ('PENDING','SENDING','SENT','FAILED','CANCELED','RECONCILIATION')`),
  check('notification_email_attempt_valid',sql`${t.attempt} between 0 and 8`),
  check('notification_email_lease_valid',sql`(${t.status}='SENDING')=(${t.leaseToken} is not null and ${t.leaseUntil} is not null)`),
]);
