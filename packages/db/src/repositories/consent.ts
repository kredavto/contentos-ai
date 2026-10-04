import { and,eq,isNull,desc } from 'drizzle-orm';
import { DomainError,type ConsentAcceptance,type ConsentType } from '@contentos/types';
import type { Database } from '../index';
import { consentSubjects,consentRecords,brands,auditLogs } from '../schema';
import { assertMembership,lockTenant,type Transaction } from './ledger';
export async function requireConsent(tx:Transaction,tenantId:string,subjectId:string,requirements:Array<{type:ConsentType;version:string;textHash:string;recordId?:string}>) {
  const ids:string[]=[];
  for(const requirement of requirements){
    const [record]=await tx.select({id:consentRecords.id}).from(consentRecords).where(and(eq(consentRecords.tenantId,tenantId),eq(consentRecords.subjectId,subjectId),eq(consentRecords.consentType,requirement.type),eq(consentRecords.consentVersion,requirement.version),eq(consentRecords.consentTextHash,requirement.textHash),isNull(consentRecords.revokedAt),requirement.recordId?eq(consentRecords.id,requirement.recordId):undefined)).for('share');
    if(!record)throw new DomainError('CONSENT_REQUIRED',403);
    ids.push(record.id);
  }
  return ids;
}
export class ConsentRepository {
  constructor(private readonly db:Database){}
  async createSubject(userId:string,tenantId:string,brandId:string,input:{name:string;type:'PERSON'|'VOICE'|'ORGANIZATION'},correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');
      const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);
      const [subject]=await tx.insert(consentSubjects).values({tenantId,brandId,...input}).returning();if(!subject)throw new Error('Subject insert failed');
      await tx.insert(auditLogs).values({tenantId,userId,action:'CONSENT_SUBJECT_CREATED',resourceId:subject.id,correlationId});return subject;
    });
  }
  async list(userId:string,tenantId:string,brandId:string){
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const subjects=await tx.select().from(consentSubjects).where(and(eq(consentSubjects.tenantId,tenantId),eq(consentSubjects.brandId,brandId)));
      const records=await tx.select({id:consentRecords.id,subjectId:consentRecords.subjectId,type:consentRecords.consentType,version:consentRecords.consentVersion,textHash:consentRecords.consentTextHash,acceptedAt:consentRecords.acceptedAt,acceptedBy:consentRecords.acceptedByUserId,revokedAt:consentRecords.revokedAt}).from(consentRecords).innerJoin(consentSubjects,and(eq(consentSubjects.tenantId,consentRecords.tenantId),eq(consentSubjects.id,consentRecords.subjectId))).where(and(eq(consentRecords.tenantId,tenantId),eq(consentSubjects.brandId,brandId))).orderBy(desc(consentRecords.acceptedAt));
      return {subjects,records};
    });
  }
  async accept(userId:string,tenantId:string,brandId:string,input:ConsentAcceptance,request:{ip:string;userAgent:string},correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'strategy');
      const [subject]=await tx.select().from(consentSubjects).where(and(eq(consentSubjects.tenantId,tenantId),eq(consentSubjects.brandId,brandId),eq(consentSubjects.id,input.subjectId)));
      if(!subject)throw new DomainError('NOT_FOUND',404);
      if((input.type==='OWN_LIKENESS'||input.type==='THIRD_PARTY_LIKENESS')&&subject.type!=='PERSON')throw new DomainError('INVALID_INPUT');
      if(input.type==='VOICE_CLONING'&&subject.type==='ORGANIZATION')throw new DomainError('INVALID_INPUT');
      const [existing]=await tx.select().from(consentRecords).where(and(eq(consentRecords.tenantId,tenantId),eq(consentRecords.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.subjectId!==input.subjectId||existing.consentType!==input.type||existing.consentVersion!==input.version||existing.consentTextHash!==input.textHash||existing.acceptedByUserId!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,revokedAt:existing.revokedAt};}
      const [record]=await tx.insert(consentRecords).values({tenantId,subjectId:subject.id,subjectType:subject.type,subjectName:subject.name,consentType:input.type,consentVersion:input.version,consentTextHash:input.textHash,acceptedByUserId:userId,ipAddress:request.ip,userAgent:request.userAgent,idempotencyKey:input.idempotencyKey}).returning({id:consentRecords.id,revokedAt:consentRecords.revokedAt});
      if(!record)throw new Error('Consent insert failed');
      await tx.insert(auditLogs).values({tenantId,userId,action:'CONSENT_ACCEPTED',resourceId:record.id,correlationId,metadata:{type:input.type,version:input.version}});return record;
    });
  }
  async revoke(userId:string,tenantId:string,brandId:string,consentId:string,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);const member=await assertMembership(tx,userId,tenantId);
      const [record]=await tx.select({record:consentRecords}).from(consentRecords).innerJoin(consentSubjects,and(eq(consentSubjects.tenantId,consentRecords.tenantId),eq(consentSubjects.id,consentRecords.subjectId))).where(and(eq(consentRecords.tenantId,tenantId),eq(consentRecords.id,consentId),eq(consentSubjects.brandId,brandId))).for('update');
      if(!record)throw new DomainError('NOT_FOUND',404);
      if(record.record.acceptedByUserId!==userId&&!['OWNER','ADMIN'].includes(member.role))throw new DomainError('NOT_AUTHORIZED',403);
      if(record.record.revokedAt)return {revoked:true};
      // Withdraw the permission scope, including duplicate active attestations.
      // A later explicit new grant remains a separate decision.
      await tx.update(consentRecords).set({revokedAt:new Date(),revokedByUserId:userId}).where(and(eq(consentRecords.tenantId,tenantId),eq(consentRecords.subjectId,record.record.subjectId),eq(consentRecords.consentType,record.record.consentType),isNull(consentRecords.revokedAt))); 
      await tx.insert(auditLogs).values({tenantId,userId,action:'CONSENT_REVOKED',resourceId:consentId,correlationId});return {revoked:true};
    });
  }
}
