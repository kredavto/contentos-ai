import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {PrivacyRepository,NotificationPreferencesRepository,NotificationEmailRepository} from '../../packages/db/src/index';
import {NotificationPreferencesService} from '../../packages/core/src/notification-preferences';
import {NotificationEmailProcessor} from '../../packages/core/src/notification-email';
import {ProviderRequestError,type EmailProvider} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('opt-in notification email',()=>{
  const database=isolatedTestDatabase(url),preferences=new NotificationPreferencesService(new NotificationPreferencesRepository(database.db)),queue=new NotificationEmailRepository(database.db);
  const sent:Array<{recipient:string;text:string;key:string}>=[];
  const provider:EmailProvider={send:async(input,context)=>{sent.push({...input,key:context.idempotencyKey});return {provider:'fixture',internalId:context.internalId,externalId:context.idempotencyKey,metadata:{}};}};
  const processor=new NotificationEmailProcessor(queue,provider,'https://app.example.test','Fixture');
  async function fixture(){
    const tenant=randomUUID(),user=randomUUID(),other=randomUUID();await database.client`insert into organizations(id,name) values(${tenant},'Email fixture')`;
    for(const id of [user,other]){await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id},${`${id}@example.test`},'unusable','Fixture',now())`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id},'OWNER')`;}
    const notice=async()=>{const id=randomUUID();await database.client`insert into notifications(id,tenant_id,user_id,source_key,type,audience,resource_id) values(${id},${tenant},${user},${id},'LIMIT_WARNING','OWNERS',${id})`;return id;};
    const enable=()=>preferences.update(user,tenant,{emailEnabled:true,revision:null},randomUUID());
    const delivery=async(id:string)=>{await queue.projectBatch();const [row]=await database.client`select id from notification_email_deliveries where notification_id=${id}`;return row!.id as string;};
    return {tenant,user,other,notice,enable,delivery};
  }
  it('defaults off, never backfills old notifications and deduplicates concurrent projection and sends',async()=>{
    const f=await fixture();expect(await preferences.get(f.user,f.tenant)).toMatchObject({emailEnabled:false,revision:null,deliveryStatus:'CONFIGURATION_REQUIRED'});
    const old=await f.notice();await queue.projectBatch();expect(await database.client`select id from notification_email_deliveries where notification_id=${old}`).toHaveLength(0);
    await f.enable();const notice=await f.notice();await Promise.all([queue.projectBatch(),queue.projectBatch()]);const id=await f.delivery(notice);
    const before=sent.length;await Promise.all([processor.runOnce(id),processor.runOnce(id)]);expect(sent.length-before).toBe(1);expect(sent.at(-1)).toMatchObject({recipient:`${f.user}@example.test`,key:id});expect(sent.at(-1)!.text).toContain(`/notifications?organization=${f.tenant}`);
    expect(await database.client`select id from notification_email_deliveries where notification_id=${old}`).toHaveLength(0);
    expect((await database.client`select status from notification_email_deliveries where id=${id}`)[0]?.status).toBe('SENT');
    const archive=await new PrivacyRepository(database.db).exportAccount(f.user,'unusable',randomUUID());expect(archive.notificationSettings).toHaveLength(1);expect(archive.notificationEmailHistory).toHaveLength(1);expect(JSON.stringify(archive.notificationEmailHistory)).not.toContain(f.other);
    await expect(database.client`update notification_email_deliveries set status='PENDING' where id=${id}`).rejects.toThrow('immutable');
  });
  it('scopes preferences to the recipient, rejects stale updates and requires verified membership',async()=>{
    const f=await fixture(),g=await fixture();const results=await Promise.allSettled([f.enable(),f.enable()]);expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const state=await preferences.get(f.user,f.tenant);expect((await preferences.get(f.other,f.tenant)).emailEnabled).toBe(false);
    await expect(preferences.get(f.user,g.tenant)).rejects.toThrow('NOT_FOUND');
    await expect(preferences.update(f.user,f.tenant,{emailEnabled:false,revision:null},randomUUID())).rejects.toThrow('CONFLICT');
    await database.client`update users set email_verified_at=null where id=${f.other}`;await expect(preferences.update(f.other,f.tenant,{emailEnabled:true,revision:null},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
    expect((await preferences.update(f.user,f.tenant,{emailEnabled:false,revision:state.revision},randomUUID())).emailEnabled).toBe(false);
    await database.client`update users set disabled_at=now() where id=${f.user}`;await expect(preferences.get(f.user,f.tenant)).rejects.toThrow('NOT_FOUND');
  });
  it('cancels queued deliveries after opt-out and does not resurrect them after re-enabling',async()=>{
    const f=await fixture(),enabled=await f.enable(),notice=await f.notice(),id=await f.delivery(notice),claimed=await queue.claim(id);
    const disabled=await preferences.update(f.user,f.tenant,{emailEnabled:false,revision:enabled.revision},randomUUID());expect(await queue.begin(id,claimed!.leaseToken!)).toBeNull();
    await preferences.update(f.user,f.tenant,{emailEnabled:true,revision:disabled.revision},randomUUID());
    await database.client`update notification_email_deliveries set lease_until=now()-interval '1 second' where id=${id}`;
    expect(await processor.runOnce(id)).toBe(false);expect((await database.client`select status from notification_email_deliveries where id=${id}`)[0]?.status).toBe('CANCELED');
  });
  it.each(['role','disabled','unverified','removed'])('rechecks %s immediately before delivery',async(change)=>{
    const f=await fixture();await f.enable();const id=await f.delivery(await f.notice()),claimed=await queue.claim(id);
    if(change==='role')await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenant} and user_id=${f.user}`;
    if(change==='disabled')await database.client`update users set disabled_at=now() where id=${f.user}`;
    if(change==='unverified')await database.client`update users set email_verified_at=null where id=${f.user}`;
    if(change==='removed')await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    expect(await queue.begin(id,claimed!.leaseToken!)).toBeNull();
  });
  it('cleans revoked backlog in bounded concurrent batches without touching valid deliveries',async()=>{
    while(await queue.cleanup()){/* Clear invalid fixtures from preceding tests. */}
    const f=await fixture(),active=await fixture(),state=await f.enable();await active.enable();
    await database.client`insert into notifications(tenant_id,user_id,source_key,type,audience,resource_id) select ${f.tenant},${f.user},'cleanup:'||${f.tenant}||':'||n,'LIMIT_WARNING','OWNERS',${randomUUID()} from generate_series(1,205) n`;
    for(let batch=0;batch<4;batch++)await queue.projectBatch();
    const valid=await active.delivery(await active.notice());
    await preferences.update(f.user,f.tenant,{emailEnabled:false,revision:state.revision},randomUUID());
    const batches=await Promise.all([queue.cleanup(),queue.cleanup()]);expect(batches.sort()).toEqual([100,100]);expect(await queue.cleanup()).toBe(5);expect(await queue.cleanup()).toBe(0);
    expect((await database.client`select count(*)::int as n from notification_email_deliveries where tenant_id=${f.tenant} and status='CANCELED'`)[0]?.n).toBe(205);
    expect(await processor.runOnce(valid)).toBe(true);
  });
  it('cancels unsubmitted leases immediately but preserves submitted uncertainty after opt-out',async()=>{
    const f=await fixture(),state=await f.enable(),unsent=await f.delivery(await f.notice()),submitted=await f.delivery(await f.notice());
    const before=await queue.claim(unsent),during=await queue.claim(submitted);await queue.begin(submitted,during!.leaseToken!);
    await preferences.update(f.user,f.tenant,{emailEnabled:false,revision:state.revision},randomUUID());
    expect(await queue.cleanup()).toBe(1);expect(await queue.begin(unsent,before!.leaseToken!)).toBeNull();
    expect((await database.client`select status from notification_email_deliveries where id=${submitted}`)[0]?.status).toBe('SENDING');
    await database.client`update notification_email_deliveries set lease_until=now()-interval '1 second' where id=${submitted}`;
    expect(await queue.cleanup()).toBe(0);expect(await queue.claim(submitted)).toBeNull();
    expect((await database.client`select status from notification_email_deliveries where id=${submitted}`)[0]?.status).toBe('RECONCILIATION');
  });
  it('recovers an unsubmitted expired claim, fences its former owner and enforces recipient foreign keys',async()=>{
    const f=await fixture();await f.enable();const notification=await f.notice(),id=await f.delivery(notification),old=await queue.claim(id);
    await database.client`update notification_email_deliveries set lease_until=now()-interval '1 second' where id=${id}`;
    expect(await queue.claim(randomUUID())).toBeNull();
    const current=await queue.claim(id);expect(current!.attempt).toBe(2);expect(await queue.begin(id,old!.leaseToken!)).toBeNull();
    expect(await queue.begin(id,current!.leaseToken!)).not.toBeNull();expect(await queue.complete(id,current!.leaseToken!)).toBe(true);
    const g=await fixture(),foreign=await g.notice();
    await expect(database.client`insert into notification_email_deliveries(tenant_id,user_id,notification_id,preference_revision) values(${f.tenant},${f.user},${foreign},${randomUUID()})`).rejects.toThrow();
  });
  it('bounds definitive failures and leaves unconfigured delivery pending',async()=>{
    const f=await fixture();await f.enable();const id=await f.delivery(await f.notice());
    expect(await new NotificationEmailProcessor(queue,null,'https://app.example.test','Fixture').runOnce(id)).toBe(false);
    await database.client`update notification_email_deliveries set attempt=7 where id=${id}`;
    const rejected=new NotificationEmailProcessor(queue,{send:async()=>{throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,true);}},'https://app.example.test','Fixture');
    await rejected.runOnce(id);expect((await database.client`select status,attempt from notification_email_deliveries where id=${id}`)[0]).toEqual({status:'FAILED',attempt:8});expect(await processor.runOnce(id)).toBe(false);
  });
  it('retries only explicit rejection and never replays uncertain or expired submitted attempts',async()=>{
    const f=await fixture();await f.enable();const id=await f.delivery(await f.notice());
    const rejected=new NotificationEmailProcessor(queue,{send:async()=>{throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,true);}},'https://app.example.test','Fixture');
    await rejected.runOnce(id);expect((await database.client`select status from notification_email_deliveries where id=${id}`)[0]?.status).toBe('PENDING');
    await database.client`update notification_email_deliveries set next_attempt_at=now() where id=${id}`;
    const uncertain=new NotificationEmailProcessor(queue,{send:async()=>{throw new Error('unknown');}},'https://app.example.test','Fixture');await uncertain.runOnce(id);
    expect((await database.client`select status from notification_email_deliveries where id=${id}`)[0]?.status).toBe('RECONCILIATION');expect(await processor.runOnce(id)).toBe(false);
    const expired=await f.delivery(await f.notice()),claim=await queue.claim(expired);await queue.begin(expired,claim!.leaseToken!);
    await database.client`update notification_email_deliveries set lease_until=now()-interval '1 second' where id=${expired}`;expect(await queue.complete(expired,claim!.leaseToken!)).toBe(false);expect(await queue.claim(expired)).toBeNull();
    expect((await database.client`select status from notification_email_deliveries where id=${expired}`)[0]?.status).toBe('RECONCILIATION');
    expect(await database.client`select id from audit_logs where resource_id=${expired} and action='NOTIFICATION_EMAIL_RECONCILIATION_REQUIRED'`).toHaveLength(1);
  });
});
