import {createHash} from 'node:crypto';
import {and,eq,desc,or,sql,isNull,isNotNull,inArray} from 'drizzle-orm';
import {DomainError,type ApprovalRequest,type ApprovalDecision} from '@contentos/types';
import type {Database} from '../index';
import {notifications,approvalRequests,organizationMembers,users,auditLogs} from '../schema';
import {assertMembership,lockTenant} from './ledger';
import {editScriptInTransaction,editPostInTransaction,editCarouselInTransaction} from './content';
import {approvalTarget} from './approval-targets';
export class ApprovalRepository {
  constructor(private readonly db:Database){}
  async create(userId:string,tenantId:string,brandId:string,input:ApprovalRequest,correlationId:string){
    const inputHash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [existing]=await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId,tenantId),eq(approvalRequests.requestedBy,userId),eq(approvalRequests.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);return {id:existing.id,status:existing.status};}
      await assertMembership(tx,input.requestedFrom,tenantId,'approve');
      const target=await approvalTarget(tx,tenantId,brandId,input);
      if(target.currentVersion!==input.version||target.approvedVersion===input.version||target.archived||('lifecycleRevision' in input&&input.lifecycleRevision!==target.lifecycleRevision))throw new DomainError('CONFLICT',409);
      const identities={entityType:target.entityType,scriptId:'scriptId' in input?input.scriptId:null,postId:'postId' in input?input.postId:null,carouselId:'carouselId' in input?input.carouselId:null,lifecycleRevision:'lifecycleRevision' in input?input.lifecycleRevision:null};
      const pendingTarget=identities.scriptId?eq(approvalRequests.scriptId,identities.scriptId):identities.postId?eq(approvalRequests.postId,identities.postId):eq(approvalRequests.carouselId,identities.carouselId!);
      const [pending]=await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId,tenantId),pendingTarget,eq(approvalRequests.status,'PENDING')));
      if(pending)throw new DomainError('CONFLICT',409);
      const [row]=await tx.insert(approvalRequests).values({tenantId,brandId,...identities,version:input.version,requestedBy:userId,requestedFrom:input.requestedFrom,requestComment:input.comment,idempotencyKey:input.idempotencyKey,inputHash}).returning({id:approvalRequests.id,status:approvalRequests.status});
      await tx.insert(auditLogs).values({tenantId,userId,action:'APPROVAL_REQUESTED',resourceId:row!.id,correlationId,metadata:{entityType:target.entityType,version:input.version}});
      await tx.insert(notifications).values({tenantId,userId:input.requestedFrom,sourceKey:`approval:${row!.id}`,type:'CONTENT_APPROVAL_REQUIRED',audience:'APPROVERS',resourceId:row!.id,brandId});
      return row!;
    });
  }
  async decide(userId:string,tenantId:string,requestId:string,input:ApprovalDecision,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);const member=await assertMembership(tx,userId,tenantId,input.status==='CANCELLED'?'read':'approve');
      const [row]=await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId,tenantId),eq(approvalRequests.id,requestId))).for('update');
      if(!row)throw new DomainError('NOT_FOUND',404);
      if(input.status==='CANCELLED'?row.requestedBy!==userId&&!['OWNER','ADMIN','MANAGER'].includes(member.role):row.requestedFrom!==userId)throw new DomainError('NOT_AUTHORIZED',403);
      if(row.status!=='PENDING'){if(row.status===input.status&&row.resolvedBy===userId&&row.comment===input.comment)return {id:row.id,status:row.status};throw new DomainError('CONFLICT',409);}
      if(input.status!=='CANCELLED'){
        const target=await approvalTarget(tx,tenantId,row.brandId,row);
        if(target.currentVersion!==row.version||target.approvedVersion===row.version||target.archived||target.lifecycleRevision!==row.lifecycleRevision)throw new DomainError('CONFLICT',409);
        if(input.status==='APPROVED'){
          if(target.entityType==='SCRIPT')await editScriptInTransaction(tx,userId,tenantId,row.brandId,target.id,row.version,null,correlationId);
          else if(target.entityType==='POST')await editPostInTransaction(tx,userId,tenantId,row.brandId,target.id,{revision:row.version,content:null},correlationId);
          else await editCarouselInTransaction(tx,userId,tenantId,row.brandId,target.id,{revision:row.version,lifecycleRevision:target.lifecycleRevision,content:null},correlationId);
        }
      }
      await tx.update(approvalRequests).set({status:input.status,comment:input.comment,resolvedBy:userId,resolvedAt:new Date()}).where(eq(approvalRequests.id,row.id));
      await tx.insert(auditLogs).values({tenantId,userId,action:`APPROVAL_${input.status}`,resourceId:row.id,correlationId,metadata:{entityType:row.entityType,version:row.version}});
      return {id:row.id,status:input.status};
    });
  }
  async list(userId:string,tenantId:string,cursor?:string){
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const visible=and(eq(approvalRequests.tenantId,tenantId),['OWNER','ADMIN','MANAGER'].includes(member.role)?undefined:or(eq(approvalRequests.requestedBy,userId),eq(approvalRequests.requestedFrom,userId)));
      const [before]=cursor?await tx.select({id:approvalRequests.id}).from(approvalRequests).where(and(visible,eq(approvalRequests.id,cursor))):[];
      if(cursor&&!before)throw new DomainError('NOT_FOUND',404);
      const rows=await tx.select({id:approvalRequests.id,brandId:approvalRequests.brandId,scriptId:approvalRequests.scriptId,postId:approvalRequests.postId,carouselId:approvalRequests.carouselId,version:approvalRequests.version,requestedLifecycleRevision:approvalRequests.lifecycleRevision,requestedBy:approvalRequests.requestedBy,requestedFrom:approvalRequests.requestedFrom,requestComment:approvalRequests.requestComment,status:approvalRequests.status,comment:approvalRequests.comment,createdAt:approvalRequests.createdAt,resolvedAt:approvalRequests.resolvedAt}).from(approvalRequests)
        .where(and(visible,before?sql`(${approvalRequests.createdAt},${approvalRequests.id}) < (select created_at,id from approval_requests where id=${before.id}::uuid)`:undefined)).orderBy(desc(approvalRequests.createdAt),desc(approvalRequests.id)).limit(21);
      const items=[];
      for(const row of rows.slice(0,20)){const {id:entityId,...target}=await approvalTarget(tx,tenantId,row.brandId,row);items.push({...row,...target,entityId});}
      return {items,nextCursor:rows.length>20?rows[19]!.id:null,userId,role:member.role};
    });
  }
  async reviewers(userId:string,tenantId:string){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId,'generate');
    return tx.select({id:users.id,name:users.name,role:organizationMembers.role}).from(organizationMembers).innerJoin(users,eq(users.id,organizationMembers.userId)).where(and(eq(organizationMembers.tenantId,tenantId),inArray(organizationMembers.role,['OWNER','ADMIN','MANAGER','CLIENT_APPROVER']),isNull(users.disabledAt),isNotNull(users.emailVerifiedAt))).orderBy(users.name,users.id).limit(100);
  });}
}
