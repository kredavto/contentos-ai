import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import type { EncryptedCredential } from '@contentos/types';
import { organizations, users } from './identity';
export const teamInvitations=pgTable('team_invitations',{
  id:uuid('id').primaryKey(),tenantId:uuid('tenant_id').notNull().references(()=>organizations.id,{onDelete:'cascade'}),
  createdBy:uuid('created_by').notNull().references(()=>users.id),email:text('email').notNull(),
  role:text('role',{enum:['ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER']}).notNull(),
  requestKey:uuid('request_key').notNull(),tokenHash:text('token_hash').notNull(),encryptedToken:jsonb('encrypted_token').$type<EncryptedCredential>(),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  acceptedAt:timestamp('accepted_at',{withTimezone:true}),acceptedBy:uuid('accepted_by').references(()=>users.id),revokedAt:timestamp('revoked_at',{withTimezone:true}),
},t=>[uniqueIndex('team_invitation_request_uq').on(t.tenantId,t.requestKey),uniqueIndex('team_invitation_token_uq').on(t.tokenHash),index('team_invitation_tenant_idx').on(t.tenantId,t.createdAt),
  check('team_invitation_email_normalized',sql`${t.email}=lower(trim(${t.email}))`),check('team_invitation_role_valid',sql`${t.role} in ('ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER')`),
  check('team_invitation_state_valid',sql`(${t.acceptedAt} is null) = (${t.acceptedBy} is null) and not (${t.acceptedAt} is not null and ${t.revokedAt} is not null) and ((${t.acceptedAt} is null and ${t.revokedAt} is null) = (${t.encryptedToken} is not null))`),
  check('team_invitation_expiry_valid',sql`${t.expiresAt}>${t.createdAt}`),
]);
