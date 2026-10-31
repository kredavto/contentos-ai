import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {SearchRepository} from '../../packages/db/src/index';
import {SearchService} from '../../packages/core/src/search';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('organization search',()=>{
  const database=isolatedTestDatabase(url),service=new SearchService(new SearchRepository(database.db));
  const user=randomUUID(),outsider=randomUUID(),tenant=randomUUID(),foreign=randomUUID(),brand=randomUUID(),content=randomUUID(),script=randomUUID();
  beforeAll(async()=>{
    for(const id of [user,outsider])await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Fixture','unusable',now())`;
    for(const id of [tenant,foreign]){await database.client`insert into organizations(id,name) values(${id},'Fixture')`;await database.client`insert into workspaces(id,tenant_id,name) values(${id},${id},'Fixture')`;}
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'VIEWER'),(${foreign},${outsider},'OWNER')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${tenant},'Search 100%_literal'),(${foreign},${foreign},${foreign},'Search private')`;
    await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${content},${tenant},${brand},'Search content','POST')`;
    await database.client`insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,platform,duration) values(${script},${tenant},${brand},${content},2,'TELEGRAM',30)`;
    for(const [version,core] of [[1,'HistoricalSecret'],[2,'CurrentNeedle']])await database.client`insert into script_versions(tenant_id,script_id,version,content,created_by) values(${tenant},${script},${version!},${JSON.stringify({hook:'Search hook',context:'Context',core,proof:'Proof',cta:'CTA',factCheckNotes:['InternalNoteNeedle']})}::jsonb,${user})`;
    const reservation=randomUUID(),job=randomUUID();
    await database.client`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${tenant},'fixture','AI_CREDITS',1)`;
    await database.client`insert into jobs(id,tenant_id,brand_id,requested_by,type,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) values(${job},${tenant},${brand},${user},'GENERATE_IDEAS','{}','fixture',${randomUUID()},${reservation},'mock','mock',${randomUUID()})`;
    await database.client`insert into ideas(tenant_id,brand_id,job_id,ordinal,title,angle,hook,audience_label,pillar_label,funnel_stage,platform,format,score,scores,rationale,source) values(${tenant},${brand},${job},1,'Search idea','AngleNeedle','Hook','Audience','Pillar','AWARENESS','TELEGRAM','POST',1,'{}','Fixture','mock')`;
    const post=randomUUID();await database.client`insert into posts(id,tenant_id,brand_id,content_item_id,platform) values(${post},${tenant},${brand},${content},'TELEGRAM')`;
    await database.client`insert into content_versions(tenant_id,post_id,version,content,created_by) values(${tenant},${post},1,'{"title":"Search content","body":"PostBodyNeedle","hashtags":[],"factCheckNotes":[]}',${user})`;
  });
  it('searches current bodies, ideas and brands without historical or operational data',async()=>{
    const page=await service.search(user,tenant,{q:'Search'});expect(new Set(page.items.map(row=>row.kind))).toEqual(new Set(['BRAND','CONTENT','IDEA','SCRIPT']));
    for(const [q,kind] of [['CurrentNeedle','SCRIPT'],['AngleNeedle','IDEA'],['PostBodyNeedle','CONTENT']])expect((await service.search(user,tenant,{q})).items.map(row=>row.kind)).toEqual([kind]);
    for(const q of ['HistoricalSecret','InternalNoteNeedle','private'])expect((await service.search(user,tenant,{q})).items).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/password|credential|inputHash|reservation/);
  });
  it('treats SQL wildcard characters and injection text literally',async()=>{
    expect((await service.search(user,tenant,{q:'100%_'})).items.map(row=>row.id)).toEqual([brand]);
    expect((await service.search(user,tenant,{q:"%' OR 1=1 --"})).items).toEqual([]);
  });
  it('paginates beyond capped overview lists without duplicates',async()=>{
    await database.client`insert into brands(tenant_id,workspace_id,name) select ${tenant},${tenant},'Paging needle '||n from generate_series(1,105) n`;
    let next:{afterKind:'BRAND';afterId:string}|undefined;const ids:string[]=[];
    do{const page=await service.search(user,tenant,{q:'Paging needle',kind:'BRAND',...next});ids.push(...page.items.map(row=>row.id));next=page.next as typeof next??undefined;}while(next);
    expect(ids).toHaveLength(105);expect(new Set(ids).size).toBe(105);
  });
  it('rechecks tenant membership and disabled accounts on every page',async()=>{
    await expect(service.search(outsider,tenant,{q:'Search'})).rejects.toThrow('NOT_FOUND');
    await expect(service.search(user,foreign,{q:'Search'})).rejects.toThrow('NOT_FOUND');
    await database.client`update users set disabled_at=now() where id=${user}`;
    await expect(service.search(user,tenant,{q:'Search'})).rejects.toThrow('NOT_FOUND');
  });
});
