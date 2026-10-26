export const readinessDependencies=['database','redis','storage'] as const;
export type ReadinessDependency=typeof readinessDependencies[number];
export type DependencyReadiness='ok'|'unavailable'|'configuration_required';
export type ReadinessResult=Readonly<{status:'ready'|'not_ready';checks:Readonly<Record<ReadinessDependency,DependencyReadiness>>}>;
export type ReadinessProbe=(signal:AbortSignal)=>Promise<void>;
/** Bounded, coalesced infrastructure checks; provider credentials and raw errors never enter public output. */
export class ReadinessService{
 private cached:{expiresAt:number;result:ReadinessResult}|null=null;
 private pending:Promise<ReadinessResult>|null=null;
 constructor(private readonly probes:Partial<Record<ReadinessDependency,ReadinessProbe>>,private readonly timeoutMs=1500,private readonly cacheMs=5000){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isInteger(cacheMs)||cacheMs<0||cacheMs>60000)throw new RangeError('Invalid readiness bounds');
 }
 check():Promise<ReadinessResult>{
  if(this.cached&&this.cached.expiresAt>performance.now())return Promise.resolve(this.cached.result);
  if(this.pending)return this.pending;
  this.pending=this.measure().then(result=>{this.cached={result,expiresAt:performance.now()+this.cacheMs};return result;}).finally(()=>{this.pending=null;});
  return this.pending;
 }
 private async measure():Promise<ReadinessResult>{
  const statuses=await Promise.all(readinessDependencies.map(name=>this.probe(this.probes[name])));
  const checks=Object.freeze(Object.fromEntries(readinessDependencies.map((name,index)=>[name,statuses[index]!])) as Record<ReadinessDependency,DependencyReadiness>);
  return Object.freeze({status:statuses.every(status=>status==='ok')?'ready':'not_ready',checks});
 }
 private probe(probe:ReadinessProbe|undefined):Promise<DependencyReadiness>{
  if(!probe)return Promise.resolve('configuration_required');
  const controller=new AbortController();
  return new Promise(resolve=>{
   const timer=setTimeout(()=>{controller.abort();resolve('unavailable');},this.timeoutMs);
   Promise.resolve().then(()=>probe(controller.signal)).then(()=>resolve('ok'),()=>resolve('unavailable')).finally(()=>clearTimeout(timer));
  });
 }
}
