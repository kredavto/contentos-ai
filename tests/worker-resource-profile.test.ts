import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createHeavyTaskGate,parseWorkerResourceProfile} from '../apps/worker/src/resource-profile';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};};
it('defaults to standard and rejects unsupported input without echoing it',()=>{
  expect(parseWorkerResourceProfile(undefined)).toBe('standard');
  expect(parseWorkerResourceProfile('standard')).toBe('standard');
  expect(parseWorkerResourceProfile('economy')).toBe('economy');
  for(const value of ['', 'ECONOMY','sentinel-secret'])expect(()=>parseWorkerResourceProfile(value)).toThrow('Invalid worker resource profile');
});
it('keeps standard concurrency unchanged',async()=>{
  const run=createHeavyTaskGate('standard'),hold=deferred();let entered=0;
  const jobs=Array.from({length:6},()=>run(async()=>{entered++;await hold.promise;}));
  expect(entered).toBe(6);hold.resolve();await Promise.all(jobs);
});
it('serializes six deliveries across queue families in FIFO order before any processor claim',async()=>{
  const run=createHeavyTaskGate('economy'),hold=deferred(),order:number[]=[];let active=0,peak=0;
  const jobs=Array.from({length:6},(_,index)=>run(async()=>{order.push(index);active++;peak=Math.max(peak,active);await hold.promise;active--;return index;}));
  expect(order).toEqual([0]);hold.resolve();expect(await Promise.all(jobs)).toEqual([0,1,2,3,4,5]);expect(order).toEqual([0,1,2,3,4,5]);expect(peak).toBe(1);
});
it('preserves exact failures and releases after async rejection or synchronous throw',async()=>{
  const run=createHeavyTaskGate('economy'),failure=new Error('fixture');
  await expect(run(async()=>{throw failure;})).rejects.toBe(failure);
  await expect(run(()=>{throw failure;})).rejects.toBe(failure);
  await expect(run(async()=>42)).resolves.toBe(42);
});
it('drains already accepted work after a failure without losing or replaying calls',async()=>{
  const run=createHeavyTaskGate('economy'),hold=deferred(),calls:number[]=[];
  const first=run(async()=>{calls.push(1);await hold.promise;throw new Error('fixture');});
  const rejected=expect(first).rejects.toThrow('fixture');
  const second=run(async()=>{calls.push(2);return 'ok';});
  hold.resolve();await rejected;await expect(second).resolves.toBe('ok');expect(calls).toEqual([1,2]);
});
it('never grants a replacement slot while an operation remains unsettled',async()=>{
  const run=createHeavyTaskGate('economy'),hold=deferred();let entered=false;
  const first=run(()=>hold.promise),second=run(async()=>{entered=true;});
  await new Promise(resolve=>setTimeout(resolve,20));expect(entered).toBe(false);
  hold.resolve();await Promise.all([first,second]);expect(entered).toBe(true);
});
it('reserves the slot for a queued waiter against newly arriving work',async()=>{
  const run=createHeavyTaskGate('economy'),hold=deferred(),order:number[]=[];
  const first=run(()=>hold.promise),second=run(async()=>{order.push(2);});hold.resolve();
  const third=first.then(()=>run(async()=>{order.push(3);}));await Promise.all([second,third]);expect(order).toEqual([2,3]);
});
it('wires all heavy queue families through one gate and leaves retry and lease contracts unchanged',()=>{
  const source=readFileSync('apps/worker/src/index.ts','utf8');
  expect(source.match(/createHeavyTaskGate\(resourceProfile\)/g)).toHaveLength(1);
  for(const name of ['libraryMediaProcessor','imageProcessor','coverProcessor'])expect(source).toContain(`delivery=>runHeavyTask(()=>${name}.run(delivery.data.tenantId,delivery.data.id))`);
  expect(source).toContain("('contentos-generation', delivery => runHeavyTask(async () => {");
  expect(source).toContain('}),{connection,concurrency:3});');
  expect(source.indexOf('const resourceProfile')).toBeLessThan(source.indexOf('createDatabase(env.'));
  expect(readFileSync('deploy/compose.economy.yml','utf8')).toContain('WORKER_RESOURCE_PROFILE: economy');
});
it('pauses every heavy queue before draining any worker',async()=>{
  const {drainHeavyWorkers}=await import('../apps/worker/src/resource-profile');
  const calls:string[]=[],hold=deferred();
  const workers=Array.from({length:4},(_,i)=>({pause:async(noWait:boolean)=>{expect(noWait).toBe(true);calls.push(`pause${i}`);await hold.promise;},close:async()=>{calls.push(`close${i}`);}}));
  const draining=drainHeavyWorkers(workers);expect(calls).toEqual(['pause0','pause1','pause2','pause3']);hold.resolve();await draining;
  expect(calls).toEqual(['pause0','pause1','pause2','pause3','close0','close1','close2','close3']);
});
