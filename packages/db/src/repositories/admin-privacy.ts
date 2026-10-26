import {eq,sql} from 'drizzle-orm';
import {DomainError} from '@contentos/types';
import type {Database} from '../index';
import * as s from '../schema';
import {assertPlatformOperator} from './admin';

/** Read-only actor-linked inventory. Counts are not evidence of ownership of a person's likeness. */
export class AdminPrivacyRepository {
 constructor(private readonly db:Database){}
 async inspect(userId:string,requestId:string,correlationId:string){
  return this.db.transaction(async tx=>{
   await tx.execute(sql`set local statement_timeout = '5s'`);
   await assertPlatformOperator(tx,userId);
   const [request]=await tx.select({id:s.accountDeletionRequests.id,userId:s.accountDeletionRequests.userId,status:s.accountDeletionRequests.status,revision:s.accountDeletionRequests.revision,createdAt:s.accountDeletionRequests.createdAt,cancelledAt:s.accountDeletionRequests.cancelledAt}).from(s.accountDeletionRequests).where(eq(s.accountDeletionRequests.id,requestId));
   if(!request)throw new DomainError('NOT_FOUND',404);
   const subject=request.userId;
   // One statement supplies a consistent inventory snapshot; strings preserve large PostgreSQL counts.
   const [inventory]=await tx.select({
    memberships:sql<string>`(select count(*)::text from ${s.organizationMembers} where ${s.organizationMembers.userId}=${subject})`,
    ownedOrganizations:sql<string>`(select count(*)::text from ${s.organizationMembers} where ${s.organizationMembers.userId}=${subject} and ${s.organizationMembers.role}='OWNER')`,
    activeSessions:sql<string>`(select count(*)::text from ${s.sessions} where ${s.sessions.userId}=${subject} and ${s.sessions.expiresAt}>now())`,
    pendingGenerationJobs:sql<string>`(select count(*)::text from ${s.jobs} where ${s.jobs.requestedBy}=${subject} and ${s.jobs.status} not in ('SUCCEEDED','FAILED'))`,
    generationReconciliation:sql<string>`(select count(*)::text from ${s.jobs} where ${s.jobs.requestedBy}=${subject} and ${s.jobs.status}='RECONCILIATION')`,
    photoUploads:sql<string>`(select count(*)::text from ${s.mediaAssets} where ${s.mediaAssets.uploadedBy}=${subject} and ${s.mediaAssets.status}<>'DELETED')`,
    libraryUploads:sql<string>`(select count(*)::text from ${s.libraryMedia} where ${s.libraryMedia.uploadedBy}=${subject} and ${s.libraryMedia.status}<>'DELETED')`,
    socialConnectionsCreated:sql<string>`(select count(*)::text from ${s.socialConnections} where ${s.socialConnections.createdBy}=${subject} and ${s.socialConnections.status}<>'REVOKED')`,
    providerKeysCreated:sql<string>`(select count(*)::text from ${s.providerKeys} where ${s.providerKeys.createdBy}=${subject} and ${s.providerKeys.status}='ACTIVE')`,
    consentEvidence:sql<string>`(select count(*)::text from ${s.consentRecords} where ${s.consentRecords.acceptedByUserId}=${subject})`,
    renewalEvidence:sql<string>`(select count(*)::text from ${s.renewalConsents} where ${s.renewalConsents.acceptedBy}=${subject})`,
    pendingAuthEmails:sql<string>`(select count(*)::text from ${s.emailOutbox} where ${s.emailOutbox.userId}=${subject} and ${s.emailOutbox.status} in ('PENDING','SENDING','RECONCILIATION'))`,
    pendingNotificationEmails:sql<string>`(select count(*)::text from ${s.notificationEmailDeliveries} where ${s.notificationEmailDeliveries.userId}=${subject} and ${s.notificationEmailDeliveries.status} in ('PENDING','SENDING','RECONCILIATION'))`,
   }).from(s.users).where(eq(s.users.id,subject));
   if(!inventory)throw new Error('Privacy inventory unavailable');
   await tx.insert(s.auditLogs).values({userId,action:'ADMIN_DELETION_INSPECTED',resourceId:requestId,correlationId});
   const [execution]=await tx.select({id:s.accountErasures.id,status:s.accountErasures.status,scope:s.accountErasures.consentVersion,createdAt:s.accountErasures.createdAt,completedAt:s.accountErasures.completedAt,errorCode:s.accountErasures.errorCode}).from(s.accountErasures).where(eq(s.accountErasures.requestId,requestId));
   return {request,inventory,execution:execution??null,inspectedAt:new Date().toISOString(),executionAvailable:false as const};
  },{isolationLevel:'repeatable read'});
 }
}
