import {and,eq,asc,sql} from 'drizzle-orm';
import {DomainError} from '@contentos/types';
import type {Database} from '../index';
import {approvalRequests,approvalComments,users,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
async function access(tx:Transaction,userId:string,tenantId:string,requestId:string,write=false){
  const member=await assertMembership(tx,userId,tenantId);
  const [request]=await tx.select().from(approvalRequests).where(and(eq(approvalRequests.tenantId,tenantId),eq(approvalRequests.id,requestId)));
  if(!request||!['OWNER','ADMIN','MANAGER'].includes(member.role)&&request.requestedBy!==userId&&request.requestedFrom!==userId)throw new DomainError('NOT_FOUND',404);
  if(write)await assertMembership(tx,userId,tenantId,member.role==='CLIENT_APPROVER'?'approve':'generate');
}
export class ApprovalCommentRepository{
  constructor(private readonly db:Database){}
  async create(userId:string,tenantId:string,requestId:string,input:{body:string;idempotencyKey:string},correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await access(tx,userId,tenantId,requestId,true);
    const scope=and(eq(approvalComments.tenantId,tenantId),eq(approvalComments.requestId,requestId));
    const [existing]=await tx.select().from(approvalComments).where(and(scope,eq(approvalComments.userId,userId),eq(approvalComments.idempotencyKey,input.idempotencyKey)));
    if(existing){if(existing.body!==input.body)throw new DomainError('CONFLICT',409);return {id:existing.id};}
    const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(approvalComments).where(scope);if((count?.n??0)>=200)throw new DomainError('PLAN_LIMIT_REACHED',403);
    const [row]=await tx.insert(approvalComments).values({tenantId,requestId,userId,...input}).returning({id:approvalComments.id});
    await tx.insert(auditLogs).values({tenantId,userId,resourceId:requestId,action:'APPROVAL_COMMENT_ADDED',correlationId,metadata:{commentId:row!.id}});return row!;
  });}
  async list(userId:string,tenantId:string,requestId:string,cursor?:string){return this.db.transaction(async tx=>{
    await access(tx,userId,tenantId,requestId);const scope=and(eq(approvalComments.tenantId,tenantId),eq(approvalComments.requestId,requestId));
    const [before]=cursor?await tx.select({id:approvalComments.id}).from(approvalComments).where(and(scope,eq(approvalComments.id,cursor))):[];
    if(cursor&&!before)throw new DomainError('NOT_FOUND',404);
    const rows=await tx.select({id:approvalComments.id,userId:approvalComments.userId,name:users.name,body:approvalComments.body,createdAt:approvalComments.createdAt}).from(approvalComments).innerJoin(users,eq(users.id,approvalComments.userId)).where(and(scope,before?sql`(${approvalComments.createdAt},${approvalComments.id})>(select created_at,id from approval_comments where tenant_id=${tenantId}::uuid and request_id=${requestId}::uuid and id=${before.id}::uuid)`:undefined)).orderBy(asc(approvalComments.createdAt),asc(approvalComments.id)).limit(51);
    return {items:rows.slice(0,50),nextCursor:rows.length>50?rows[49]!.id:null};
  });}
}
