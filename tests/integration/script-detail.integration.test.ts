import {describe,expect,it} from 'vitest';
import {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../../packages/db/src/index';
import {GenerationService} from '../../packages/core/src/generation';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {scriptDetailFixture} from '../helpers/script-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('exact current script detail',()=>{
  const database=isolatedTestDatabase(url),repository=new ContentRepository(database.db);
  const service=new GenerationService(new JobRepository(database.db),new BrandRepository(database.db),new LedgerRepository(database.db),repository,{provider:'unconfigured',model:'',ready:false});
  it('reads the exact current version beyond the overview cap without changing approval or jobs',async()=>{
    const f=await scriptDetailFixture(database.client);
    expect((await repository.overview(f.user,f.tenant,f.brand)).scripts).toHaveLength(100);
    expect((await repository.overview(f.user,f.tenant,f.brand)).scripts.some(row=>row.id===f.script)).toBe(false);
    const row=await service.currentScript(f.user,f.tenant,f.brand,f.script);
    expect(row).toMatchObject({id:f.script,brandId:f.brand,title:f.title,currentVersion:2,approvedVersion:1,platform:'TELEGRAM',duration:30,content:f.current,role:'VIEWER'});
    await database.client`update scripts set approved_version=2 where id=${f.script}`;
    expect((await service.currentScript(f.user,f.tenant,f.brand,f.script)).approvedVersion).toBe(2);
    expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(0);
    expect(await database.client`select id from audit_logs where tenant_id=${f.tenant}`).toHaveLength(0);
  });
  it('never substitutes another script or crosses tenant/brand/account scope',async()=>{
    const f=await scriptDetailFixture(database.client);
    for(const args of [[f.user,f.tenant,f.otherBrand,f.script],[f.user,f.foreign,f.foreign,f.script],[f.outsider,f.tenant,f.brand,f.script],[f.user,f.tenant,f.brand,f.otherBrand]])await expect(service.currentScript(...args as [string,string,string,string])).rejects.toThrow('NOT_FOUND');
    expect(()=>service.currentScript(f.user,f.tenant,f.brand,'invalid')).toThrow();
    await database.client`update scripts set current_version=3 where id=${f.script}`;
    await expect(service.currentScript(f.user,f.tenant,f.brand,f.script)).rejects.toThrow('NOT_FOUND');
  });
  it('rechecks revoked membership and disabled accounts on every read',async()=>{
    const f=await scriptDetailFixture(database.client);
    await service.currentScript(f.user,f.tenant,f.brand,f.script);
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    await expect(service.currentScript(f.user,f.tenant,f.brand,f.script)).rejects.toThrow('NOT_FOUND');
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${f.tenant},${f.user},'VIEWER')`;
    await database.client`update users set disabled_at=now() where id=${f.user}`;
    await expect(service.currentScript(f.user,f.tenant,f.brand,f.script)).rejects.toThrow('NOT_FOUND');
  });
});
