import {and,eq,inArray,sql} from 'drizzle-orm';
import {DomainError,type EncryptedCredential,type ProviderKeyProvider} from '@contentos/types';
import type {Database} from '../index';
import {providerKeys,brands,subscriptionTerms,planVersions,plans,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
const metadata={id:providerKeys.id,provider:providerKeys.provider,maskedKey:providerKeys.maskedKey,status:providerKeys.status,revision:providerKeys.revision,updatedAt:providerKeys.updatedAt};
async function entitlement(tx:Transaction,tenantId:string){
 const [term]=await tx.select({id:subscriptionTerms.id}).from(subscriptionTerms).innerJoin(planVersions,eq(planVersions.id,subscriptionTerms.planVersionId)).innerJoin(plans,eq(plans.id,planVersions.planId)).where(and(eq(subscriptionTerms.tenantId,tenantId),inArray(plans.code,['EXPERT','AGENCY']),sql`${subscriptionTerms.startsAt}<=now() and ${subscriptionTerms.endsAt}>now()`)).limit(1);
 if(!term)throw new DomainError('PLAN_LIMIT_REACHED',403);
}
async function authorize(tx:Transaction,userId:string,tenantId:string,brandId:string){
 await assertMembership(tx,userId,tenantId,'billing');
 const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);
}
/** Metadata is safe for a future management API; credentials are worker-only. */
export class ProviderKeyRepository {
 constructor(private readonly db:Database){}
 async list(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId);return tx.select(metadata).from(providerKeys).where(and(eq(providerKeys.tenantId,tenantId),eq(providerKeys.brandId,brandId))).orderBy(providerKeys.provider);});}
 async prepare(userId:string,tenantId:string,brandId:string,provider:ProviderKeyProvider){return this.db.transaction(async tx=>{await authorize(tx,userId,tenantId,brandId);await entitlement(tx,tenantId);const [row]=await tx.select(metadata).from(providerKeys).where(and(eq(providerKeys.tenantId,tenantId),eq(providerKeys.brandId,brandId),eq(providerKeys.provider,provider)));return row??null;});}
 async save(userId:string,tenantId:string,brandId:string,input:{id:string;provider:ProviderKeyProvider;credential:EncryptedCredential;maskedKey:string;revision:number|null},correlationId:string){
  return this.db.transaction(async tx=>{
   await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId);await entitlement(tx,tenantId);
   const [row]=await tx.select(metadata).from(providerKeys).where(and(eq(providerKeys.tenantId,tenantId),eq(providerKeys.brandId,brandId),eq(providerKeys.provider,input.provider))).for('update');
   if((row?.revision??null)!==input.revision||(row&&row.id!==input.id))throw new DomainError('CONFLICT',409);
   const values={credential:input.credential,maskedKey:input.maskedKey,status:'ACTIVE' as const,revision:row?row.revision+1:0,updatedAt:sql`now()`};
   const [saved]=row?await tx.update(providerKeys).set(values).where(eq(providerKeys.id,row.id)).returning(metadata):await tx.insert(providerKeys).values({...values,id:input.id,tenantId,brandId,provider:input.provider,createdBy:userId}).returning(metadata);
   await tx.insert(auditLogs).values({tenantId,userId,resourceId:input.id,action:row?'PROVIDER_KEY_REPLACED':'PROVIDER_KEY_STORED',correlationId,metadata:{provider:input.provider,brandId}});return saved!;
  });
 }
 async revoke(userId:string,tenantId:string,brandId:string,id:string,revision:number,correlationId:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);await authorize(tx,userId,tenantId,brandId);
  const [row]=await tx.select(metadata).from(providerKeys).where(and(eq(providerKeys.tenantId,tenantId),eq(providerKeys.brandId,brandId),eq(providerKeys.id,id))).for('update');
  if(!row)throw new DomainError('NOT_FOUND',404);if(row.revision!==revision)throw new DomainError('CONFLICT',409);if(row.status==='REVOKED')return row;
  const [saved]=await tx.update(providerKeys).set({status:'REVOKED',credential:null,revision:revision+1,updatedAt:sql`now()`}).where(eq(providerKeys.id,id)).returning(metadata);
  await tx.insert(auditLogs).values({tenantId,userId,resourceId:id,action:'PROVIDER_KEY_REVOKED',correlationId});return saved!;
 });}
 /** Internal job execution rechecks entitlement and the exact connection revision. Never expose through HTTP. */
 async resolve(userId:string,tenantId:string,brandId:string,id:string,revision:number){return this.db.transaction(async tx=>{
  await assertMembership(tx,userId,tenantId,'generate');await entitlement(tx,tenantId);
  const [row]=await tx.select().from(providerKeys).where(and(eq(providerKeys.tenantId,tenantId),eq(providerKeys.brandId,brandId),eq(providerKeys.id,id),eq(providerKeys.revision,revision),eq(providerKeys.status,'ACTIVE')));
  if(!row?.credential)throw new DomainError('CONFIGURATION_REQUIRED',503);return row;
 });}
}
