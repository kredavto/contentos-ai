import { randomUUID, createHash } from 'node:crypto';
import { and, eq, sql, desc } from 'drizzle-orm';
import { DomainError, type GenerationInput, type WorkflowType, type GenerationOutput, workflowSchemas, generationInputSchema } from '@contentos/types';
import type { Database } from '../index';
import { aiCalls, jobs, outbox, brands, usagePolicies, auditLogs, strategies, strategyVersions, ideas, contentItems, scripts, scriptVersions } from '../schema';
import { lockTenant, assertMembership, reserveInTransaction, settleInTransaction, type Transaction } from './ledger';
export type StoredJob = typeof jobs.$inferSelect;
const jobWhere = (tenantId: string, id: string) => and(eq(jobs.tenantId, tenantId), eq(jobs.id,id));
export async function ownedJob(tx: Transaction, tenantId: string, id: string, leaseToken: string) {
  const [job] = await tx.select().from(jobs).where(jobWhere(tenantId,id)).for('update');
  if (!job || job.status !== 'RUNNING' || job.leaseToken !== leaseToken || !job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= Date.now()) throw new DomainError('CONFLICT',409);
  return job;
}
export class JobRepository {
  constructor(private readonly db: Database) {}
  async enqueue(userId: string, tenantId: string, brandId: string, type: WorkflowType, input: GenerationInput, idempotencyKey: string, provider: string, model: string, correlationId: string) {
    // Hash client intent, not changing derived context; retries must return the
    // original accepted job even when the brand has subsequently changed.
    const inputHash = createHash('sha256').update(JSON.stringify({ brandId, type, options: input.options })).digest('hex');
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId); await assertMembership(tx,userId,tenantId,type === 'GENERATE_STRATEGY' ? 'strategy' : 'generate');
      const [existing] = await tx.select().from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.idempotencyKey,idempotencyKey)));
      if (existing) { if (existing.inputHash !== inputHash || existing.requestedBy !== userId) throw new DomainError('CONFLICT',409); return existing; }
      const [brand] = await tx.select().from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId))).for('share');
      if (!brand) throw new DomainError('NOT_FOUND',404);
      if (!brand.onboardingCompletedAt || brand.revision !== input.brandRevision) throw new DomainError('CONFLICT',409);
      if (input.options.scriptId) {
        const [script] = await tx.select().from(scripts).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,input.options.scriptId)));
        if (!script) throw new DomainError('NOT_FOUND',404);
        if (script.currentVersion !== input.options.revision) throw new DomainError('CONFLICT',409);
      }
      if (input.options.ideaId) {
        const [idea] = await tx.select({id:ideas.id}).from(ideas).where(and(eq(ideas.tenantId,tenantId),eq(ideas.brandId,brandId),eq(ideas.id,input.options.ideaId)));
        if (!idea) throw new DomainError('NOT_FOUND',404);
      }
      const [policy] = await tx.select().from(usagePolicies).where(eq(usagePolicies.operation,type));
      if (!policy) throw new DomainError('CONFIGURATION_REQUIRED',503);
      const reservation = await reserveInTransaction(tx,tenantId,policy.unit,policy.amount,`job:${idempotencyKey}`,correlationId);
      const [job] = await tx.insert(jobs).values({tenantId,brandId,requestedBy:userId,type,input,inputHash,idempotencyKey,reservationId:reservation.id,provider,model,correlationId}).returning();
      if (!job) throw new Error('Job insert failed');
      await tx.insert(outbox).values({tenantId,jobId:job.id});
      await tx.insert(auditLogs).values({tenantId,userId,action:'JOB_QUEUED',resourceId:job.id,correlationId,metadata:{type}});
      return job;
    });
  }
  async list(userId: string, tenantId: string, brandId: string) {
    return this.db.transaction(async tx => { await assertMembership(tx,userId,tenantId); return tx.select({id:jobs.id,type:jobs.type,status:jobs.status,progress:jobs.progress,attempt:jobs.attempt,errorCode:jobs.errorCode,result:jobs.result,createdAt:jobs.createdAt,provider:jobs.provider}).from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.brandId,brandId))).orderBy(desc(jobs.createdAt)).limit(50); });
  }
  async due() {
    return this.db.select({tenantId:jobs.tenantId,id:jobs.id,type:jobs.type}).from(jobs).innerJoin(outbox,and(eq(outbox.tenantId,jobs.tenantId),eq(outbox.jobId,jobs.id))).where(sql`((${jobs.status} in ('QUEUED','RETRY','WAITING_EXTERNAL') and ${jobs.nextAttemptAt} <= now()) or (${jobs.status} = 'RUNNING' and ${jobs.leaseExpiresAt} <= now())) and (${outbox.lastDispatchedAt} is null or ${outbox.lastDispatchedAt} < now() - interval '30 seconds')`).limit(100);
  }
  async dispatched(tenantId:string,id:string) { await this.db.update(outbox).set({lastDispatchedAt:new Date()}).where(and(eq(outbox.tenantId,tenantId),eq(outbox.jobId,id))); }
  async claim(tenantId:string,id:string): Promise<StoredJob | null> {
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId);
      const [job] = await tx.select().from(jobs).where(jobWhere(tenantId,id)).for('update');
      if (!job || job.type === 'CREATE_AVATAR' || ['SUCCEEDED','FAILED','RECONCILIATION'].includes(job.status) || job.nextAttemptAt.getTime() > Date.now() || (job.status === 'RUNNING' && job.leaseExpiresAt && job.leaseExpiresAt.getTime() > Date.now())) return null;
      let permitted = true;
      try { await assertMembership(tx,job.requestedBy,tenantId,job.type === 'GENERATE_STRATEGY' ? 'strategy' : 'generate'); } catch (error) { if (!(error instanceof DomainError)) throw error; permitted = false; }
      if (!permitted || job.attempt >= job.maxAttempts) {
        await settleInTransaction(tx,tenantId,job.reservationId,'RELEASE',job.correlationId);
        await tx.update(jobs).set({status:'FAILED',errorCode:permitted ? 'PROVIDER_UNAVAILABLE' : 'NOT_AUTHORIZED',finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null}).where(jobWhere(tenantId,id));
        return null;
      }
      await tx.update(aiCalls).set({status:'UNKNOWN',errorCode:'WORKER_INTERRUPTED'}).where(and(eq(aiCalls.tenantId,tenantId),eq(aiCalls.jobId,id),eq(aiCalls.status,'STARTED')));
      const [claimed] = await tx.update(jobs).set({status:'RUNNING',attempt:job.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+300_000),startedAt:job.startedAt ?? new Date(),progress:10}).where(jobWhere(tenantId,id)).returning();
      return claimed ?? null;
    });
  }
  async heartbeat(tenantId:string,id:string,leaseToken:string) {
    const updated = await this.db.update(jobs).set({leaseExpiresAt:new Date(Date.now()+300_000)}).where(and(jobWhere(tenantId,id),eq(jobs.status,'RUNNING'),eq(jobs.leaseToken,leaseToken),sql`${jobs.leaseExpiresAt} > now()`)).returning({id:jobs.id});
    return updated.length === 1;
  }
  async fail(tenantId:string,id:string,leaseToken:string,code:string,retryable:boolean) {
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId); const job = await ownedJob(tx,tenantId,id,leaseToken);
      const retry = retryable && job.attempt < job.maxAttempts;
      if (!retry) await settleInTransaction(tx,tenantId,job.reservationId,'RELEASE',job.correlationId);
      await tx.update(jobs).set({status:retry?'RETRY':'FAILED',errorCode:code,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(Date.now()+5000*2**(job.attempt-1)),finishedAt:retry?null:new Date()}).where(jobWhere(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,action:retry?'JOB_RETRY':'JOB_FAILED',resourceId:id,correlationId:job.correlationId,metadata:{code,attempt:job.attempt}});
    });
  }
  async complete(tenantId:string,id:string,leaseToken:string,output:GenerationOutput) {
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId); const job = await ownedJob(tx,tenantId,id,leaseToken);
      await assertMembership(tx,job.requestedBy,tenantId,job.type === 'GENERATE_STRATEGY' ? 'strategy' : 'generate');
      if (job.type === 'CREATE_AVATAR') throw new DomainError('INVALID_INPUT');
      const input = generationInputSchema.parse(job.input);
      let result: {internalId:string;version:number};
      if (job.type === 'GENERATE_STRATEGY') {
        const content = workflowSchemas.GENERATE_STRATEGY.parse(output);
        let [strategy] = await tx.select().from(strategies).where(and(eq(strategies.tenantId,tenantId),eq(strategies.brandId,job.brandId)));
        if (!strategy) [strategy] = await tx.insert(strategies).values({tenantId,brandId:job.brandId}).returning();
        if (!strategy) throw new Error('Strategy insert failed');
        const [latest] = await tx.select({version:strategyVersions.version}).from(strategyVersions).where(and(eq(strategyVersions.tenantId,tenantId),eq(strategyVersions.strategyId,strategy.id))).orderBy(desc(strategyVersions.version)).limit(1);
        const version = (latest?.version ?? 0)+1;
        await tx.insert(strategyVersions).values({tenantId,strategyId:strategy.id,jobId:id,version,content});
        result = {internalId:strategy.id,version};
      } else if (job.type === 'GENERATE_IDEAS') {
        const content = workflowSchemas.GENERATE_IDEAS.parse(output);
        const inserted = await tx.insert(ideas).values(content.ideas.map((idea,ordinal)=>({tenantId,brandId:job.brandId,jobId:id,ordinal,title:idea.title,angle:idea.angle,hook:idea.hook,audienceLabel:idea.audienceSegment,pillarLabel:idea.contentPillar,funnelStage:idea.funnelStage,platform:idea.platform,format:idea.format,score:Math.round(Object.values(idea.scores).reduce((a,b)=>a+b,0)/5),scores:idea.scores,rationale:idea.rationale,source:job.provider}))).returning({id:ideas.id});
        result = {internalId:inserted[0]!.id,version:1};
      } else {
        const content = workflowSchemas.GENERATE_SCRIPT.parse(output);
        let [script] = input.options.scriptId ? await tx.select().from(scripts).where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,job.brandId),eq(scripts.id,input.options.scriptId))) : [];
        if (input.options.scriptId && (!script || script.currentVersion !== input.options.revision)) throw new DomainError('CONFLICT',409);
        if (!script) {
          const [item] = await tx.insert(contentItems).values({tenantId,brandId:job.brandId,ideaId:input.options.ideaId,title:input.options.topic || content.hook.slice(0,200),type:'SHORT_VIDEO'}).returning();
          if (!item) throw new Error('Content insert failed');
          [script] = await tx.insert(scripts).values({tenantId,brandId:job.brandId,contentItemId:item.id,platform:input.options.platform,duration:input.options.duration}).returning();
        }
        if (!script) throw new Error('Script insert failed');
        const version = script.currentVersion+1;
        await tx.insert(scriptVersions).values({tenantId,scriptId:script.id,jobId:id,version,content,createdBy:job.requestedBy});
        await tx.update(scripts).set({currentVersion:version,approvedVersion:null,approvedBy:null}).where(and(eq(scripts.tenantId,tenantId),eq(scripts.id,script.id)));
        await tx.update(contentItems).set({status:'SCRIPT',revision:sql`${contentItems.revision}+1`}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,script.contentItemId)));
        result = {internalId:script.id,version};
      }
      await settleInTransaction(tx,tenantId,job.reservationId,'CAPTURE',job.correlationId);
      await tx.update(jobs).set({status:'SUCCEEDED',progress:100,result,finishedAt:new Date(),leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(jobWhere(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,userId:job.requestedBy,action:'JOB_SUCCEEDED',resourceId:id,correlationId:job.correlationId,metadata:{type:job.type,version:result.version}});
      return result;
    });
  }
}
