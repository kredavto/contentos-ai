import { and, eq, desc, sql } from 'drizzle-orm';
import { DomainError, type ScriptOutput } from '@contentos/types';
import type { Database } from '../index';
import { strategies, strategyVersions, ideas, scripts, scriptVersions, contentItems, auditLogs, brands } from '../schema';
import { assertMembership, lockTenant } from './ledger';
export class ContentRepository {
  constructor(private readonly db:Database) {}
  async overview(userId:string,tenantId:string,brandId:string) {
    return this.db.transaction(async tx=> {
      await assertMembership(tx,userId,tenantId);
      const [brand] = await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));
      if (!brand) throw new DomainError('NOT_FOUND',404);
      const strategy = await tx.select({id:strategyVersions.id,strategyId:strategyVersions.strategyId,version:strategyVersions.version,content:strategyVersions.content,createdAt:strategyVersions.createdAt}).from(strategyVersions).innerJoin(strategies,and(eq(strategies.tenantId,strategyVersions.tenantId),eq(strategies.id,strategyVersions.strategyId))).where(and(eq(strategies.tenantId,tenantId),eq(strategies.brandId,brandId))).orderBy(desc(strategyVersions.version)).limit(20);
      const ideaRows = await tx.select().from(ideas).where(and(eq(ideas.tenantId,tenantId),eq(ideas.brandId,brandId))).orderBy(desc(ideas.createdAt)).limit(100);
      const scriptRows = await tx.select({id:scripts.id,currentVersion:scripts.currentVersion,approvedVersion:scripts.approvedVersion,platform:scripts.platform,duration:scripts.duration,content:scriptVersions.content}).from(scripts).innerJoin(scriptVersions,and(eq(scriptVersions.tenantId,scripts.tenantId),eq(scriptVersions.scriptId,scripts.id),eq(scriptVersions.version,scripts.currentVersion))).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId))).orderBy(desc(scripts.createdAt)).limit(100);
      return {strategies:strategy,ideas:ideaRows,scripts:scriptRows};
    });
  }
  async history(userId:string,tenantId:string,brandId:string,scriptId:string) {
    return this.db.transaction(async tx=> {
      await assertMembership(tx,userId,tenantId);
      const [script] = await tx.select().from(scripts).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,scriptId)));
      if (!script) throw new DomainError('NOT_FOUND',404);
      return tx.select().from(scriptVersions).where(and(eq(scriptVersions.tenantId,tenantId),eq(scriptVersions.scriptId,scriptId))).orderBy(desc(scriptVersions.version)).limit(100);
    });
  }
  async editScript(userId:string,tenantId:string,brandId:string,scriptId:string,revision:number,content:ScriptOutput | null,correlationId:string) {
    return this.db.transaction(async tx=> {
      await lockTenant(tx,tenantId); await assertMembership(tx,userId,tenantId,content ? 'generate' : 'approve');
      const [script] = await tx.select().from(scripts).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,scriptId))).for('update');
      if (!script) throw new DomainError('NOT_FOUND',404);
      if (script.currentVersion !== revision || revision < 1) throw new DomainError('CONFLICT',409);
      if (content) {
        await tx.insert(scriptVersions).values({tenantId,scriptId,version:revision+1,content,createdBy:userId});
        await tx.update(scripts).set({currentVersion:revision+1,approvedVersion:null,approvedBy:null}).where(and(eq(scripts.tenantId,tenantId),eq(scripts.id,scriptId)));
      } else await tx.update(scripts).set({approvedVersion:revision,approvedBy:userId}).where(and(eq(scripts.tenantId,tenantId),eq(scripts.id,scriptId)));
      await tx.update(contentItems).set({status:content?'SCRIPT':'APPROVED_SCRIPT',revision:sql`${contentItems.revision}+1`}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,script.contentItemId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:content?'SCRIPT_EDITED':'SCRIPT_APPROVED',resourceId:scriptId,correlationId,metadata:{version:content?revision+1:revision}});
      return {version:content?revision+1:revision};
    });
  }
}
