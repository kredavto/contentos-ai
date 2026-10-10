import { sql } from 'drizzle-orm';
import { check, pgTable, uuid, text, timestamp, uniqueIndex, primaryKey, foreignKey, index, integer, jsonb } from 'drizzle-orm/pg-core';
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(), email: text('email').notNull(), passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(), emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [uniqueIndex('users_email_uq').on(t.email), check('users_email_normalized', sql`${t.email} = lower(trim(${t.email}))`)]);
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: createdAt(),
}, t => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(), type: text('type', { enum: ['VERIFY_EMAIL', 'RESET_PASSWORD'] }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), consumedAt: timestamp('consumed_at', { withTimezone: true }), createdAt: createdAt(),
}, t => [index('auth_tokens_user_created_idx').on(t.userId, t.createdAt, t.id), uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash), uniqueIndex('auth_tokens_user_hash_uq').on(t.userId,t.tokenHash), check('auth_tokens_type_valid', sql`${t.type} in ('VERIFY_EMAIL', 'RESET_PASSWORD')`)]);
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull(), createdAt: createdAt(),
});
export const organizationMembers = pgTable('organization_members', {
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['OWNER', 'ADMIN', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'] }).notNull(), revision: uuid('revision').notNull().defaultRandom(), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.tenantId, t.userId] }), index('members_user_idx').on(t.userId), check('members_role_valid', sql`${t.role} in ('OWNER', 'ADMIN', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER')`)]);
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), timezone: text('timezone').notNull().default('Europe/Moscow'), createdAt: createdAt(),
}, t => [uniqueIndex('workspaces_tenant_id_uq').on(t.tenantId, t.id)]);
export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(), name: text('name').notNull(), onboardingStep: integer('onboarding_step').notNull().default(0),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }), revision: integer('revision').notNull().default(0), createdAt: createdAt(),
}, t => [uniqueIndex('brands_tenant_id_uq').on(t.tenantId, t.id), check('brands_onboarding_step_valid', sql`${t.onboardingStep} between 0 and 14`), check('brands_revision_valid', sql`${t.revision} >= 0`), foreignKey({ columns: [t.tenantId, t.workspaceId], foreignColumns: [workspaces.tenantId, workspaces.id] }).onDelete('cascade')]);
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), action: text('action').notNull(),
  resourceId: uuid('resource_id'), correlationId: uuid('correlation_id').notNull(), metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().notNull().default({}), createdAt: createdAt(),
}, t => [index('audit_user_created_idx').on(t.userId, t.createdAt, t.id), index('audit_tenant_created_idx').on(t.tenantId, t.createdAt)]);
