import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TeamRepository } from '@contentos/db';
import { DomainError, teamInviteSchema, teamMemberChangeSchema, teamMemberRemoveSchema, teamTransferSchema, teamAcceptSchema } from '@contentos/types';
import { CredentialVault } from './credential-vault';
import { createOpaqueToken, hashToken } from './password';
export class TeamService {
  constructor(private readonly repository:TeamRepository,private readonly vault:CredentialVault|null,private readonly appUrl:string){}
  overview(userId:string,tenantId:string){return this.repository.overview(userId,z.uuid().parse(tenantId));}
  async invite(userId:string,tenantId:string,raw:unknown,correlationId:string){
    z.uuid().parse(tenantId);const input=teamInviteSchema.parse(raw);if(!this.vault)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const id=randomUUID(),{token}=createOpaqueToken();
    const invitation=await this.repository.invite(userId,tenantId,{id,email:input.email,role:input.role,requestKey:input.idempotencyKey,tokenHash:hashToken(token),encryptedToken:this.vault.encrypt(token,{kind:'TEAM_INVITATION',tenantId,invitationId:id})},correlationId);
    if(!invitation.encryptedToken||invitation.expiresAt<=new Date())throw new DomainError('CONFLICT',409);
    const link=new URL('/join',this.appUrl);link.hash=this.vault.decrypt(invitation.encryptedToken,{kind:'TEAM_INVITATION',tenantId,invitationId:invitation.id});
    return {id:invitation.id,email:invitation.email,role:invitation.role,expiresAt:invitation.expiresAt,link:link.toString()};
  }
  changeRole(userId:string,tenantId:string,raw:unknown,correlationId:string){const input=teamMemberChangeSchema.parse(raw);return this.repository.changeRole(userId,z.uuid().parse(tenantId),input.userId,input.revision,input.role,correlationId);}
  remove(userId:string,tenantId:string,raw:unknown,correlationId:string){const input=teamMemberRemoveSchema.parse(raw);return this.repository.remove(userId,z.uuid().parse(tenantId),input.userId,input.revision,correlationId);}
  transfer(userId:string,tenantId:string,raw:unknown,correlationId:string){const input=teamTransferSchema.parse(raw);return this.repository.transfer(userId,z.uuid().parse(tenantId),input.userId,input.revision,input.ownerRevision,correlationId);}
  revoke(userId:string,tenantId:string,raw:unknown,correlationId:string){const {id}=z.object({id:z.uuid()}).strict().parse(raw);return this.repository.revoke(userId,z.uuid().parse(tenantId),id,correlationId);}
  accept(userId:string,raw:unknown,correlationId:string){return this.repository.accept(userId,hashToken(teamAcceptSchema.parse(raw).token),correlationId);}
}
