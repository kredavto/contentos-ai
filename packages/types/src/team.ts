import { z } from 'zod';
export const assignableTeamRoleSchema=z.enum(['ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER']);
export const teamInviteSchema=z.object({email:z.string().trim().toLowerCase().max(254).pipe(z.email()),role:assignableTeamRoleSchema,idempotencyKey:z.uuid()}).strict();
export const teamMemberChangeSchema=z.object({userId:z.uuid(),revision:z.uuid(),role:assignableTeamRoleSchema}).strict();
export const teamMemberRemoveSchema=teamMemberChangeSchema.omit({role:true});
export const teamTransferSchema=teamMemberRemoveSchema.extend({ownerRevision:z.uuid()});
export const teamAcceptSchema=z.object({token:z.string().regex(/^[a-zA-Z0-9_-]{43}$/)}).strict();
