import {describe,expect,it} from 'vitest';
import {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../../packages/db/src/index';
import {GenerationService} from '../../packages/core/src/generation';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {ideaDetailFixture} from '../helpers/idea-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('exact saved idea detail',()=>{
  const database=isolatedTestDatabase(url),repository=new ContentRepository(database.db);
  const service=new GenerationService(new JobRepository(database.db),new BrandRepository(database.db),new LedgerRepository(database.db),repository,{provider:'unconfigured',model:'',ready:false});
  it('reads the exact saved idea beyond the overview cap without changing jobs or audit',async()=>{
    const f=await ideaDetailFixture(database.client);
    expect((await repository.overview(f.user,f.tenant,f.brand)).ideas).toHaveLength(100);
    expect((await repository.overview(f.user,f.tenant,f.brand)).ideas.some(row=>row.id===f.idea)).toBe(false);
    const row=await service.currentIdea(f.user,f.tenant,f.brand,f.idea);
    expect(row).toMatchObject({id:f.idea,brandId:f.brand,title:f.title,hook:f.hook,angle:f.angle,status:'DRAFT',score:75,scores:{relevance:75},role:'VIEWER'});
    expect(row).not.toHaveProperty('jobId');expect(row).not.toHaveProperty('source');
    await database.client`update ideas set status='SELECTED' where id=${f.idea}`;
    expect((await service.currentIdea(f.user,f.tenant,f.brand,f.idea)).status).toBe('SELECTED');
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(1);
    expect(await database.client`select id from audit_logs where tenant_id=${f.tenant}`).toHaveLength(0);
  });
  it('never substitutes another idea or crosses tenant/brand/account scope',async()=>{
    const f=await ideaDetailFixture(database.client);
    for(const args of [[f.user,f.tenant,f.otherBrand,f.idea],[f.user,f.foreign,f.foreign,f.idea],[f.outsider,f.tenant,f.brand,f.idea],[f.user,f.tenant,f.brand,f.otherBrand]])await expect(service.currentIdea(...args as [string,string,string,string])).rejects.toThrow('NOT_FOUND');
    expect(()=>service.currentIdea(f.user,f.tenant,f.brand,'invalid')).toThrow();
    await database.client`delete from ideas where id=${f.idea}`;
    await expect(service.currentIdea(f.user,f.tenant,f.brand,f.idea)).rejects.toThrow('NOT_FOUND');
  });
  it('rechecks revoked membership and disabled accounts on every read',async()=>{
    const f=await ideaDetailFixture(database.client);
    await service.currentIdea(f.user,f.tenant,f.brand,f.idea);
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    await expect(service.currentIdea(f.user,f.tenant,f.brand,f.idea)).rejects.toThrow('NOT_FOUND');
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${f.tenant},${f.user},'VIEWER')`;
    await database.client`update users set disabled_at=now() where id=${f.user}`;
    await expect(service.currentIdea(f.user,f.tenant,f.brand,f.idea)).rejects.toThrow('NOT_FOUND');
  });
});
