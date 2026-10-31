import {and,eq} from 'drizzle-orm';
import {DomainError} from '@contentos/types';
import {videoProjects,generatedImages,scripts,scriptVersions,contentItems,posts,postVersions,carousels,carouselVersions} from '../schema';
import type {Transaction} from './ledger';
type Target={videoId?:string|null;imageId?:string|null;scriptId?:string|null;postId?:string|null;carouselId?:string|null;version:number};
/** Tenant lock is held for mutation callers; reads expose only the requested immutable version. */
export async function approvalTarget(tx:Transaction,tenantId:string,brandId:string,target:Target){
  if(target.scriptId){
    const [row]=await tx.select({id:scripts.id,currentVersion:scripts.currentVersion,approvedVersion:scripts.approvedVersion,title:contentItems.title,content:scriptVersions.content}).from(scripts)
      .innerJoin(contentItems,and(eq(contentItems.tenantId,scripts.tenantId),eq(contentItems.brandId,scripts.brandId),eq(contentItems.id,scripts.contentItemId)))
      .innerJoin(scriptVersions,and(eq(scriptVersions.tenantId,scripts.tenantId),eq(scriptVersions.scriptId,scripts.id),eq(scriptVersions.version,target.version)))
      .where(and(eq(scripts.tenantId,tenantId),eq(scripts.brandId,brandId),eq(scripts.id,target.scriptId)));
    if(!row)throw new DomainError('NOT_FOUND',404);return {...row,entityType:'SCRIPT' as const,archived:false,lifecycleRevision:null,mediaHash:null,coverRevision:null};
  }
  if(target.postId){
    const [row]=await tx.select({id:posts.id,currentVersion:posts.currentVersion,approvedVersion:posts.approvedVersion,content:postVersions.content}).from(posts)
      .innerJoin(postVersions,and(eq(postVersions.tenantId,posts.tenantId),eq(postVersions.postId,posts.id),eq(postVersions.version,target.version)))
      .where(and(eq(posts.tenantId,tenantId),eq(posts.brandId,brandId),eq(posts.id,target.postId)));
    if(!row)throw new DomainError('NOT_FOUND',404);return {...row,title:row.content.title,entityType:'POST' as const,archived:false,lifecycleRevision:null,mediaHash:null,coverRevision:null};
  }
  if(target.carouselId){
    const [row]=await tx.select({id:carousels.id,currentVersion:carousels.currentVersion,approvedVersion:carousels.approvedVersion,content:carouselVersions.content,archivedAt:carousels.archivedAt,lifecycleRevision:carousels.lifecycleRevision}).from(carousels)
      .innerJoin(carouselVersions,and(eq(carouselVersions.tenantId,carousels.tenantId),eq(carouselVersions.carouselId,carousels.id),eq(carouselVersions.version,target.version)))
      .where(and(eq(carousels.tenantId,tenantId),eq(carousels.brandId,brandId),eq(carousels.id,target.carouselId)));
    if(!row)throw new DomainError('NOT_FOUND',404);const {archivedAt,...rest}=row;return {...rest,title:row.content.title,entityType:'CAROUSEL' as const,archived:!!archivedAt,mediaHash:null,coverRevision:null};
  }
  if(target.imageId){
    const [row]=await tx.select({id:generatedImages.id,title:generatedImages.name,status:generatedImages.status,mediaHash:generatedImages.sha256,approvedAt:generatedImages.approvedAt}).from(generatedImages).where(and(eq(generatedImages.tenantId,tenantId),eq(generatedImages.brandId,brandId),eq(generatedImages.id,target.imageId)));
    if(!row)throw new DomainError('NOT_FOUND',404);
    return {id:row.id,title:row.title,entityType:'IMAGE' as const,content:null,currentVersion:1,approvedVersion:row.approvedAt?1:null,archived:row.status!=='READY',lifecycleRevision:null,mediaHash:row.mediaHash,coverRevision:null};
  }
  if(target.videoId){
    const [row]=await tx.select({id:videoProjects.id,title:videoProjects.title,currentVersion:videoProjects.stageRevision,coverRevision:videoProjects.coverRevision,stage:videoProjects.stage,lifecycle:videoProjects.lifecycle,approvedAt:videoProjects.approvedAt}).from(videoProjects).where(and(eq(videoProjects.tenantId,tenantId),eq(videoProjects.brandId,brandId),eq(videoProjects.id,target.videoId)));
    if(!row)throw new DomainError('NOT_FOUND',404);
    return {id:row.id,title:row.title,entityType:'VIDEO' as const,content:null,currentVersion:row.currentVersion,approvedVersion:row.approvedAt?row.currentVersion:null,archived:row.stage!=='READY'||row.lifecycle!=='ACTIVE',lifecycleRevision:null,mediaHash:null,coverRevision:row.coverRevision};
  }
  throw new DomainError('NOT_FOUND',404);
}
