import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, boolean, integer, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), enabled: boolean('enabled').notNull().default(false), revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('feature_flags_tenant_name_uq').on(t.tenantId, t.name), check('feature_flags_revision_valid', sql`${t.revision} > 0`), check('feature_flags_name_valid', sql`${t.name} in ('agency_mode','avatar_generation','autopublishing','auto_reply','analytics_ai','trend_radar','broll_generation')`)]);
export const agencyClients = pgTable('agency_clients', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  clientOrganizationId: uuid('client_organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id), requestKey: uuid('request_key').notNull(), intentHash: text('intent_hash').notNull(),
  revision: uuid('revision').notNull().defaultRandom(), archivedAt: timestamp('archived_at', { withTimezone: true }), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('agency_clients_tenant_request_uq').on(t.tenantId, t.requestKey), uniqueIndex('agency_clients_tenant_client_uq').on(t.tenantId, t.clientOrganizationId), check('agency_clients_distinct_organizations', sql`${t.tenantId} <> ${t.clientOrganizationId}`)]);
