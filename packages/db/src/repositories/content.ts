import { and, eq, desc, sql, isNull, isNotNull, lt } from 'drizzle-orm';
import { DomainError, type ScriptOutput, type PostOutput, type PostHistoryQuery, type CarouselOutput, type CarouselLifecycle, type CarouselExportRevision, type CarouselHistoryQuery } from '@contentos/types';
import type { Database } from '../index';
import { strategies, strategyVersions, ideas, scripts, scriptVersions, contentItems, auditLogs, brands, brandReviews, jobs, posts, postVersions, carousels, carouselVersions } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
function listCarousels(tx:Transaction,tenantId:string,brandId:string,archived:boolean){return tx.select({id:carousels.id,archivedAt:carousels.archivedAt,lifecycleRevision:carousels.lifecycleRevision,currentVersion:carousels.currentVersion,approvedVersion:carousels.approvedVersion,platform:carousels.platform,content:carouselVersions.content}).from(carousels).innerJoin(carouselVersions,and(eq(carouselVersions.tenantId,carousels.tenantId),eq(carouselVersions.carouselId,carousels.id),eq(carouselVersions.version,carousels.currentVersion))).where(and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),archived?isNotNull(carousels.archivedAt):isNull(carousels.archivedAt))).orderBy(desc(carousels.createdAt),desc(carousels.id)).limit(100);}
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
      const carouselRows=await listCarousels(tx,tenantId,brandId,false),archivedCarousels=await listCarousels(tx,tenantId,brandId,true);
      return {strategies:strategy,ideas:ideaRows,scripts:scriptRows,posts:postRows,carousels:carouselRows,archivedCarousels,reviews,brandRevision: (await tx.select({revision:brands.revision}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId))))[0]!.revision};
    });
  }
  postHistory(userId:string,tenantId:string,brandId:string,postId:string) {
    return this.readPostHistory(userId,tenantId,brandId,postId,100);
  }
  async postHistoryPage(userId:string,tenantId:string,brandId:string,postId:string,input:PostHistoryQuery){
    const rows=await this.readPostHistory(userId,tenantId,brandId,postId,21,input.before),items=rows.slice(0,20);
    return {items,nextBefore:rows.length>20?items.at(-1)!.version:null};
  }
  private async readPostHistory(userId:string,tenantId:string,brandId:string,postId:string,limit:number,before?:number) {
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const [post]=await tx.select({id:posts.id}).from(posts).where(and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId),eq(posts.id,postId)));
      if(!post)throw new DomainError('NOT_FOUND',404);
      return tx.select({version:postVersions.version,content:postVersions.content,createdAt:postVersions.createdAt}).from(postVersions).where(and(eq(postVersions.tenantId,tenantId),eq(postVersions.postId,postId),before===undefined?undefined:lt(postVersions.version,before))).orderBy(desc(postVersions.version)).limit(limit);
    });
  }
  async editPost(userId:string,tenantId:string,brandId:string,postId:string,input:{revision:number;content:PostOutput|null},correlationId:string) {
    return this.db.transaction(async tx=>{
      return editPostInTransaction(tx,userId,tenantId,brandId,postId,input,correlationId);
    });
  }
  carouselHistory(userId:string,tenantId:string,brandId:string,carouselId:string) {
    return this.readCarouselHistory(userId,tenantId,brandId,carouselId,100);
  }
  async carouselHistoryPage(userId:string,tenantId:string,brandId:string,carouselId:string,input:CarouselHistoryQuery){
    const rows=await this.readCarouselHistory(userId,tenantId,brandId,carouselId,21,input.before);
    const items=rows.slice(0,20);
    return {items,nextBefore:rows.length>20?items.at(-1)!.version:null};
  }
  private async readCarouselHistory(userId:string,tenantId:string,brandId:string,carouselId:string,limit:number,before?:number) {
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const [carousel]=await tx.select({id:carousels.id}).from(carousels).where(and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,carouselId)));
      if(!carousel)throw new DomainError('NOT_FOUND',404);
      return tx.select({version:carouselVersions.version,content:carouselVersions.content,createdAt:carouselVersions.createdAt}).from(carouselVersions).where(and(eq(carouselVersions.tenantId,tenantId),eq(carouselVersions.carouselId,carouselId),before===undefined?undefined:lt(carouselVersions.version,before))).orderBy(desc(carouselVersions.version)).limit(limit);
    });
  }
  async authorizeCarouselExport(userId:string,tenantId:string,brandId:string,carouselId:string,input:CarouselExportRevision){
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      const [carousel]=await tx.select().from(carousels).where(and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,carouselId))).for('share');
      if(!carousel)throw new DomainError('NOT_FOUND',404);
      if(carousel.archivedAt||carousel.currentVersion!==input.revision||carousel.lifecycleRevision!==input.lifecycleRevision||carousel.approvedVersion!==carousel.currentVersion)throw new DomainError('CONFLICT',409);
      return {version:carousel.currentVersion,lifecycleRevision:carousel.lifecycleRevision};
    });
  }
  async setCarouselArchived(userId:string,tenantId:string,brandId:string,carouselId:string,input:CarouselLifecycle,correlationId:string){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const scope=and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,carouselId));
      const [carousel]=await tx.select().from(carousels).where(scope).for('update');
      if(!carousel)throw new DomainError('NOT_FOUND',404);
      if(carousel.currentVersion!==input.revision)throw new DomainError('CONFLICT',409);
      const same=!!carousel.archivedAt===input.archived;
      if(same&&(carousel.lifecycleRevision===input.lifecycleRevision||carousel.lifecycleRevision===input.lifecycleRevision+1))return {lifecycleRevision:carousel.lifecycleRevision,archived:input.archived};
      if(carousel.lifecycleRevision!==input.lifecycleRevision)throw new DomainError('CONFLICT',409);
      const lifecycleRevision=carousel.lifecycleRevision+1;
      await tx.update(carousels).set({archivedAt:input.archived?new Date():null,lifecycleRevision,approvedVersion:null,approvedBy:null}).where(scope);
      await tx.update(contentItems).set({status:'READY',revision:sql`${contentItems.revision}+1`}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,carousel.contentItemId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:input.archived?'CAROUSEL_ARCHIVED':'CAROUSEL_RESTORED',resourceId:carouselId,correlationId,metadata:{version:carousel.currentVersion,lifecycleRevision}});
      return {lifecycleRevision,archived:input.archived};
    });
  }
  async editCarousel(userId:string,tenantId:string,brandId:string,carouselId:string,input:{revision:number;lifecycleRevision?:number;content:CarouselOutput|null},correlationId:string) {
    return this.db.transaction(async tx=>{
      return editCarouselInTransaction(tx,userId,tenantId,brandId,carouselId,input,correlationId);
    });
  }
  /** Exact saved idea lookup, independent of the capped studio overview. */
  async currentIdea(userId:string,tenantId:string,brandId:string,ideaId:string) {
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const [idea]=await tx.select({id:ideas.id,brandId:ideas.brandId,brandName:brands.name,title:ideas.title,angle:ideas.angle,hook:ideas.hook,audienceLabel:ideas.audienceLabel,pillarLabel:ideas.pillarLabel,funnelStage:ideas.funnelStage,platform:ideas.platform,format:ideas.format,score:ideas.score,scores:ideas.scores,rationale:ideas.rationale,status:ideas.status})
        .from(ideas).innerJoin(brands,and(eq(brands.tenantId,ideas.tenantId),eq(brands.id,ideas.brandId)))
        .where(and(eq(ideas.tenantId,tenantId),eq(ideas.brandId,brandId),eq(ideas.id,ideaId)));
      if(!idea)throw new DomainError('NOT_FOUND',404);
      return {...idea,role:member.role};
    });
  }
  /** Exact current script lookup, independent of the capped studio overview. */
  async currentScript(userId:string,tenantId:string,brandId:string,scriptId:string) {
    return this.db.transaction(async tx=>{
      const member=await assertMembership(tx,userId,tenantId);
      const [script]=await tx.select({id:scripts.id,brandId:scripts.brandId,brandName:brands.name,title:contentItems.title,currentVersion:scripts.currentVersion,approvedVersion:scripts.approvedVersion,platform:scripts.platform,duration:scripts.duration,content:scriptVersions.content})
        .from(scripts)
        .innerJoin(brands,and(eq(brands.tenantId,scripts.tenantId),eq(brands.id,scripts.brandId)))
        .innerJoin(contentItems,and(eq(contentItems.tenantId,scripts.tenantId),eq(contentItems.brandId,scripts.brandId),eq(contentItems.id,scripts.contentItemId)))
        .innerJoin(scriptVersions,and(eq(scriptVersions.tenantId,scripts.tenantId),eq(scriptVersions.scriptId,scripts.id),eq(scriptVersions.version,scripts.currentVersion)))
        .where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,scriptId)));
      if(!script)throw new DomainError('NOT_FOUND',404);
      return {...script,role:member.role};
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
      return editScriptInTransaction(tx,userId,tenantId,brandId,scriptId,revision,content,correlationId);
    });
  }
}

export async function editScriptInTransaction(tx:Transaction,userId:string,tenantId:string,brandId:string,scriptId:string,revision:number,content:ScriptOutput|null,correlationId:string){
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
}

export async function editPostInTransaction(tx:Transaction,userId:string,tenantId:string,brandId:string,postId:string,input:{revision:number;content:PostOutput|null},correlationId:string){
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
}

export async function editCarouselInTransaction(tx:Transaction,userId:string,tenantId:string,brandId:string,carouselId:string,input:{revision:number;lifecycleRevision?:number;content:CarouselOutput|null},correlationId:string){
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,input.content?'generate':'approve');
      const scope=and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,carouselId));
      const [carousel]=await tx.select().from(carousels).where(scope).for('update');
      if(!carousel)throw new DomainError('NOT_FOUND',404);
      if(carousel.archivedAt||carousel.lifecycleRevision!==(input.lifecycleRevision??0)||carousel.currentVersion!==input.revision)throw new DomainError('CONFLICT',409);
      if(!input.content&&carousel.approvedVersion===carousel.currentVersion)return {version:carousel.currentVersion};
      const version=input.content?carousel.currentVersion+1:carousel.currentVersion;
      if(input.content)await tx.insert(carouselVersions).values({tenantId,carouselId,version,content:input.content,createdBy:userId});
      await tx.update(carousels).set({currentVersion:version,approvedVersion:input.content?null:version,approvedBy:input.content?null:userId}).where(scope);
      await tx.update(contentItems).set({...(input.content?{title:input.content.title}:{}),status:input.content?'READY':'APPROVED',revision:sql`${contentItems.revision}+1`}).where(and(eq(contentItems.tenantId,tenantId),eq(contentItems.id,carousel.contentItemId)));
      await tx.insert(auditLogs).values({tenantId,userId,action:input.content?'CAROUSEL_EDITED':'CAROUSEL_APPROVED',resourceId:carouselId,correlationId,metadata:{version}});
      return {version};
}
