import {fork,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {describe,it,expect} from 'vitest';
const configured=Boolean(process.env.TEST_DATABASE_URL&&process.env.TEST_REDIS_URL);
if(process.env.REQUIRE_ECONOMY_INTEGRATION==='1'&&!configured)throw new Error('Economy integration fixture services required');
describe.skipIf(!configured)('economy real Redis/PostgreSQL queue lifecycle',()=>{
  it.each([false,true])('renews locks and drains on actual SIGTERM without duplicate claims (terminal failure=%s)',async(failFirst)=>{
    const child=fork('apps/worker/test/economy-fixture.ts',failFirst?['--fail-first']:[],{execArgv:['--import','tsx'],env:{PATH:process.env.PATH,NODE_ENV:'test',TEST_DATABASE_URL:process.env.TEST_DATABASE_URL,TEST_REDIS_URL:process.env.TEST_REDIS_URL},stdio:['ignore','ignore','ignore','ipc']});
    const messages:Record<string,unknown>[]=[];
    child.on('message',message=>{messages.push(message as Record<string,unknown>);});
    const exited=once(child,'exit');
    void exited.catch(()=>{});
    child.once('error',()=>messages.push({event:'fixture_error'}));
    async function event(name:string){
      const until=Date.now()+15_000;
      while(Date.now()<until){
        if(messages.some(value=>value.event==='fixture_error'||value.event==='worker_error'))throw new Error('Economy fixture failed');
        const found=messages.find(value=>value.event===name);if(found)return found;
        if(child.exitCode!==null||child.signalCode!==null)throw new Error('Economy fixture exited before acceptance');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      throw new Error(`Economy fixture stage timed out: ${name}`);
    }
    try{
      await event('accepted');
      // More than three 1-second lock periods: waiting callbacks must keep renewing.
      await new Promise(resolve=>setTimeout(resolve,3200));child.send('inspect');
      const inspection=await event('inspection');
      expect(inspection.states).toEqual(Array(6).fill('active'));
      expect((inspection.ttls as number[]).every(ttl=>ttl>0&&ttl<=1000)).toBe(true);
      expect(inspection.attempts).toEqual(Array(6).fill(1));expect(inspection.claims).toBe(1);expect(inspection.peak).toBe(1);expect(inspection.stalled).toBe(0);
      const before=inspection.rows as Array<{status:string;attempt:number}>;
      expect(before.filter(row=>row.status==='RUNNING')).toHaveLength(1);
      expect(before.filter(row=>row.attempt===0)).toHaveLength(5);
      expect(child.kill('SIGTERM')).toBe(true);await event('stopping');
      child.send('release');const drained=await event('drained');
      expect((drained.states as string[]).filter(state=>state==='completed')).toHaveLength(failFirst?5:6);
      expect((drained.states as string[]).filter(state=>state==='failed')).toHaveLength(failFirst?1:0);
      expect(drained.claims).toBe(6);expect(drained.peak).toBe(1);expect(drained.stalled).toBe(0);
      const rows=drained.rows as Array<{attempt:number;status:string}>;
      expect(rows.every(row=>row.attempt===1)).toBe(true);
      expect(rows.filter(row=>row.status==='SUCCEEDED')).toHaveLength(failFirst?5:6);
      expect(rows.filter(row=>row.status==='FAILED')).toHaveLength(failFirst?1:0);
      await event('cleaned');expect(await exited).toEqual([0,null]);
    }finally{
      await stopOwnedChild(child,exited);
    }
  },45_000);
});
async function stopOwnedChild(child:ChildProcess,exited:Promise<unknown>){
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
}
