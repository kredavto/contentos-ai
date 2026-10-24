import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {ApprovalRepository,ContentRepository} from '../../packages/db/src/index';
import {ApprovalService} from '../../packages/core/src/approvals';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('assigned post and carousel approvals',()=>{
  const database=isolatedTestDatabase(url),service=new ApprovalService(new ApprovalRepository(database.db)),content=new ContentRepository(database.db);
  const tenant=randomUUID(),brand=randomUUID(),editor=randomUUID(),reviewer=randomUUID(),outsider=randomUUID(),correlation=randomUUID();
  const postContent={title:'Post fixture',body:'Original body',hashtags:['test'],factCheckNotes:[]};
  const carouselContent={title:'Carousel fixture',slides:[{heading:'First',body:'Original slide'},{heading:'Second',body:'Next slide'}],caption:'Original caption',hashtags:['test'],factCheckNotes:[],design:{format:'SQUARE' as const,font:'SANS' as const,backgroundColor:'#ffffff',textColor:'#111111',accentColor:'#00ff00'}};
  beforeAll(async()=>{
    for(const id of [editor,reviewer,outsider])await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Fixture','unusable',now())`;
    await database.client`insert into organizations(id,name) values(${tenant},'Fixture')`;await database.client`insert into workspaces(id,tenant_id,name) values(${tenant},${tenant},'Fixture')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${tenant},'Fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${editor},'EDITOR'),(${tenant},${reviewer},'CLIENT_APPROVER')`;
  });
  async function post(){const postId=randomUUID(),item=randomUUID();await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${item},${tenant},${brand},'Post fixture','POST')`;await database.client`insert into posts(id,tenant_id,brand_id,content_item_id,platform) values(${postId},${tenant},${brand},${item},'TELEGRAM')`;await database.client`insert into content_versions(tenant_id,post_id,version,content,created_by) values(${tenant},${postId},1,${JSON.stringify(postContent)}::jsonb,${editor})`;return {postId,version:1,requestedFrom:reviewer,idempotencyKey:randomUUID()};}
  async function carousel(){const carouselId=randomUUID(),item=randomUUID();await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${item},${tenant},${brand},'Carousel fixture','CAROUSEL')`;await database.client`insert into carousels(id,tenant_id,brand_id,content_item_id,platform) values(${carouselId},${tenant},${brand},${item},'INSTAGRAM')`;await database.client`insert into carousel_versions(tenant_id,carousel_id,version,content,created_by) values(${tenant},${carouselId},1,${JSON.stringify(carouselContent)}::jsonb,${editor})`;return {carouselId,version:1,lifecycleRevision:0,requestedFrom:reviewer,idempotencyKey:randomUUID()};}
  it('approves posts and carousels exactly once with typed immutable review content',async()=>{
    for(const input of [await post(),await carousel()]){
      const [request,retry]=await Promise.all([service.create(editor,tenant,brand,input,correlation),service.create(editor,tenant,brand,input,correlation)]);expect(request).toEqual(retry);
      const row=(await service.list(reviewer,tenant,{})).items.find(item=>item.id===request!.id)!;
      expect(row.entityType).toBe('postId' in input?'POST':'CAROUSEL');expect(row.content).toEqual('postId' in input?postContent:carouselContent);
      await Promise.all([service.decide(reviewer,tenant,request!.id,{status:'APPROVED'},correlation),service.decide(reviewer,tenant,request!.id,{status:'APPROVED'},correlation)]);
      const target='postId' in input?await database.client`select approved_version,approved_by from posts where id=${input.postId}`:await database.client`select approved_version,approved_by from carousels where id=${input.carouselId}`;expect(target[0]).toEqual({approved_version:1,approved_by:reviewer});
      await expect(database.client`update approval_requests set version=2 where id=${request!.id}`).rejects.toThrow('immutable');
    }
  });
  it('fences edits while keeping the submitted version readable',async()=>{
    const input=await post(),request=await service.create(editor,tenant,brand,input,correlation);
    await content.editPost(editor,tenant,brand,input.postId,{revision:1,content:{...postContent,body:'New body'}},correlation);
    await expect(service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');
    const row=(await service.list(reviewer,tenant,{})).items.find(item=>item.id===request.id)!;expect(row.entityType==='POST'&&row.content.body).toBe('Original body');expect(row.currentVersion).toBe(2);
  });
  it('rejects cross-tenant actors, foreign brands and unassigned decisions',async()=>{
    const input=await carousel();await expect(service.create(outsider,tenant,brand,input,correlation)).rejects.toThrow('NOT_FOUND');await expect(service.create(editor,tenant,randomUUID(),input,correlation)).rejects.toThrow('NOT_FOUND');
    const request=await service.create(editor,tenant,brand,input,correlation);await expect(service.decide(editor,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.decide(reviewer,randomUUID(),request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.create(editor,tenant,brand,{...input,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('CONFLICT');
  });
  it('fences carousel archive/restore cycles even when content version is unchanged',async()=>{
    const input=await carousel(),request=await service.create(editor,tenant,brand,input,correlation);
    await content.setCarouselArchived(editor,tenant,brand,input.carouselId,{revision:1,lifecycleRevision:0,archived:true},correlation);
    await expect(service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');
    await content.setCarouselArchived(editor,tenant,brand,input.carouselId,{revision:1,lifecycleRevision:1,archived:false},correlation);
    await expect(service.decide(reviewer,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');
    await service.decide(editor,tenant,request.id,{status:'CANCELLED'},correlation);
    await expect(service.create(editor,tenant,brand,{...input,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('CONFLICT');
    const current=await service.create(editor,tenant,brand,{...input,lifecycleRevision:2,idempotencyKey:randomUUID()},correlation);
    await service.decide(reviewer,tenant,current.id,{status:'APPROVED'},correlation);
    expect((await database.client`select approved_version from carousels where id=${input.carouselId}`)[0]!.approved_version).toBe(1);
  });

});
