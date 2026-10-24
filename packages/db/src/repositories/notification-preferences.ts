import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError } from '@contentos/types';
import type { Database } from '../index';
import { notificationPreferences, users, auditLogs } from '../schema';
import { assertMembership, lockTenant } from './ledger';
const initial={emailEnabled:false,revision:null,enabledAt:null};
/** Preferences belong to the authenticated recipient, never an arbitrary supplied user. */
export class NotificationPreferencesRepository {
  constructor(private readonly db:Database){}
  async get(userId:string,tenantId:string){
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const [row]=await tx.select({emailEnabled:notificationPreferences.emailEnabled,revision:notificationPreferences.revision,enabledAt:notificationPreferences.enabledAt}).from(notificationPreferences).where(and(eq(notificationPreferences.tenantId,tenantId),eq(notificationPreferences.userId,userId)));
      return row??initial;
    });
  }
  async update(userId:string,tenantId:string,input:{emailEnabled:boolean;revision:string|null},correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId);
      const [row]=await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.tenantId,tenantId),eq(notificationPreferences.userId,userId))).for('update');
      if((row?.revision??null)!==input.revision)throw new DomainError('CONFLICT',409);
      if(input.emailEnabled){
        const [user]=await tx.select({verified:users.emailVerifiedAt}).from(users).where(eq(users.id,userId));
        if(!user?.verified)throw new DomainError('NOT_AUTHORIZED',403);
      }
      if((row?.emailEnabled??false)===input.emailEnabled)return row?{emailEnabled:row.emailEnabled,revision:row.revision,enabledAt:row.enabledAt}:initial;
      const revision=randomUUID(),values={emailEnabled:input.emailEnabled,revision,enabledAt:input.emailEnabled?sql`now()`:null,updatedAt:sql`now()`};
      const [saved]=row?await tx.update(notificationPreferences).set(values).where(eq(notificationPreferences.id,row.id)).returning():await tx.insert(notificationPreferences).values({...values,tenantId,userId}).returning();
      await tx.insert(auditLogs).values({tenantId,userId,resourceId:saved!.id,action:'NOTIFICATION_PREFERENCES_CHANGED',correlationId,metadata:{emailEnabled:input.emailEnabled}});
      return {emailEnabled:saved!.emailEnabled,revision:saved!.revision,enabledAt:saved!.enabledAt};
    });
  }
}
