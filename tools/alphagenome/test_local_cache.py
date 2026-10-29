import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import local_cache

class LocalCacheTests(unittest.TestCase):
    def test_reference_superset_reused_and_corruption_retrieved_again(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict('os.environ',{'VERCEL':''}):
            calls=[]
            def fetch(c,s,e):calls.append((c,s,e));return 'A'*(e-s)
            self.assertEqual(local_cache.fetch_context('chr17',100,200,fetch,directory),'A'*100)
            self.assertEqual(local_cache.fetch_context('chr17',100,180,fetch,directory),'A'*80)
            self.assertEqual(len(calls),1)
            path=next((Path(directory)/'reference').glob('*.json'));path.write_text('{}')
            local_cache.fetch_context('chr17',100,180,fetch,directory);self.assertEqual(len(calls),2)
            self.assertEqual(path.stat().st_mode&0o777,0o600)

    def test_only_completed_matched_reports_cached_privately(self):
        b={'requestId':'a'*64,'sourceId':'b'*64,'candidates':[{'id':'x'}]}
        with tempfile.TemporaryDirectory() as directory,patch.dict('os.environ',{'VERCEL':''}):
            calls=[]
            def run(batch,client):calls.append(1);return {'requestId':batch['requestId'],'sourceId':batch['sourceId'],'candidates':[{'id':'x','status':'complete'}]}
            self.assertEqual(local_cache.run_cached(b,None,run,directory),local_cache.run_cached(b,None,run,directory))
            self.assertEqual(len(calls),1)
            path=next((Path(directory)/'reviews').glob('*.json'));self.assertEqual(path.stat().st_mode&0o777,0o600)
            path.write_text('{broken')
            local_cache.run_cached(b,None,run,directory);self.assertEqual(len(calls),2)
            self.assertFalse(local_cache.completed({'requestId':b['requestId'],'sourceId':b['sourceId'],'candidates':[{'id':'x','status':'failed'}]},b))
            self.assertFalse(local_cache.completed({'requestId':'wrong'},b))

if __name__=='__main__':unittest.main()
