"""Position and caching contracts; no network and no API key."""
import copy
import unittest
from types import SimpleNamespace
import numpy as np
import pandas as pd
from alphagenome.data.track_data import TrackData
import compare
import review
from test_review import request_payload


def batch():
    a = request_payload()
    b = copy.deepcopy(a)
    b['donor'] = 'donor1'
    b['variants'][1]['alt'] = 'G'
    b['requestId'] = compare.digest({k: v for k,v in b.items() if k!='requestId'})
    data = {'schema':'assured-alphagenome-comparison-request/1','sourceId':'source',
            'annotation':{'strand':1,'convention':'0-based half-open','exons':[[100000,100050],[100090,100150]],'splicePositions':[100050,100090]},
            'candidates':[{'id':'a','request':a},{'id':'b','request':b}]}
    data['requestId'] = compare.digest(data)
    return data


def predictions(value=1):
    meta = pd.DataFrame({'name':['test'],'strand':['+'],'ontology_curie':['CL:0000000']})
    values = np.ones((16384,1), dtype=np.float32)*value
    track = TrackData(values=values, metadata=meta, resolution=1)
    return SimpleNamespace(**{n.lower():track for n in review.OUTPUTS})


class ComparisonTests(unittest.TestCase):
    def test_matched_window_cache_and_three_comparisons(self):
        calls=[]
        class Client:
            def predict_sequence(self,**kwargs):
                calls.append(kwargs)
                return predictions(len(calls))
        result=compare.run_batch(batch(),Client(),lambda chrom,start,end:'A'*(end-start))
        self.assertEqual(len(calls),4) # common reference and intended, two unique donors
        self.assertEqual(len({(c['interval'].start,c['interval'].end) for c in calls}),1)
        self.assertEqual(len(result['candidates'][0]['comparisons']),3)
        self.assertTrue(result['candidates'][0]['metrics']['annotationFullyCovered'])
        self.assertGreater(result['candidates'][0]['metrics']['exonicRnaRelativeDelta'],0)

    def test_top_position_and_exon_splice_masks(self):
        data=batch(); _,bounds=compare.validate_batch(data)
        a,b=predictions(1),predictions(1)
        # Independent arrays: one change at an annotated boundary, one outside exons.
        for name in review.OUTPUTS:
            track=getattr(b,name.lower())
            vals=track.values.copy();vals[100050-bounds[0],0]=1.25;vals[100200-bounds[0],0]=2
            setattr(b,name.lower(),TrackData(values=vals,metadata=track.metadata,resolution=1))
        rows=compare.localized_tracks(a,b,data['annotation'],bounds)
        usage=next(r for r in rows if r['output']=='SPLICE_SITE_USAGE')
        self.assertEqual(usage['regionMaxAbsDelta'],.25)
        self.assertEqual(usage['topChanges'][0]['position'],100201) # explicit 1-based
        self.assertFalse(usage['topChanges'][0]['nearAnnotatedSpliceBoundary'])
        self.assertTrue(usage['topChanges'][1]['nearAnnotatedSpliceBoundary'])

    def test_missing_expression_and_partial_transcript_prevent_ranking(self):
        data=batch();_,bounds=compare.validate_batch(data)
        a,b=predictions(0),predictions(1)
        rows=compare.localized_tracks(a,b,data['annotation'],bounds)
        self.assertIsNone(compare.comparison_metrics(rows,data['annotation'],bounds)['exonicRnaRelativeDelta'])
        annotation=copy.deepcopy(data['annotation']);annotation['exons'][0][0]=bounds[0]-10
        self.assertFalse(compare.comparison_metrics(rows,annotation,bounds)['annotationFullyCovered'])
        self.assertIsNone(compare.comparison_metrics(rows,annotation,bounds)['annotatedUsageMaxDelta'])

    def test_corrupt_or_unmatched_requests_fail_before_prediction(self):
        data=batch();data['candidates'][1]['request']['ontologyTerms']=['CL:0000679']
        with self.assertRaises(ValueError):compare.validate_batch(data)
        data=batch()
        class Client:
            def predict_sequence(self,**kwargs):raise AssertionError('No prediction on a mismatched reference')
        with self.assertRaisesRegex(ValueError,'disagrees'):
            compare.run_batch(data,Client(),lambda chrom,start,end:'G'*(end-start))

    def test_failed_outputs_never_get_numeric_metrics(self):
        class Client:
            def predict_sequence(self,**kwargs):return SimpleNamespace(rna_seq=None)
        result=compare.run_batch(batch(),Client(),lambda chrom,start,end:'A'*(end-start))
        self.assertTrue(all(c['status']=='failed' and 'metrics' not in c for c in result['candidates']))

if __name__=='__main__':unittest.main()
