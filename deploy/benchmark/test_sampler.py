from pathlib import Path
import tempfile,unittest
from unittest.mock import patch
import sample_cgroups as s
class Tests(unittest.TestCase):
    def row(self,a,b,t):return {'monotonic_ns':t,'read_span_ns':5,'sampled_aggregate_bytes':a+b,'sampled_swap_bytes':0,'roles':{'worker':{'current':a,'peak_since_creation':100,'events':{}},'postgres':{'current':b,'peak_since_creation':100,'events':{}}}}
    def test_peak_not_sum_of_unrelated_maxima(self):
        r=s.summarize([self.row(100,10,0),self.row(10,100,1000)])
        self.assertEqual(r['sampled_aggregate_peak_bytes'],110);self.assertEqual(r['sum_of_individual_peaks_upper_bound_bytes'],200);self.assertFalse(r['exact_simultaneous_peak_measured']);self.assertEqual(r['max_sample_gap_ns'],1000)
    def test_ownership_rejected(self):
        with patch.object(s.subprocess,'run') as run:
            run.return_value.stdout='{"name":"/fixture","pid":10,"running":true,"owner":"wrong"}'
            with self.assertRaises(s.MeasurementError):s.owned_pid('fixture','expected')
    def test_missing_memory_not_zero(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(s.MeasurementError):s.counter(Path(d)/'missing')
    def test_proc_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'proc/1').mkdir(parents=True);(p/'cg').mkdir();(p/'proc/1/cgroup').write_text('0::/../../outside\n')
            with self.assertRaises(s.MeasurementError):s.cgroup_directory(1,p/'proc',p/'cg')
    def test_changed_roles_rejected(self):
        a=self.row(1,2,0);b=self.row(1,2,100);b['roles'].pop('postgres')
        with self.assertRaises(s.MeasurementError):s.summarize([a,b])
    def test_read_counters(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            for k,v in {'memory.current':'10','memory.peak':'20','memory.swap.current':'3','memory.events':'oom 0\noom_kill 0\n'}.items():(p/k).write_text(v)
            r=s.sample({'worker':p});self.assertEqual(r['sampled_aggregate_bytes'],10);self.assertEqual(r['sampled_swap_bytes'],3)
if __name__=='__main__':unittest.main()
