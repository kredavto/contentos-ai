import { and, eq, desc, sql } from 'drizzle-orm';
import { DomainError, type ScriptOutput, type PostOutput } from '@contentos/types';
import type { Database } from '../index';
import { strategies, strategyVersions, ideas, scripts, scriptVersions, contentItems, auditLogs, brands, brandReviews, jobs, posts, postVersions } from '../schema';
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
      const reviews = await tx.select({ id:brandReviews.id, scriptId:brandReviews.scriptId, scriptVersion:brandReviews.scriptVersion, brandRevision:brandReviews.brandRevision, content:brandReviews.content, createdAt:brandReviews.createdAt, provider:jobs.provider, rules:sql<Array<{name:string;description:string}>>`coalesce(${jobs.input}->'brain'->'rules', '[]'::jsonb)` }).from(brandReviews).innerJoin(jobs,and(eq(jobs.tenantId,brandReviews.tenantId),eq(jobs.id,brandReviews.jobId))).where(and(eq(brandReviews.tenantId,tenantId),eq(brandReviews.brandId,brandId))).orderBy(desc(brandReviews.createdAt),desc(brandReviews.id)).limit(50);
      const postRows=await tx.select({id:posts.id,currentVersion:posts.currentVersion,approvedVersion:posts.approvedVersion,platform:posts.platform,content:postVersions.content}).from(posts).innerJoin(postVersions,and(eq(postVersions.tenantId,posts.tenantId),eq(postVersions.postId,posts.id),eq(postVersions.version,posts.currentVersion))).where(and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId))).orderBy(desc(posts.createdAt),desc(posts.id)).limit(100);
      return {strategies:strategy,ideas:ideaRows,scripts:scriptRows,posts:postRows,reviews,brandRevision: (await tx.select({revision:brands.revision}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId))))[0]!.revision};
    });
  }
  async postHistory(userId:string,tenantId:string,brandId:string,postId:string) {
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const [post]=await tx.select({id:posts.id}).from(posts).where(and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId),eq(posts.id,postId)));
      if(!post)throw new DomainError('NOT_FOUND',404);
      return tx.select({version:postVersions.version,content:postVersions.content,createdAt:postVersions.createdAt}).from(postVersions).where(and(eq(postVersions.tenantId,tenantId),eq(postVersions.postId,postId))).orderBy(desc(postVersions.version)).limit(100);
    });
  }
  async editPost(userId:string,tenantId:string,brandId:string,postId:string,input:{revision:number;content:PostOutput|null},correlationId:string) {
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,input.content?'generate':'approve');
      const scope=and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId),eq(posts.id,postId));
      const [post]=await tx.select().from(posts).where(scope).for('update');
      if(!post)throw new DomainError('NOT_FOUND',404);
      if(post.currentVersion!==input.revision)throw new DomainError('CONFLICT',409);
      if(!input.content&&post.approvedVersion===post.currentVersion)return {version:post.currentVersion};
      const version=input.content?post.currentVersion+1:post.currentVersion;
      if(input.content)await tx.insert(postVersions).values({tenantId,postId,version,content:input.content,createdBy:userId});
      await tx.update(posts).set({currentVersion:version,approvedVersion:input.content?null:version,approvedBy:input.content?null:userId}).where(scope);
      await tx.update(contentItems).set({...(input.content?{title:input.content.title}:{}),status:input.content?'READY':'APPROVED',revision:sql`${contentItems.revision}+1`}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,post.contentItemId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:input.content?'POST_EDITED':'POST_APPROVED',resourceId:postId,correlationId,metadata:{version}});
      return {version};
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
