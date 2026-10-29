import {describe,expect,it} from 'vitest';
import {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../../packages/db/src/index';
import {GenerationService} from '../../packages/core/src/generation';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {contentDetailFixture} from '../helpers/content-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('exact current content detail',()=>{
  const database=isolatedTestDatabase(url),repository=new ContentRepository(database.db);
  const service=new GenerationService(new JobRepository(database.db),new BrandRepository(database.db),new LedgerRepository(database.db),repository,{provider:'unconfigured',model:'',ready:false});
  it('reads current post text and approval beyond the overview cap without mutating evidence',async()=>{
    const f=await contentDetailFixture(database.client),overview=await repository.overview(f.user,f.tenant,f.brand);
    expect(overview.posts).toHaveLength(100);expect(overview.posts.some(row=>row.id===f.postId)).toBe(false);
    const row=await service.currentContent(f.user,f.tenant,f.brand,f.postContentId);
    expect(row).toMatchObject({id:f.postContentId,brandId:f.brand,title:f.postTitle,type:'POST',status:'APPROVED',revision:7,role:'VIEWER',detail:{kind:'POST',id:f.postId,version:2,approvedVersion:2,platform:'TELEGRAM',content:f.post}});
    expect(JSON.stringify(row)).not.toContain('Historical post body');
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(0);
    expect(await database.client`select id from audit_logs where tenant_id=${f.tenant}`).toHaveLength(0);
    const [saved]=await database.client`select current_version,approved_version from posts where id=${f.postId}`;expect(saved).toMatchObject({current_version:2,approved_version:2});
    await expect(database.client`update content_versions set content='{}' where post_id=${f.postId} and version=1`).rejects.toThrow();
  });
  it('reads the exact archived carousel and current slides beyond the archived overview cap',async()=>{
    const f=await contentDetailFixture(database.client),overview=await repository.overview(f.user,f.tenant,f.brand);
    expect(overview.archivedCarousels).toHaveLength(100);expect(overview.archivedCarousels.some(row=>row.id===f.carouselId)).toBe(false);
    const row=await service.currentContent(f.user,f.tenant,f.brand,f.carouselContentId);
    expect(row).toMatchObject({id:f.carouselContentId,title:f.carouselTitle,type:'CAROUSEL',revision:4,detail:{kind:'CAROUSEL',id:f.carouselId,version:2,approvedVersion:null,platform:'TELEGRAM',lifecycleRevision:1,archivedAt:new Date('2025-01-01T00:00:00Z'),content:f.carousel}});
    expect(JSON.stringify(row)).not.toContain('Historical carousel');
    await expect(database.client`update carousel_versions set content='{}' where carousel_id=${f.carouselId} and version=1`).rejects.toThrow();
    const [saved]=await database.client`select archived_at = '2025-01-01T00:00:00Z'::timestamptz as archived_matches,lifecycle_revision from carousels where id=${f.carouselId}`;expect(saved?.archived_matches).toBe(true);expect(saved?.lifecycle_revision).toBe(1);
  });
  it('distinguishes absent post/carousel text from metadata-only media without fallback',async()=>{
    const f=await contentDetailFixture(database.client);
    for(const id of [f.emptyPostContentId,f.emptyCarouselContentId])expect((await service.currentContent(f.user,f.tenant,f.brand,id)).detail).toEqual({kind:'NO_TEXT'});
    const row=await service.currentContent(f.user,f.tenant,f.brand,f.videoContentId);
    expect(row).toMatchObject({id:f.videoContentId,type:'SHORT_VIDEO',detail:{kind:'METADATA_ONLY'}});
    for(const key of ['url','signedUrl','finalKey','jobId','snapshot','credential'])expect(row).not.toHaveProperty(key);
  });
  it('does not expose a mismatched subtype body when the content item type differs',async()=>{
    const f=await contentDetailFixture(database.client);
    await database.client`update content_items set type='SHORT_VIDEO' where id=${f.postContentId}`;
    const video=await service.currentContent(f.user,f.tenant,f.brand,f.postContentId);
    expect(video).toMatchObject({type:'SHORT_VIDEO',detail:{kind:'METADATA_ONLY'}});expect(video.detail).toEqual({kind:'METADATA_ONLY'});
    expect(JSON.stringify(video)).not.toContain(f.post.body);
    await database.client`update content_items set type='POST' where id=${f.carouselContentId}`;
    const emptyPost=await service.currentContent(f.user,f.tenant,f.brand,f.carouselContentId);
    expect(emptyPost).toMatchObject({type:'POST',detail:{kind:'NO_TEXT'}});expect(emptyPost.detail).toEqual({kind:'NO_TEXT'});
    expect(JSON.stringify(emptyPost)).not.toContain(f.carousel.caption);expect(JSON.stringify(emptyPost)).not.toContain(f.carousel.slides[0]!.body);
  });
  it('rejects missing current versions rather than returning a historical or unrelated text',async()=>{
    const f=await contentDetailFixture(database.client);
    await database.client`update posts set current_version=3,approved_version=null,approved_by=null where id=${f.postId}`;
    await expect(service.currentContent(f.user,f.tenant,f.brand,f.postContentId)).rejects.toThrow('NOT_FOUND');
    await database.client`update carousels set current_version=3 where id=${f.carouselId}`;
    await expect(service.currentContent(f.user,f.tenant,f.brand,f.carouselContentId)).rejects.toThrow('NOT_FOUND');
  });
  it('rejects wrong tenant/brand/account, nonexistent content and post/carousel entity IDs',async()=>{
    const f=await contentDetailFixture(database.client);
    for(const args of [[f.user,f.tenant,f.otherBrand,f.postContentId],[f.user,f.foreign,f.foreign,f.postContentId],[f.outsider,f.tenant,f.brand,f.postContentId],[f.user,f.tenant,f.brand,f.otherBrand],[f.user,f.tenant,f.brand,f.postId],[f.user,f.tenant,f.brand,f.carouselId]])await expect(service.currentContent(...args as [string,string,string,string])).rejects.toThrow('NOT_FOUND');
    expect(()=>service.currentContent(f.user,f.tenant,f.brand,'invalid')).toThrow();
  });
  it('rechecks current membership and disabled accounts on every read',async()=>{
    const f=await contentDetailFixture(database.client);await service.currentContent(f.user,f.tenant,f.brand,f.postContentId);
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    await expect(service.currentContent(f.user,f.tenant,f.brand,f.postContentId)).rejects.toThrow('NOT_FOUND');
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${f.tenant},${f.user},'VIEWER')`;
    await database.client`update users set disabled_at=now() where id=${f.user}`;
    await expect(service.currentContent(f.user,f.tenant,f.brand,f.carouselContentId)).rejects.toThrow('NOT_FOUND');
  });
});
