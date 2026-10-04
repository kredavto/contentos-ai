import {createHash} from 'node:crypto';
import {and,eq,gte,lt,asc} from 'drizzle-orm';
import {DomainError,calendarInstant,type CalendarCreate,type CalendarUpdate,type CalendarFields} from '@contentos/types';
import type {Database} from '../index';
import {calendarEntries,contentItems,brands,videoProjects,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';
import {assertCalendarEditable} from './publishing';
import {validateVideo} from './videos';
import type {ConsentPolicy} from './avatars';
const where=(tenantId:string,brandId:string,id:string)=>and(eq(calendarEntries.tenantId,tenantId),eq(calendarEntries.brandId,brandId),eq(calendarEntries.id,id));
async function ownedBrand(tx:Transaction,tenantId:string,brandId:string){const [brand]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));if(!brand)throw new DomainError('NOT_FOUND',404);}
async function validateSource(tx:Transaction,tenantId:string,brandId:string,input:CalendarFields,policies:ConsentPolicy[]){
  if(!input.videoProjectId)return;
  if(!['SHORT_VIDEO','STORY'].includes(input.type))throw new DomainError('INVALID_INPUT');
  const [video]=await tx.select().from(videoProjects).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.brandId,brandId),eq(videoProjects.id,input.videoProjectId)));
  if(!video)throw new DomainError('NOT_FOUND',404);
  if(video.stage!=='READY'||!video.approvedAt)throw new DomainError('CONFLICT',409);
  await validateVideo(tx,video,policies);
}
const values=(input:CalendarFields)=>({videoProjectId:input.videoProjectId,plannedAt:calendarInstant(input.localDateTime,input.timeZone,input.disambiguation),timeZone:input.timeZone,platform:input.platform,caption:input.caption,hashtags:input.hashtags,privacy:input.privacy,commentsEnabled:input.commentsEnabled,publishingMode:input.publishingMode});
export class CalendarRepository{
  constructor(private readonly db:Database){}
  async list(userId:string,tenantId:string,brandId:string,from:Date,to:Date){
    return this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId);await ownedBrand(tx,tenantId,brandId);
      const rows=await tx.select({entry:calendarEntries,title:contentItems.title,type:contentItems.type,contentStatus:contentItems.status,videoStage:videoProjects.stage,videoLifecycle:videoProjects.lifecycle,videoApprovedAt:videoProjects.approvedAt}).from(calendarEntries).innerJoin(contentItems,and(eq(contentItems.tenantId,calendarEntries.tenantId),eq(contentItems.id,calendarEntries.contentItemId))).leftJoin(videoProjects,and(eq(videoProjects.tenantId,calendarEntries.tenantId),eq(videoProjects.id,calendarEntries.videoProjectId))).where(and(eq(calendarEntries.tenantId,tenantId),eq(calendarEntries.brandId,brandId),gte(calendarEntries.plannedAt,from),lt(calendarEntries.plannedAt,to),eq(calendarEntries.status,'PLANNED'))).orderBy(asc(calendarEntries.plannedAt),asc(calendarEntries.id)).limit(501);
      if(rows.length>500)throw new DomainError('PLAN_LIMIT_REACHED',422);
      return rows.map(({entry,...content})=>{const {inputHash:_hash,idempotencyKey:_key,createdBy:_by,...safe}=entry;return {...safe,...content};});
    });
  }
  async create(userId:string,tenantId:string,brandId:string,input:CalendarCreate,policies:ConsentPolicy[],correlationId:string){
    const inputHash=createHash('sha256').update(JSON.stringify({brandId,...input})).digest('hex');const fields=values(input);
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');await ownedBrand(tx,tenantId,brandId);
      const [existing]=await tx.select().from(calendarEntries).where(and(eq(calendarEntries.tenantId,tenantId),eq(calendarEntries.idempotencyKey,input.idempotencyKey)));
      if(existing){if(existing.inputHash!==inputHash||existing.createdBy!==userId)throw new DomainError('CONFLICT',409);return {id:existing.id,revision:existing.revision};}
      await validateSource(tx,tenantId,brandId,input,policies);
      const [content]=await tx.insert(contentItems).values({tenantId,brandId,title:input.title,type:input.type,status:input.videoProjectId?'APPROVED':'IDEA'}).returning();
      const [entry]=await tx.insert(calendarEntries).values({...fields,tenantId,brandId,contentItemId:content!.id,idempotencyKey:input.idempotencyKey,inputHash,createdBy:userId}).returning();
      await tx.insert(auditLogs).values({tenantId,userId,action:'CALENDAR_ENTRY_CREATED',resourceId:entry!.id,correlationId,metadata:{plannedAt:fields.plannedAt.toISOString(),timeZone:input.timeZone,platform:input.platform}});return {id:entry!.id,revision:entry!.revision};
    });
  }
  async update(userId:string,tenantId:string,brandId:string,id:string,input:CalendarUpdate,policies:ConsentPolicy[],correlationId:string){
    const fields=values(input);
    return this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [entry]=await tx.select().from(calendarEntries).where(where(tenantId,brandId,id));if(!entry)throw new DomainError('NOT_FOUND',404);
      await assertCalendarEditable(tx,tenantId,id);
      if(entry.status!=='PLANNED'||entry.revision!==input.revision)throw new DomainError('CONFLICT',409);await validateSource(tx,tenantId,brandId,input,policies);
      await tx.update(calendarEntries).set({...fields,revision:entry.revision+1,updatedAt:new Date()}).where(where(tenantId,brandId,id));
      await tx.update(contentItems).set({title:input.title,type:input.type,status:input.videoProjectId?'APPROVED':'IDEA',revision:entry.revision+1}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,entry.contentItemId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:'CALENDAR_ENTRY_UPDATED',resourceId:id,correlationId,metadata:{revision:entry.revision+1,plannedAt:fields.plannedAt.toISOString(),timeZone:input.timeZone}});return {id,revision:entry.revision+1};
    });
  }
  async cancel(userId:string,tenantId:string,brandId:string,id:string,revision:number,correlationId:string){
    await this.db.transaction(async tx=>{await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');const [entry]=await tx.select().from(calendarEntries).where(where(tenantId,brandId,id));if(!entry)throw new DomainError('NOT_FOUND',404);if(entry.status==='CANCELLED')return;
      await assertCalendarEditable(tx,tenantId,id);
      if(entry.revision!==revision)throw new DomainError('CONFLICT',409);
      await tx.update(calendarEntries).set({status:'CANCELLED',revision:entry.revision+1,updatedAt:new Date()}).where(where(tenantId,brandId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'CALENDAR_ENTRY_CANCELLED',resourceId:id,correlationId});
    });
  }
}
