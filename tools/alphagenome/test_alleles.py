"""Indel alignment / missing evidence tests. Fake predictions, real SDK track types."""
import copy
import unittest
from types import SimpleNamespace
import numpy as np
import pandas as pd
from alphagenome.data.track_data import TrackData
import alleles
import compare
import review


def batch(kind='ko',inserted=''):
    r={'schema':'assured-alphagenome-allele-request/1','assembly':'GRCh38','chromosome':'chr17','gene':'TARGET','designKind':kind,'donor':'test',
       'reference':{'start':100001,'sequence':'A'*500},'sequenceLength':16384,'ontologyTerms':['CL:0000000'],'requestedOutputs':list(review.OUTPUTS),
       'edit':{'start':100100,'end':100104 if kind=='ko' else 100103,'inserted':inserted,'blockers':[]},
       'annotation':{'transcript':'test','strand':1,'exons':[[100050,100200]],'codingExons':[[100050,100200]],'convention':'0-based half-open'}}
    return seal({'schema':'assured-alphagenome-comparison-request/1','sourceId':'a'*64,'candidates':[{'id':'edited-allele','request':r}]})


def seal(b):
    r=b['candidates'][0]['request'];r['requestId']=alleles.digest({k:v for k,v in r.items() if k!='requestId'})
    b['requestId']=alleles.digest({k:v for k,v in b.items() if k!='requestId'});return b


def predictions(values=None,ontology='CL:0000000'):
    meta=pd.DataFrame({'name':['track'],'strand':['+'],'ontology_curie':[ontology]})
    t=TrackData(values=np.asarray(values if values is not None else np.ones(16384),dtype=np.float32).reshape(-1,1),metadata=meta,resolution=1)
    return SimpleNamespace(**{n.lower():t for n in review.OUTPUTS})


class AlleleTests(unittest.TestCase):
    def test_deleted_exons_not_counted_as_model_suppression_and_frameshift_separate(self):
        class Client:
            def predict_sequence(self,**kwargs):return predictions()
        result=alleles.run_batch(batch(),Client(),lambda c,s,e:'A'*(e-s),lambda *args:[])
        rna=next(t for t in result['targetTracks'] if t['output']=='RNA_SEQ')
        self.assertEqual(rna['signedRelativeChange'],0)
        self.assertEqual(rna['comparedBases'],146)
        self.assertTrue(result['structuralEvidence']['frameshiftSupported'])
        self.assertFalse(result['structuralEvidence']['proteinLossConfirmed'])
        self.assertEqual(result['conclusion'],'Target disruption supported by sequence')

    def test_shifted_downstream_peaks_match_in_deletion_and_insertion(self):
        for kind,insert in [('ko',''),('ct','C'*12)]:
            b=batch(kind,insert);r,bounds=alleles.validate_batch(b);start,end=bounds
            mapping=alleles.coordinate_map(r,bounds);ref=np.ones(16384);ref[100170-start]=20
            alt=np.ones(16384);alt[mapping[100170-start]]=20
            rows=alleles.track_rows(predictions(ref),predictions(alt),r,bounds,r['annotation']['exons'],1)
            self.assertTrue(all(t['maxAbsDelta']==0 for t in rows))
            extra=max(0,r['edit']['end']-r['edit']['start']-len(insert))
            sequences=alleles.build_sequences(r,'A'*(16384+extra),bounds)
            self.assertEqual(len(sequences['edited']),16384)
            self.assertEqual(sequences['edited'][r['edit']['start']-start:r['edit']['start']-start+len(insert)],insert)

    def test_insertion_blockers_are_compared_in_edited_coordinates(self):
        b=batch('ct','C'*12);r=b['candidates'][0]['request'];r['edit']['blockers']=[{'position':100180,'ref':'A','alt':'G'}];seal(b)
        r,bounds=alleles.validate_batch(b);sequences=alleles.build_sequences(r,'A'*16384,bounds)
        index=100180-bounds[0]+9
        self.assertEqual(sequences['intended'][index],'A');self.assertEqual(sequences['edited'][index],'G')
        self.assertEqual(len(sequences['edited']),16384)

    def test_unexpressed_partial_and_in_frame_do_not_become_knockout_success(self):
        class Zero:
            def predict_sequence(self,**kwargs):return predictions(np.zeros(16384))
        result=alleles.run_batch(batch(),Zero(),lambda c,s,e:'A'*(e-s),lambda *args:[])
        self.assertEqual(result['conclusion'],'Evidence insufficient')
        b=batch();b['candidates'][0]['request']['edit']['end']=100103;seal(b)
        self.assertFalse(alleles.structural_evidence(b['candidates'][0]['request'])['frameshiftSupported'])
        b['candidates'][0]['request']['annotation']['exons']=[[90000,100200]];seal(b)
        class Client:
            def predict_sequence(self,**kwargs):return predictions()
        result=alleles.run_batch(b,Client(),lambda c,s,e:'A'*(e-s),lambda *args:[])
        self.assertFalse(result['annotationFullyCovered']);self.assertEqual(result['conclusion'],'Evidence insufficient')

    def test_bad_digest_reference_and_cell_mismatch_fail_closed(self):
        b=batch();b['candidates'][0]['request']['edit']['end']+=1
        with self.assertRaises(ValueError):alleles.validate_batch(b)
        b=batch();r,bounds=alleles.validate_batch(b)
        with self.assertRaisesRegex(ValueError,'disagrees'):alleles.build_sequences(r,'G'*(16384+4),bounds)
        with self.assertRaisesRegex(ValueError,'context'):alleles.checked_predictions({'reference':predictions(ontology='CL:9999999'),'intended':predictions(),'edited':predictions()},r,16384)

    def test_common_window_and_retained_mask_match_across_different_alleles(self):
        first=batch();second=batch();second['candidates'][0]['request']['edit'].update({'start':100120,'end':100127})
        common={'schema':'assured-structural-comparison-context/1','start':92000,'exclusions':[[100100,100104],[100120,100127]]}
        for b in [first,second]:b['candidates'][0]['request']['comparisonContext']=copy.deepcopy(common);seal(b)
        r1,bounds1=alleles.validate_batch(first);r2,bounds2=alleles.validate_batch(second)
        self.assertEqual(bounds1,bounds2)
        a=predictions()
        rows1=alleles.track_rows(a,a,r1,bounds1,r1['annotation']['exons'],1)
        rows2=alleles.track_rows(a,a,r2,bounds2,r2['annotation']['exons'],1)
        self.assertEqual([t['comparedBases'] for t in rows1],[t['comparedBases'] for t in rows2])
        self.assertEqual(rows1[0]['comparedBases'],139)
        self.assertEqual(rows1[0]['signedRelativeChange'],0)
        broken=copy.deepcopy(first);broken['candidates'][0]['request']['comparisonContext']['exclusions']=[[1,2]];seal(broken)
        with self.assertRaisesRegex(ValueError,'excluded span'):alleles.validate_batch(broken)

    def test_neighbor_failure_and_missing_shapes_not_clean(self):
        class Client:
            def predict_sequence(self,**kwargs):return predictions()
        def failed(*args):raise RuntimeError('private diagnostic')
        result=alleles.run_batch(batch(),Client(),lambda c,s,e:'A'*(e-s),failed)
        self.assertIn('unavailable',result['neighborStatus']);self.assertNotIn('private diagnostic',str(result))
        with self.assertRaises(ValueError):alleles.checked_predictions({'reference':predictions([1]),'intended':predictions(),'edited':predictions()},batch()['candidates'][0]['request'],16384)
        self.assertEqual(compare.validate_batch(batch())[0]['designKind'],'ko')

if __name__=='__main__':unittest.main()
