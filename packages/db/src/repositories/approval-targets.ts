import {and,eq} from 'drizzle-orm';
import {DomainError} from '@contentos/types';
import {scripts,scriptVersions,contentItems,posts,postVersions,carousels,carouselVersions} from '../schema';
import type {Transaction} from './ledger';
type Target={scriptId?:string|null;postId?:string|null;carouselId?:string|null;version:number};
/** Tenant lock is held for mutation callers; reads expose only the requested immutable version. */
export async function approvalTarget(tx:Transaction,tenantId:string,brandId:string,target:Target){
  if(target.scriptId){
    const [row]=await tx.select({id:scripts.id,currentVersion:scripts.currentVersion,approvedVersion:scripts.approvedVersion,title:contentItems.title,content:scriptVersions.content}).from(scripts)
      .innerJoin(contentItems,and(eq(contentItems.tenantId,scripts.tenantId),eq(contentItems.brandId,scripts.brandId),eq(contentItems.id,scripts.contentItemId)))
      .innerJoin(scriptVersions,and(eq(scriptVersions.tenantId,scripts.tenantId),eq(scriptVersions.scriptId,scripts.id),eq(scriptVersions.version,target.version)))
      .where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,target.scriptId)));
    if(!row)throw new DomainError('NOT_FOUND',404);return {...row,entityType:'SCRIPT' as const,archived:false,lifecycleRevision:null};
  }
  if(target.postId){
    const [row]=await tx.select({id:posts.id,currentVersion:posts.currentVersion,approvedVersion:posts.approvedVersion,content:postVersions.content}).from(posts)
      .innerJoin(postVersions,and(eq(postVersions.tenantId,posts.tenantId),eq(postVersions.postId,posts.id),eq(postVersions.version,target.version)))
      .where(and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId),eq(posts.id,target.postId)));
    if(!row)throw new DomainError('NOT_FOUND',404);return {...row,title:row.content.title,entityType:'POST' as const,archived:false,lifecycleRevision:null};
  }
  if(target.carouselId){
    const [row]=await tx.select({id:carousels.id,currentVersion:carousels.currentVersion,approvedVersion:carousels.approvedVersion,content:carouselVersions.content,archivedAt:carousels.archivedAt,lifecycleRevision:carousels.lifecycleRevision}).from(carousels)
      .innerJoin(carouselVersions,and(eq(carouselVersions.tenantId,carousels.tenantId),eq(carouselVersions.carouselId,carousels.id),eq(carouselVersions.version,target.version)))
      .where(and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,target.carouselId)));
    if(!row)throw new DomainError('NOT_FOUND',404);const {archivedAt,...rest}=row;return {...rest,title:row.content.title,entityType:'CAROUSEL' as const,archived:!!archivedAt};
  }
  throw new DomainError('NOT_FOUND',404);
}
