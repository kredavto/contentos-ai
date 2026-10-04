import { and, eq, desc } from 'drizzle-orm';
import { DomainError, type Usage } from '@contentos/types';
import type { Database } from '../index';
import { aiCalls, jobs } from '../schema';
import type { StoredJob } from './jobs';
export class AICallRepository {
  constructor(private readonly db:Database,private readonly job:StoredJob) {}
  private filter(call:number) { return and(eq(aiCalls.tenantId,this.job.tenantId),eq(aiCalls.jobId,this.job.id),eq(aiCalls.attempt,this.job.attempt),eq(aiCalls.call,call)); }
  async cached() {
    return this.db.select({output:aiCalls.output}).from(aiCalls).where(and(eq(aiCalls.tenantId,this.job.tenantId),eq(aiCalls.jobId,this.job.id),eq(aiCalls.status,'SUCCEEDED'))).orderBy(desc(aiCalls.attempt),desc(aiCalls.call)).limit(9);
  }
  async started(call:number,provider:string,model:string) {
    await this.db.transaction(async tx => {
      const [active] = await tx.select().from(jobs).where(and(eq(jobs.tenantId,this.job.tenantId),eq(jobs.id,this.job.id))).for('share');
      if (!active || active.status !== 'RUNNING' || active.leaseToken !== this.job.leaseToken || !active.leaseExpiresAt || active.leaseExpiresAt.getTime() <= Date.now()) throw new DomainError('CONFLICT',409);
      await tx.insert(aiCalls).values({tenantId:this.job.tenantId,jobId:this.job.id,attempt:this.job.attempt,call,provider,model,status:'STARTED'});
    });
  }
  async succeeded(call:number,result:{json:unknown;usage:Usage},durationMs:number) {
    await this.db.update(aiCalls).set({status:'SUCCEEDED',output:result.json,inputUnits:result.usage.inputUnits,outputUnits:result.usage.outputUnits,providerCostMicrounits:result.usage.costMicrounits,currency:result.usage.currency,durationMs}).where(this.filter(call));
  }
  async failed(call:number,code:string,durationMs:number) {
    await this.db.update(aiCalls).set({status:code === 'PROVIDER_UNAVAILABLE' ? 'UNKNOWN' : 'FAILED',errorCode:code,durationMs}).where(this.filter(call));
  }
}
