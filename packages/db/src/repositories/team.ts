import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import { DomainError, type Role, type EncryptedCredential } from '@contentos/types';
import type { Database } from '../index';
import { teamInvitations, organizationMembers, users, auditLogs } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
type InviteRole=Exclude<Role,'OWNER'>;
export class TeamRepository {
  constructor(private readonly db:Database){}
  private async manager(tx:Transaction,userId:string,tenantId:string){
    const member=await assertMembership(tx,userId,tenantId);
    if(!member.verifiedAt||!['OWNER','ADMIN'].includes(member.role))throw new DomainError('NOT_AUTHORIZED',403);
    return member;
  }
  private mayManage(actor:Role,target:Role){if(target==='OWNER'||(actor!=='OWNER'&&target==='ADMIN'))throw new DomainError('NOT_AUTHORIZED',403);}
  private audit(tx:Transaction,userId:string,tenantId:string,resourceId:string,action:string,correlationId:string,metadata:Record<string,string|number|boolean|null>={}){return tx.insert(auditLogs).values({userId,tenantId,resourceId,action,correlationId,metadata});}
  private async revokeIssued(tx:Transaction,actorId:string,tenantId:string,issuerId:string,correlationId:string,adminOnly=false){
    const revoked=await tx.update(teamInvitations).set({revokedAt:sql`now()`,encryptedToken:null}).where(and(eq(teamInvitations.tenantId,tenantId),eq(teamInvitations.createdBy,issuerId),isNull(teamInvitations.acceptedAt),isNull(teamInvitations.revokedAt),adminOnly?eq(teamInvitations.role,'ADMIN'):undefined)).returning({id:teamInvitations.id});
    for(const invitation of revoked)await this.audit(tx,actorId,tenantId,invitation.id,'TEAM_INVITATION_REVOKED',correlationId,{reason:'ISSUER_AUTHORITY_CHANGED'});
  }
  async overview(userId:string,tenantId:string){return this.db.transaction(async tx=>{
    const actor=await this.manager(tx,userId,tenantId);
    const members=await tx.select({userId:users.id,name:users.name,email:users.email,role:organizationMembers.role,revision:organizationMembers.revision,verifiedAt:users.emailVerifiedAt,disabledAt:users.disabledAt}).from(organizationMembers).innerJoin(users,eq(users.id,organizationMembers.userId)).where(eq(organizationMembers.tenantId,tenantId)).orderBy(users.name,users.id);
    const invitations=await tx.select({id:teamInvitations.id,email:teamInvitations.email,role:teamInvitations.role,expiresAt:teamInvitations.expiresAt,acceptedAt:teamInvitations.acceptedAt,revokedAt:teamInvitations.revokedAt}).from(teamInvitations).where(eq(teamInvitations.tenantId,tenantId)).orderBy(desc(teamInvitations.createdAt)).limit(100);
    return {userId,role:actor.role,members,invitations};
  });}
  async changeRole(userId:string,tenantId:string,targetId:string,revision:string,role:InviteRole,correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const actor=await this.manager(tx,userId,tenantId);this.mayManage(actor.role,role);
    const [target]=await tx.select().from(organizationMembers).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,targetId))).for('update');
    if(!target)throw new DomainError('NOT_FOUND',404);this.mayManage(actor.role,target.role);if(target.revision!==revision)throw new DomainError('CONFLICT',409);
    if(target.role===role)return target;
    const [updated]=await tx.update(organizationMembers).set({role,revision:sql`gen_random_uuid()`}).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,targetId))).returning();
    if(role!=='ADMIN')await this.revokeIssued(tx,userId,tenantId,targetId,correlationId);
    await this.audit(tx,userId,tenantId,targetId,'TEAM_ROLE_CHANGED',correlationId,{previousRole:target.role,role});return updated!;
  });}
  async remove(userId:string,tenantId:string,targetId:string,revision:string,correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const actor=await this.manager(tx,userId,tenantId);
    const [target]=await tx.select().from(organizationMembers).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,targetId))).for('update');
    if(!target)throw new DomainError('NOT_FOUND',404);this.mayManage(actor.role,target.role);if(target.revision!==revision)throw new DomainError('CONFLICT',409);
    await this.revokeIssued(tx,userId,tenantId,targetId,correlationId);
    await tx.delete(organizationMembers).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,targetId)));
    await this.audit(tx,userId,tenantId,targetId,'TEAM_MEMBER_REMOVED',correlationId);return {removed:true};
  });}
  async transfer(userId:string,tenantId:string,targetId:string,revision:string,ownerRevision:string,correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const actor=await this.manager(tx,userId,tenantId);if(actor.role!=='OWNER'||targetId===userId)throw new DomainError('NOT_AUTHORIZED',403);
    const members=await tx.select({userId:organizationMembers.userId,role:organizationMembers.role,revision:organizationMembers.revision,verifiedAt:users.emailVerifiedAt,disabledAt:users.disabledAt}).from(organizationMembers).innerJoin(users,eq(users.id,organizationMembers.userId)).where(and(eq(organizationMembers.tenantId,tenantId),sql`${organizationMembers.userId} in (${userId},${targetId})`)).for('update');
    const owner=members.find(m=>m.userId===userId),target=members.find(m=>m.userId===targetId);
    if(!target)throw new DomainError('NOT_FOUND',404);if(!target.verifiedAt||target.disabledAt||target.role==='OWNER')throw new DomainError('NOT_AUTHORIZED',403);
    if(owner?.revision!==ownerRevision||target.revision!==revision)throw new DomainError('CONFLICT',409);
    await tx.update(organizationMembers).set({role:'OWNER',revision:sql`gen_random_uuid()`}).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,targetId)));
    await tx.update(organizationMembers).set({role:'ADMIN',revision:sql`gen_random_uuid()`}).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,userId)));
    await this.revokeIssued(tx,userId,tenantId,userId,correlationId,true);
    await this.audit(tx,userId,tenantId,targetId,'TEAM_OWNERSHIP_TRANSFERRED',correlationId);return {transferred:true};
  });}
  async invite(userId:string,tenantId:string,input:{id:string;email:string;role:InviteRole;requestKey:string;tokenHash:string;encryptedToken:EncryptedCredential},correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const actor=await this.manager(tx,userId,tenantId);this.mayManage(actor.role,input.role);
    const [existing]=await tx.select().from(teamInvitations).where(and(eq(teamInvitations.tenantId,tenantId),eq(teamInvitations.requestKey,input.requestKey)));
    if(existing){if(existing.createdBy!==userId||existing.email!==input.email||existing.role!==input.role||existing.acceptedAt||existing.revokedAt)throw new DomainError('CONFLICT',409);return existing;}
    const [member]=await tx.select({id:users.id}).from(users).innerJoin(organizationMembers,eq(users.id,organizationMembers.userId)).where(and(eq(organizationMembers.tenantId,tenantId),eq(users.email,input.email)));if(member)throw new DomainError('CONFLICT',409);
    const [pending]=await tx.select({count:sql<number>`count(*)::int`}).from(teamInvitations).where(and(eq(teamInvitations.tenantId,tenantId),isNull(teamInvitations.acceptedAt),isNull(teamInvitations.revokedAt),sql`${teamInvitations.expiresAt}>now()`));if((pending?.count??0)>=100)throw new DomainError('PLAN_LIMIT_REACHED',409);
    const [invitation]=await tx.insert(teamInvitations).values({...input,tenantId,createdBy:userId,expiresAt:sql`now()+interval '7 days'`}).returning();
    await this.audit(tx,userId,tenantId,input.id,'TEAM_INVITATION_CREATED',correlationId,{role:input.role});return invitation!;
  });}
  async revoke(userId:string,tenantId:string,id:string,correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);const actor=await this.manager(tx,userId,tenantId);const [invite]=await tx.select().from(teamInvitations).where(and(eq(teamInvitations.tenantId,tenantId),eq(teamInvitations.id,id))).for('update');
    if(!invite)throw new DomainError('NOT_FOUND',404);this.mayManage(actor.role,invite.role);if(invite.acceptedAt)throw new DomainError('CONFLICT',409);
    if(!invite.revokedAt){await tx.update(teamInvitations).set({revokedAt:sql`now()`,encryptedToken:null}).where(eq(teamInvitations.id,id));await this.audit(tx,userId,tenantId,id,'TEAM_INVITATION_REVOKED',correlationId);}return {revoked:true};
  });}
  async accept(userId:string,tokenHash:string,correlationId:string){return this.db.transaction(async tx=>{
    const [reference]=await tx.select({tenantId:teamInvitations.tenantId}).from(teamInvitations).where(eq(teamInvitations.tokenHash,tokenHash));if(!reference)throw new DomainError('NOT_FOUND',404);
    const tenantId=reference.tenantId;await lockTenant(tx,tenantId);
    const [invite]=await tx.select().from(teamInvitations).where(eq(teamInvitations.tokenHash,tokenHash)).for('update');
    const [user]=await tx.select().from(users).where(eq(users.id,userId)).for('share');
    if(!invite||!user||user.disabledAt||!user.emailVerifiedAt||user.email!==invite.email)throw new DomainError('NOT_FOUND',404);
    const [member]=await tx.select().from(organizationMembers).where(and(eq(organizationMembers.tenantId,tenantId),eq(organizationMembers.userId,userId)));
    if(invite.acceptedAt){if(invite.acceptedBy===userId&&member)return {tenantId};throw new DomainError('NOT_FOUND',404);}
    const [valid]=await tx.select({id:teamInvitations.id}).from(teamInvitations).where(and(eq(teamInvitations.id,invite.id),isNull(teamInvitations.revokedAt),sql`${teamInvitations.expiresAt}>now()`));if(!valid)throw new DomainError('NOT_FOUND',404);
    const issuer=await this.manager(tx,invite.createdBy,tenantId);this.mayManage(issuer.role,invite.role);if(member)throw new DomainError('CONFLICT',409);
    await tx.insert(organizationMembers).values({tenantId,userId,role:invite.role});
    await tx.update(teamInvitations).set({acceptedAt:sql`now()`,acceptedBy:userId,encryptedToken:null}).where(eq(teamInvitations.id,invite.id));
    await this.audit(tx,userId,tenantId,invite.id,'TEAM_INVITATION_ACCEPTED',correlationId,{role:invite.role});return {tenantId};
  });}
}
