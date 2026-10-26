import {afterEach,expect,it,vi} from 'vitest';
import {ReadinessService,type ReadinessProbe} from '../packages/core/src/readiness';
afterEach(()=>{vi.useRealTimers();});
it('never claims readiness for absent configuration and omits all private error material',async()=>{
 expect(await new ReadinessService({}).check()).toEqual({status:'not_ready',checks:{database:'configuration_required',redis:'configuration_required',storage:'configuration_required'}});
 const probe=vi.fn().mockRejectedValue(new Error('password-sentinel at postgres://private/internal'));
 const result=await new ReadinessService({database:probe,redis:async()=>{},storage:async()=>{}}).check();expect(result).toEqual({status:'not_ready',checks:{database:'unavailable',redis:'ok',storage:'ok'}});expect(JSON.stringify(result)).not.toMatch(/password-sentinel|postgres|private/);
});
it('starts probes in parallel and coalesces concurrent checks without a connection stampede',async()=>{
 let finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=resolve;}),probe=vi.fn(async()=>wait),service=new ReadinessService({database:probe,redis:probe,storage:probe});
 const first=service.check(),second=service.check();expect(first).toBe(second);await Promise.resolve();expect(probe).toHaveBeenCalledTimes(3);finish();
 expect((await first).status).toBe('ready');expect(await second).toBe(await service.check());expect(probe).toHaveBeenCalledTimes(3);
});
it('bounds even a non-cooperative probe and requests cancellation while preserving healthy checks',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;const stuck:ReadinessProbe=async value=>{signal=value;await new Promise<void>(()=>{});};
 const result=new ReadinessService({database:stuck,redis:async()=>{},storage:async()=>{}},20,100).check();await vi.advanceTimersByTimeAsync(20);
 expect(await result).toEqual({status:'not_ready',checks:{database:'unavailable',redis:'ok',storage:'ok'}});expect(signal?.aborted).toBe(true);
});
it('refreshes cached healthy and failed states only after expiry',async()=>{
 vi.useFakeTimers();const probe=vi.fn().mockRejectedValue(new Error('temporary')),service=new ReadinessService({database:probe,redis:async()=>{},storage:async()=>{}},20,100);
 expect((await service.check()).status).toBe('not_ready');probe.mockResolvedValue(undefined);expect((await service.check()).status).toBe('not_ready');expect(probe).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(101);expect((await service.check()).status).toBe('ready');expect(probe).toHaveBeenCalledTimes(2);expect(Object.isFrozen(await service.check())).toBe(true);expect(Object.isFrozen((await service.check()).checks)).toBe(true);
});
it('rejects invalid internal deadline/cache bounds',()=>{
 for(const [timeout,cache]of [[0,100],[10001,100],[20,-1],[20,60001],[1.5,100]])expect(()=>new ReadinessService({},timeout,cache)).toThrow('Invalid readiness bounds');
});

it('does not extend a healthy cache when the wall clock moves backwards',async()=>{
 vi.useFakeTimers();const probe=vi.fn().mockResolvedValue(undefined),service=new ReadinessService({database:probe,redis:async()=>{},storage:async()=>{}},20,100);
 await service.check();vi.setSystemTime(new Date(Date.now()-3600000));probe.mockRejectedValue(new Error('offline'));await vi.advanceTimersByTimeAsync(101);expect((await service.check()).status).toBe('not_ready');expect(probe).toHaveBeenCalledTimes(2);
});
