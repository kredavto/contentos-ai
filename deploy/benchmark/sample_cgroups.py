#!/usr/bin/env python3
"""Read-only cgroup-v2 sampler for explicitly owned disposable containers."""
import argparse,json,os,re,subprocess,sys,time
from pathlib import Path
class MeasurementError(Exception):pass

def owned_pid(name,owner):
    template='{"name":{{json .Name}},"pid":{{.State.Pid}},"running":{{.State.Running}},"owner":{{json (index .Config.Labels "contentos.benchmark.owner")}}}'
    try:
        result=subprocess.run(['docker','--host','unix:///var/run/docker.sock','inspect','--format',template,name],env={'PATH':os.environ.get('PATH','/usr/bin:/bin')},capture_output=True,text=True,timeout=10,check=True)
        data=json.loads(result.stdout)
        if data['name']!='/'+name or data['owner']!=owner or data['running'] is not True or not isinstance(data['pid'],int) or data['pid']<=0:raise ValueError()
        return data['pid']
    except (OSError,ValueError,KeyError,subprocess.SubprocessError):raise MeasurementError('Owned container metadata unavailable') from None

def cgroup_directory(pid,proc=Path('/proc'),root=Path('/sys/fs/cgroup')):
    try:
        path=next(line[3:] for line in (proc/str(pid)/'cgroup').read_text().splitlines() if line.startswith('0::'))
        root=root.resolve();directory=(root/path.lstrip('/')).resolve()
        if not directory.is_relative_to(root) or directory==root:raise ValueError()
        return directory
    except (OSError,StopIteration,ValueError):raise MeasurementError('Owned cgroup-v2 path unavailable') from None

def counter(path):
    try:
        value=int(path.read_text().strip())
        if value<0:raise ValueError()
        return value
    except (OSError,ValueError):raise MeasurementError('Required cgroup counter unavailable') from None

def events(path):
    try:return {k:int(v) for k,v in (line.split() for line in path.read_text().splitlines())}
    except (OSError,ValueError):raise MeasurementError('Required cgroup events unavailable') from None

def sample(paths):
    start=time.monotonic_ns();values={}
    for role,directory in paths.items():
        values[role]={'current':counter(directory/'memory.current'),'peak_since_creation':counter(directory/'memory.peak'),'swap_current':counter(directory/'memory.swap.current'),'events':events(directory/'memory.events')}
    return {'monotonic_ns':start,'read_span_ns':time.monotonic_ns()-start,'roles':values,'sampled_aggregate_bytes':sum(v['current'] for v in values.values()),'sampled_swap_bytes':sum(v['swap_current'] for v in values.values())}

def summarize(samples):
    if not samples:raise MeasurementError('No samples')
    roles=samples[0]['roles']
    if any(s['roles'].keys()!=roles.keys() for s in samples):raise MeasurementError('Container set changed')
    high=max(samples,key=lambda s:s['sampled_aggregate_bytes'])
    peaks={r:max(s['roles'][r]['peak_since_creation'] for s in samples) for r in roles}
    return {'sample_count':len(samples),'sampled_aggregate_peak_bytes':high['sampled_aggregate_bytes'],'peak_sample_monotonic_ns':high['monotonic_ns'],'max_read_span_ns':max(s['read_span_ns'] for s in samples),'max_sample_gap_ns':max((b['monotonic_ns']-a['monotonic_ns'] for a,b in zip(samples,samples[1:])),default=0),'per_container_peaks_since_creation':peaks,'sum_of_individual_peaks_upper_bound_bytes':sum(peaks.values()),'sampled_swap_peak_bytes':max(s['sampled_swap_bytes'] for s in samples),'memory_event_deltas':{r:{k:samples[-1]['roles'][r]['events'].get(k,0)-samples[0]['roles'][r]['events'].get(k,0) for k in ['oom','oom_kill','max','high']} for r in roles},'exact_simultaneous_peak_measured':False,'limitations':['Sequential reads have recorded skew; sampled aggregate is not an exact simultaneous peak.','Individual peaks include startup and form an upper bound only for the declared container set.','Host kernel/runtime overhead and omitted services are not measured.','memory.current includes charged file cache and tmpfs; do not add these again.','Swap is separate and is not available physical RAM.']}

def main():
    p=argparse.ArgumentParser();p.add_argument('--owner',required=True);p.add_argument('--roles',required=True);p.add_argument('--seconds',type=float,default=60);p.add_argument('--interval-ms',type=float,default=100);p.add_argument('--output',required=True);a=p.parse_args();roles=a.roles.split(',')
    if not re.fullmatch(r'contentos-bench-[a-f0-9]{12}',a.owner) or not all(re.fullmatch(r'[a-z][a-z0-9-]{0,31}',r) for r in roles) or len(set(roles))!=len(roles) or not {'worker','postgres','redis'}<=set(roles) or not 1<=a.seconds<=3600 or not 50<=a.interval_ms<=1000:raise MeasurementError('Invalid bounded fixture configuration')
    if sys.platform!='linux' or not Path('/var/run/docker.sock').is_socket() or not Path('/sys/fs/cgroup/cgroup.controllers').exists():raise MeasurementError('Native Linux local Docker and host cgroup v2 required')
    names={r:a.owner+'-'+r for r in roles};pids={r:owned_pid(n,a.owner) for r,n in names.items()};paths={r:cgroup_directory(pid) for r,pid in pids.items()}
    if len(set(paths.values()))!=len(paths):raise MeasurementError('Container cgroups must be distinct')
    samples=[];deadline=time.monotonic()+a.seconds;next_check=time.monotonic()+5
    while time.monotonic()<deadline:
        tick=time.monotonic();samples.append(sample(paths))
        if tick>=next_check:
            if any(owned_pid(names[r],a.owner)!=pids[r] for r in roles):raise MeasurementError('Owned container restarted')
            next_check=tick+5
        time.sleep(max(0,a.interval_ms/1000-(time.monotonic()-tick)))
    with open(a.output,'x') as output:json.dump({'owner':a.owner,'roles':roles,'summary':summarize(samples),'samples':samples},output,indent=2)
    print(json.dumps({'event':'benchmark_samples_saved','sample_count':len(samples)}))
if __name__=='__main__':
    try:main()
    except MeasurementError as e:print(json.dumps({'event':'benchmark_measurement_failed','reason':str(e)}),file=sys.stderr);sys.exit(1)
