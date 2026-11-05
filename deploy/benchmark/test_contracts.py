import json,tempfile,unittest
from pathlib import Path
from compare import analyze
class CompareTests(unittest.TestCase):
    def fixtures(self,root):
        for i,mode in enumerate(['standard','economy','economy','standard','standard','economy','standard','economy']):
            p=root/str(i);p.mkdir()
            r={'finished':6,'errors':[],'mode':mode,'peakActive':1 if mode=='economy' else 6,'sourceHash':'fixture-hash','scope':'synthetic','results':[{'id':str(j),'latencyMs':100+j,'bytes':10,'mimeType':'video/mp4','width':1920,'height':1080,'duration':6000} for j in range(6)]}
            (p/'final.json').write_text(json.dumps(r));(p/'drain.json').write_text(json.dumps({'exit_code':0,'forced_kill':False,'wall_seconds':2}))
            if i<6:(p/'load.json').write_text(json.dumps({'roles':['worker','web','postgres','redis','s3','smtp'],'summary':{'memory_event_deltas':{},'sampled_aggregate_peak_bytes':123,'sum_of_individual_peaks_upper_bound_bytes':200,'max_sample_gap_ns':100,'max_read_span_ns':5}}))
    def test_comparison_never_claims_production_budget(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.fixtures(p);r=analyze(p);self.assertEqual(len(r['trials']),8);self.assertFalse(r['production_memory_budget_established']);self.assertFalse(r['exact_simultaneous_peak_measured'])
    def test_mismatched_inputs_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.fixtures(p);f=p/'0/final.json';r=json.loads(f.read_text());r['sourceHash']='different';f.write_text(json.dumps(r))
            with self.assertRaises(ValueError):analyze(p)
    def test_forced_kill_not_success(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.fixtures(p);(p/'0/drain.json').write_text(json.dumps({'exit_code':137,'forced_kill':True,'wall_seconds':120}))
            with self.assertRaises(ValueError):analyze(p)
    def test_oom_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.fixtures(p);f=p/'0/load.json';r=json.loads(f.read_text());r['summary']['memory_event_deltas']={'worker':{'oom_kill':1}};f.write_text(json.dumps(r))
            with self.assertRaises(ValueError):analyze(p)
    def test_incomplete_work_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.fixtures(p);f=p/'0/final.json';r=json.loads(f.read_text());r['finished']=5;f.write_text(json.dumps(r))
            with self.assertRaises(ValueError):analyze(p)

class FreeWorkflowTests(unittest.TestCase):
    def test_free_compute_and_no_artifact_or_cache(self):
        root=Path(__file__).resolve().parents[2];workflow=(root/'.github/workflows/stack-benchmark.yml').read_text()
        self.assertIn("github.event.repository.private == false",workflow)
        self.assertIn("github.head_ref == 'codex/stack-benchmark'",workflow)
        self.assertIn('runs-on: ubuntu-24.04',workflow)
        self.assertNotIn('actions/upload-artifact',workflow);self.assertNotIn('actions/cache',workflow)
    def test_existing_checks_not_disabled(self):
        ci=(Path(__file__).resolve().parents[2]/'.github/workflows/ci.yml').read_text()
        for step in ['pnpm typecheck','pnpm lint','pnpm test:e2e','bash deploy/smoke-containers.sh','pnpm test:local --recovery']:self.assertIn(step,ci)
        self.assertIn("if: always() && github.head_ref != 'codex/stack-benchmark'",ci)
    def test_official_source_and_repeatability_gates(self):
        text=(Path(__file__).resolve().parent/'Minio.Dockerfile').read_text()
        self.assertIn('GOTOOLCHAIN=local',text);self.assertIn('go mod verify',text);self.assertIn('cmp /out/minio-a /out/minio-b',text)
        self.assertEqual(text.count('673f06144e90bc045f0a20050d2874c52e551be5bfbd70dff6e76b66da0db702'),2)

if __name__=='__main__':unittest.main()
