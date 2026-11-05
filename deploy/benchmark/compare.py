#!/usr/bin/env python3
import json,sys,math,statistics
from pathlib import Path

def analyze(root):
    trials=[];sources=set();formats=set()
    for directory in sorted(Path(root).iterdir()):
        if not directory.is_dir():continue
        final=json.loads((directory/'final.json').read_text());drain=json.loads((directory/'drain.json').read_text())
        if final['finished']!=6 or final['errors'] or len(final['results'])!=6 or len({r['id'] for r in final['results']})!=6:raise ValueError('Incomplete or repeated work')
        if drain['exit_code']!=0 or drain['forced_kill'] or not 0<=drain['wall_seconds']<120:raise ValueError('Invalid drain')
        if final['mode']=='economy' and final['peakActive']!=1:raise ValueError('Economy concurrency mismatch')
        sources.add(final['sourceHash'])
        formats.update((r['mimeType'],r['width'],r['height'],r['duration']) for r in final['results'])
        latency=sorted(r['latencyMs'] for r in final['results'])
        if any(r['bytes']<=0 or r['mimeType']!='video/mp4' or r['duration']<=0 for r in final['results']):raise ValueError('Invalid media output')
        row={'trial':directory.name,'mode':final['mode'],'scope':final['scope'],'work_items':6,'completion_ms':max(latency),'throughput_per_second':6000/max(latency),'p50_latency_ms':statistics.median(latency),'p95_latency_ms':latency[math.ceil(.95*len(latency))-1],'drain_wall_seconds':drain['wall_seconds'],'peakActive':final['peakActive']}
        if (directory/'load.json').exists():
            memory=json.loads((directory/'load.json').read_text())
            if set(memory['roles'])!={'worker','web','postgres','redis','s3','smtp'}:raise ValueError('Incomplete declared services')
            summary=memory['summary']
            if any(v.get('oom',0) or v.get('oom_kill',0) for v in summary['memory_event_deltas'].values()):raise ValueError('OOM during memory trial')
            row['sampled_aggregate_peak_bytes']=summary['sampled_aggregate_peak_bytes'];row['upper_bound_bytes']=summary['sum_of_individual_peaks_upper_bound_bytes'];row['max_sample_gap_ns']=summary['max_sample_gap_ns'];row['max_read_span_ns']=summary['max_read_span_ns']
        trials.append(row)
    if len(trials)!=8 or len(sources)!=1 or len(formats)!=1:raise ValueError('Expected eight trials and identical input hashes')
    for mode in ['standard','economy']:
        if len([t for t in trials if t['mode']==mode and 'sampled_aggregate_peak_bytes' in t])!=3:raise ValueError('Missing memory pair')
    return {'trials':trials,'source_hash':next(iter(sources)),'exact_simultaneous_peak_measured':False,'production_memory_budget_established':False,'limitations':['Synthetic media pipeline uses real adapters and JobRepository, not all production processors or entrypoint.','Web is measured at health-check/idle load, not authenticated upload traffic.','Shared CI host load and fixture container caps condition these results.','Memory is sampled aggregate with skew and separate individual-peak bound.','Six tasks are a small batch, not representative traffic or an SLA.']}
if __name__=='__main__':print(json.dumps(analyze(sys.argv[1]),indent=2))
